import { Log } from "@/util/util/log"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { Global } from "../global"
import { lazy } from "@/util/util/lazy"
import { $ } from "bun"
import { NamedError } from "@atomcli/util/error"
import z from "zod"
import { STORAGE_UPDATE_RETRIES, StorageManifest } from "./manifest"
import { StorageBackup } from "./backup"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  // ── LRU Read Cache ────────────────────────────────────────
  const CACHE_MAX_SIZE = 2000
  const CACHE_MAX_BYTES = 64 * 1024 * 1024
  const CACHE_MAX_ENTRY_BYTES = 1024 * 1024
  const readCache = new Map<string, { value: any; bytes: number; revision: number }>()
  let readCacheBytes = 0

  function cacheKey(key: string[]): string {
    return key.join("\0")
  }

  /** Returns true for primitive values that are inherently immutable — no clone needed. */
  function isPrimitive(v: any): boolean {
    return v === null || (typeof v !== "object" && typeof v !== "function")
  }

  function cacheGet(key: string[], revision: number): any | undefined {
    const k = cacheKey(key)
    const entry = readCache.get(k)
    if (entry === undefined) return undefined
    if (entry.revision !== revision) {
      readCacheBytes -= entry.bytes
      readCache.delete(k)
      return undefined
    }
    // LRU: delete + re-insert to move to end
    readCache.delete(k)
    readCache.set(k, entry)
    // Security: return a deep clone so callers cannot alias (and silently mutate)
    // the cached object without going through Storage.write / Storage.update.
    return isPrimitive(entry.value) ? entry.value : structuredClone(entry.value)
  }

  function estimateCacheBytes(value: any): number {
    if (value === null || value === undefined) return 8
    if (typeof value === "string") return value.length * 2
    if (typeof value !== "object") return 16

    let bytes = 0
    const seen = new Set<object>()
    const pending: any[] = [value]
    while (pending.length) {
      const item = pending.pop()
      if (item === null || item === undefined) {
        bytes += 8
      } else if (typeof item === "string") {
        bytes += item.length * 2
      } else if (typeof item !== "object") {
        bytes += 16
      } else if (!seen.has(item)) {
        seen.add(item)
        bytes += 64
        if (bytes > CACHE_MAX_ENTRY_BYTES) return bytes
        if (Array.isArray(item)) {
          bytes += item.length * 8
          if (bytes > CACHE_MAX_ENTRY_BYTES) return bytes
          for (const child of item) pending.push(child)
        } else {
          for (const [property, child] of Object.entries(item)) {
            bytes += property.length * 2
            pending.push(child)
          }
        }
      }
      if (bytes > CACHE_MAX_ENTRY_BYTES) return bytes
    }
    return bytes
  }

  function cacheSet(key: string[], value: any, revision: number, sizeHint?: number): void {
    const k = cacheKey(key)
    const previous = readCache.get(k)
    if (previous) {
      readCacheBytes -= previous.bytes
      readCache.delete(k)
    }
    if (sizeHint !== undefined && sizeHint > CACHE_MAX_ENTRY_BYTES) return
    const bytes = estimateCacheBytes(value)
    if (bytes > CACHE_MAX_ENTRY_BYTES) return
    // Security: store a deep clone so the caller's reference cannot alias the cache
    // after this call — mutations to their copy won't corrupt cached state.
    const stored = isPrimitive(value) ? value : structuredClone(value)
    readCache.set(k, { value: stored, bytes, revision })
    readCacheBytes += bytes
    while (readCache.size > CACHE_MAX_SIZE || readCacheBytes > CACHE_MAX_BYTES) {
      const first = readCache.keys().next().value
      if (first === undefined) break
      const removed = readCache.get(first)
      if (removed) readCacheBytes -= removed.bytes
      readCache.delete(first)
    }
  }

  function cacheDelete(key: string[]): void {
    const k = cacheKey(key)
    const previous = readCache.get(k)
    if (previous) readCacheBytes -= previous.bytes
    readCache.delete(k)
  }

  type Migration = (dir: string) => Promise<void>

  async function exists(target: string) {
    return fs
      .access(target)
      .then(() => true)
      .catch(() => false)
  }

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!(await exists(project))) return
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = os.homedir()

        if (projectID !== "global") {
          for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            const json = await Bun.file(msgFile).json()
            worktree = json.path?.root
            if (worktree) break
          }
          if (!worktree) continue
          if (!(await exists(worktree))) continue
          const [id] = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(worktree)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          if (!id) continue
          projectID = id

          await Bun.write(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify({
              id,
              vcs: "git",
              worktree,
              time: {
                created: Date.now(),
                initialized: Date.now(),
              },
            }),
          )

          log.info(`migrating sessions for project ${projectID}`)
          for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Bun.file(sessionFile).json()
            await Bun.write(dest, JSON.stringify(session))
            log.info(`migrating messages for session ${session.id}`)
            for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Bun.file(msgFile).json()
              await Bun.write(dest, JSON.stringify(message))

              log.info(`migrating parts for message ${message.id}`)
              for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                {
                  cwd: fullProjectDir,
                  absolute: true,
                },
              )) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Bun.file(partFile).json()
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Bun.write(dest, JSON.stringify(part))
              }
            }
          }
        }
      }
    },
    async (dir) => {
      for await (const item of new Bun.Glob("session/*/*.json").scan({
        cwd: dir,
        absolute: true,
      })) {
        const session = await Bun.file(item).json()
        if (!session.projectID) continue
        if (!session.summary?.diffs) continue
        const { diffs } = session.summary
        await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
        await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
          JSON.stringify({
            ...session,
            summary: {
              additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
              deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
            },
          }),
        )
      }
    },
  ]

  async function runMigrations(dir: string, start: number, migrations: Migration[] = MIGRATIONS) {
    for (let index = start; index < migrations.length; index++) {
      log.info("running migration", { index })
      try {
        await migrations[index](dir)
      } catch (error) {
        log.error("failed to run migration", { index, error })
        throw error
      }
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
  }

  const state = lazy(async () => {
    const dir = path.join(Global.Path.data, "storage")
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    const manifestFile = path.join(dir, "manifest.sqlite")
    const manifestExisted = await Bun.file(manifestFile).exists()
    if (!manifestExisted) {
      await StorageBackup.createLegacy(dir, path.join(Global.Path.data, "storage-backups", "cutover-v1"))
    }
    await runMigrations(dir, migration)
    const manifest = await StorageManifest.open(dir)
    if (!manifestExisted && !manifest.legacyImportComplete()) {
      const known = manifest.logicalKeys()
      for await (const item of new Bun.Glob("**/*.json").scan({ cwd: dir, onlyFiles: true })) {
        if (item.startsWith(".blobs" + path.sep)) continue
        const key = item.slice(0, -5).split(path.sep)
        const encoded = StorageManifest.logicalKey(key)
        if (known.has(encoded)) continue
        const content = await Bun.file(path.join(dir, item)).text()
        await manifest.importLegacy(key, content)
        known.add(encoded)
      }
      manifest.markLegacyImportComplete()
    }
    manifest.backfillSessionGuards()
    return {
      dir,
      manifest,
    }
  })

  async function record(current: Awaited<ReturnType<typeof state>>, key: string[]) {
    let result = await current.manifest.read(key)
    if (result || current.manifest.pointer(key)) return result
    const legacy = Bun.file(path.join(current.dir, ...key) + ".json")
    if (!(await legacy.exists())) return
    await current.manifest.importLegacy(key, await legacy.text())
    result = await current.manifest.read(key)
    return result
  }

  export async function remove(key: string[]) {
    const current = await state()
    return withErrorHandling(async () => {
      current.manifest.remove(key)
      cacheDelete(key)
    })
  }

  export async function removeGuarded(key: string[], sessionID: string, expectedGeneration?: number) {
    const current = await state()
    return withErrorHandling(async () => {
      current.manifest.removeGuarded(key, sessionID, expectedGeneration)
      cacheDelete(key)
    })
  }

  export async function read<T>(key: string[]) {
    const current = await state()
    let pointer = current.manifest.pointer(key)
    if (!pointer) {
      await record(current, key)
      pointer = current.manifest.pointer(key)
    }
    if (!pointer || pointer.tombstone) {
      throw new NotFoundError({ message: `Resource not found: ${path.join(current.dir, ...key)}.json` })
    }
    const cached = cacheGet(key, pointer.revision)
    if (cached !== undefined) return cached as T
    return withErrorHandling(async () => {
      const stored = await record(current, key)
      if (!stored) throw Object.assign(new Error("Resource not found"), { code: "ENOENT", path: key.join("/") })
      const result = JSON.parse(stored.content)
      cacheSet(key, result, stored.revision, stored.content.length)
      return result as T
    })
  }

  export async function peek(key: string[], maxBytes = 1024) {
    const current = await state()
    return withErrorHandling(async () => {
      await record(current, key)
      const pointer = current.manifest.pointer(key)
      if (!pointer || pointer.tombstone || !pointer.contentHash) {
        throw Object.assign(new Error("Resource not found"), { code: "ENOENT", path: key.join("/") })
      }
      return Bun.file(current.manifest.blobPath(pointer.contentHash)).slice(0, Math.max(0, maxBytes)).text()
    })
  }

  /**
   * Reads a top-level JSON string field without materializing the full document.
   * This is used for discriminators on potentially very large persisted records.
   */
  export async function topLevelString(key: string[], field: string) {
    const current = await state()
    return withErrorHandling(async () => {
      await record(current, key)
      const pointer = current.manifest.pointer(key)
      if (!pointer || pointer.tombstone || !pointer.contentHash) {
        throw Object.assign(new Error("Resource not found"), { code: "ENOENT", path: key.join("/") })
      }
      const target = current.manifest.blobPath(pointer.contentHash)
      const reader = Bun.file(target).stream().getReader()
      const decoder = new TextDecoder()
      let depth = 0
      let inString = false
      let escaped = false
      let mode: "key" | "value" | "skip" = "skip"
      let capture = ""
      let currentKey: string | undefined
      let expectKey = false
      let expectValue = false

      const consume = (text: string): string | undefined => {
        for (const character of text) {
          if (inString) {
            if (escaped) {
              escaped = false
              if (mode !== "skip" && capture.length < 256) capture += character
              continue
            }
            if (character === "\\") {
              escaped = true
              continue
            }
            if (character !== '"') {
              if (mode !== "skip" && capture.length < 256) capture += character
              continue
            }
            inString = false
            if (mode === "key") {
              currentKey = capture
              expectKey = false
            } else if (mode === "value" && currentKey === field) {
              return capture
            }
            capture = ""
            mode = "skip"
            continue
          }

          if (character === "{" || character === "[") {
            depth++
            if (character === "{" && depth === 1) expectKey = true
            continue
          }
          if (character === "}" || character === "]") {
            if (depth === 1) {
              currentKey = undefined
              expectKey = false
              expectValue = false
            }
            depth--
            continue
          }
          if (depth !== 1) continue
          if (character === ",") {
            currentKey = undefined
            expectKey = true
            expectValue = false
            continue
          }
          if (character === ":" && currentKey !== undefined) {
            expectValue = true
            continue
          }
          if (character === '"') {
            inString = true
            capture = ""
            mode = expectKey ? "key" : expectValue && currentKey === field ? "value" : "skip"
            continue
          }
          if (expectValue && currentKey === field && !/\s/.test(character)) return
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        const found = consume(decoder.decode(value, { stream: !done }))
        if (found !== undefined) {
          await reader.cancel()
          return found
        }
        if (done) return
      }
    })
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const current = await state()
    return withErrorHandling(async () => {
      for (let attempt = 0; attempt < STORAGE_UPDATE_RETRIES; attempt++) {
        const stored = await record(current, key)
        if (!stored) throw Object.assign(new Error("Resource not found"), { code: "ENOENT", path: key.join("/") })
        const content = JSON.parse(stored.content) as T
        fn(content)
        const serialized = JSON.stringify(content, null, 2)
        const revision = await current.manifest.compareAndSwap(key, stored.revision, serialized)
        if (revision !== undefined) {
          cacheSet(key, content, revision, serialized.length)
          return content
        }
        await Bun.sleep(Math.min(attempt + 1, 8))
      }
      throw new StorageManifest.ConflictError(StorageManifest.logicalKey(key))
    })
  }

  export async function updateGuarded<T>(
    key: string[],
    sessionID: string,
    fn: (draft: T) => void,
    expectedGeneration?: number,
  ) {
    const current = await state()
    return withErrorHandling(async () => {
      for (let attempt = 0; attempt < STORAGE_UPDATE_RETRIES; attempt++) {
        const stored = await record(current, key)
        if (!stored) throw Object.assign(new Error("Resource not found"), { code: "ENOENT", path: key.join("/") })
        const content = JSON.parse(stored.content) as T
        fn(content)
        const serialized = JSON.stringify(content, null, 2)
        const revision = await current.manifest.compareAndSwapGuarded(
          key,
          stored.revision,
          sessionID,
          expectedGeneration,
          serialized,
        )
        if (revision !== undefined) {
          cacheSet(key, content, revision, serialized.length)
          return content
        }
        await Bun.sleep(Math.min(attempt + 1, 8))
      }
      throw new StorageManifest.ConflictError(StorageManifest.logicalKey(key))
    })
  }

  export async function write<T>(key: string[], content: T) {
    const current = await state()
    return withErrorHandling(async () => {
      const serialized = JSON.stringify(content, null, 2)
      const revision = await current.manifest.replace(key, serialized)
      cacheSet(key, content, revision, serialized.length)
    })
  }

  export async function writeGuarded<T>(key: string[], sessionID: string, content: T, expectedGeneration?: number) {
    const current = await state()
    return withErrorHandling(async () => {
      const serialized = JSON.stringify(content, null, 2)
      const revision = await current.manifest.replaceGuarded(key, sessionID, expectedGeneration, serialized)
      cacheSet(key, content, revision, serialized.length)
      return revision
    })
  }

  export async function activateSession(sessionID: string) {
    const current = await state()
    return current.manifest.activateSession(sessionID)
  }

  export async function tombstoneSessions(sessionIDs: string[]) {
    const current = await state()
    const result = current.manifest.tombstoneSessions(sessionIDs)
    for (const sessionID of sessionIDs) {
      for (const key of [...readCache.keys()]) {
        if (key.includes(`\0${sessionID}\0`) || key.endsWith(`\0${sessionID}`)) {
          const entry = readCache.get(key)
          if (entry) readCacheBytes -= entry.bytes
          readCache.delete(key)
        }
      }
    }
    return result
  }

  export async function sessionGuard(sessionID: string) {
    const current = await state()
    return current.manifest.sessionGuard(sessionID)
  }

  export function isSessionDeletedError(error: unknown): error is StorageManifest.SessionDeletedError {
    return (
      error instanceof StorageManifest.SessionDeletedError ||
      (error instanceof Error && error.name === "StorageSessionDeletedError")
    )
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  export async function list(prefix: string[]) {
    const current = await state()
    try {
      const result = current.manifest.list(prefix)
      if (current.manifest.legacyImportComplete()) return result
      const legacyDir = path.join(current.dir, ...prefix)
      if (
        !(await fs
          .stat(legacyDir)
          .then((entry) => entry.isDirectory())
          .catch(() => false))
      )
        return result
      for await (const item of new Bun.Glob("**/*.json").scan({ cwd: legacyDir, onlyFiles: true })) {
        const key = [...prefix, ...item.slice(0, -5).split(path.sep)]
        if (!current.manifest.pointer(key)) result.push(key)
      }
      return result.sort((a, b) => StorageManifest.logicalKey(a).localeCompare(StorageManifest.logicalKey(b)))
    } catch {
      return []
    }
  }

  export const _internals = {
    runMigrations,
    async importLegacy(key: string[], content: string) {
      const current = await state()
      return current.manifest.importLegacy(key, content)
    },
  }
}
