import { Log } from "@/util/util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { lazy } from "@/util/util/lazy"
import { Lock } from "@/util/util/lock"
import { $ } from "bun"
import { NamedError } from "@atomcli/util/error"
import z from "zod"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  // ── LRU Read Cache ────────────────────────────────────────
  const CACHE_MAX_SIZE = 2000
  const readCache = new Map<string, any>()

  function cacheKey(key: string[]): string {
    return key.join("\0")
  }

  /** Returns true for primitive values that are inherently immutable — no clone needed. */
  function isPrimitive(v: any): boolean {
    return v === null || typeof v !== "object" && typeof v !== "function"
  }

  function cacheGet(key: string[]): any | undefined {
    const k = cacheKey(key)
    const v = readCache.get(k)
    if (v === undefined) return undefined
    // LRU: delete + re-insert to move to end
    readCache.delete(k)
    readCache.set(k, v)
    // Security: return a deep clone so callers cannot alias (and silently mutate)
    // the cached object without going through Storage.write / Storage.update.
    return isPrimitive(v) ? v : structuredClone(v)
  }

  function cacheSet(key: string[], value: any): void {
    const k = cacheKey(key)
    // Security: store a deep clone so the caller's reference cannot alias the cache
    // after this call — mutations to their copy won't corrupt cached state.
    const stored = isPrimitive(value) ? value : structuredClone(value)
    readCache.delete(k)
    readCache.set(k, stored)
    if (readCache.size > CACHE_MAX_SIZE) {
      const first = readCache.keys().next().value
      if (first !== undefined) readCache.delete(first)
    }
  }

  function cacheDelete(key: string[]): void {
    readCache.delete(cacheKey(key))
  }

  // ── List Cache (prefix-based invalidation) ────────────────
  const LIST_CACHE_MAX_SIZE = 200
  const listCache = new Map<string, string[][]>()

  function listCacheKey(prefix: string[]): string {
    return prefix.join("\0")
  }

  function listCacheInvalidate(key: string[]): void {
    for (const [k] of listCache) {
      const prefixParts = k.split("\0")
      if (
        key.length >= prefixParts.length &&
        prefixParts.every((p, i) => p === key[i])
      ) {
        listCache.delete(k)
      }
    }
  }

  type Migration = (dir: string) => Promise<void>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!fs.exists(project)) return
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

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
          if (!(await fs.exists(worktree))) continue
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

  const state = lazy(async () => {
    const dir = path.join(Global.Path.data, "storage")
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const migration = MIGRATIONS[index]
      await migration(dir).catch(() => log.error("failed to run migration", { index }))
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
    return {
      dir,
    }
  })

  export async function remove(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      await fs.unlink(target).catch(() => { })
      cacheDelete(key)
      listCacheInvalidate(key)
    })
  }

  export async function read<T>(key: string[]) {
    const cached = cacheGet(key)
    if (cached !== undefined) return cached as T
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Bun.file(target).json()
      cacheSet(key, result)
      return result as T
    })
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = await Bun.file(target).json()
      fn(content)
      await Bun.write(target, JSON.stringify(content, null, 2))
      cacheSet(key, content)
      return content as T
    })
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await state().then((x) => x.dir)
    const target = path.join(dir, ...key) + ".json"
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
      cacheSet(key, content)
      listCacheInvalidate(key)
    })
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

  const glob = new Bun.Glob("**/*")
  export async function list(prefix: string[]) {
    const lk = listCacheKey(prefix)
    const cached = listCache.get(lk)
    if (cached !== undefined) return cached
    const dir = await state().then((x) => x.dir)
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      listCache.set(lk, result)
      if (listCache.size > LIST_CACHE_MAX_SIZE) {
        const first = listCache.keys().next().value
        if (first !== undefined) listCache.delete(first)
      }
      return result
    } catch {
      return []
    }
  }
}
