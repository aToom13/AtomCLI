import { Database } from "bun:sqlite"
import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { Log } from "@/util/util/log"

const FORMAT_VERSION = 1
export const STORAGE_UPDATE_RETRIES = 32

type Row = {
  logical_key: string
  revision: number
  content_hash: string | null
  tombstone: number
}

export namespace StorageManifest {
  const log = Log.create({ service: "storage-manifest" })
  export type Pointer = {
    revision: number
    contentHash?: string
    tombstone: boolean
  }

  export class ConflictError extends Error {
    constructor(readonly logicalKey: string) {
      super(`Storage update conflicted after ${STORAGE_UPDATE_RETRIES} attempts: ${logicalKey}`)
      this.name = "StorageConflictError"
    }
  }

  export class SessionDeletedError extends Error {
    constructor(readonly sessionID: string) {
      super(`Session is deleted: ${sessionID}`)
      this.name = "StorageSessionDeletedError"
    }
  }

  export function logicalKey(key: string[]) {
    return JSON.stringify(key)
  }

  export function parseLogicalKey(value: string) {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((part) => typeof part !== "string")) {
      throw new Error("Invalid storage manifest key")
    }
    return parsed as string[]
  }

  export async function open(dir: string, options: { maxBytes?: number } = {}) {
    const maxBytes = options.maxBytes ?? 0
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid storage byte limit")
    await fs.mkdir(dir, { recursive: true })
    const blobDir = path.join(dir, ".blobs")
    await fs.mkdir(blobDir, { recursive: true })
    const db = new Database(path.join(dir, "manifest.sqlite"), { create: true })
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = FULL")
    db.run("BEGIN IMMEDIATE")
    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS storage_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS storage_manifest (
          logical_key TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          revision INTEGER NOT NULL,
          content_hash TEXT,
          tombstone INTEGER NOT NULL DEFAULT 0,
          generation INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS storage_session_guard (
          session_id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL,
          tombstone INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `)
      db.run("CREATE INDEX IF NOT EXISTS storage_manifest_namespace ON storage_manifest(namespace, tombstone)")
      db.run(
        "CREATE INDEX IF NOT EXISTS storage_manifest_content ON storage_manifest(content_hash) WHERE tombstone = 0",
      )
      const existing = db
        .query<{ value: string }, [string]>("SELECT value FROM storage_meta WHERE key = ?")
        .get("format")
      if (existing && Number(existing.value) > FORMAT_VERSION) {
        throw new Error(
          `Storage format ${existing.value} is newer than this AtomCLI binary supports (${FORMAT_VERSION})`,
        )
      }
      db.query("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)").run("format", String(FORMAT_VERSION))
      db.run("COMMIT")
    } catch (error) {
      try {
        db.run("ROLLBACK")
      } catch {}
      db.close()
      throw error
    }

    function transaction<T>(body: () => T) {
      db.run("BEGIN IMMEDIATE")
      try {
        const result = body()
        db.run("COMMIT")
        return result
      } catch (error) {
        db.run("ROLLBACK")
        throw error
      }
    }

    function pointer(key: string[]): Pointer | undefined {
      const row = db
        .query<
          Row,
          [string]
        >("SELECT logical_key, revision, content_hash, tombstone FROM storage_manifest WHERE logical_key = ?")
        .get(logicalKey(key))
      if (!row) return
      return {
        revision: row.revision,
        contentHash: row.content_hash ?? undefined,
        tombstone: row.tombstone === 1,
      }
    }

    function hash(content: string) {
      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(content)
      return hasher.digest("hex")
    }

    async function prepareBlob(content: string) {
      const contentHash = hash(content)
      const target = path.join(blobDir, `${contentHash}.json`)
      if (!(await Bun.file(target).exists())) {
        const temporary = path.join(blobDir, `.${contentHash}.${process.pid}.${crypto.randomUUID()}.tmp`)
        await Bun.write(temporary, content)
        const handle = await fs.open(temporary, "r")
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.rename(temporary, target).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error
          await fs.unlink(temporary).catch(() => {})
        })
      }
      return contentHash
    }

    // Publication and GC share the SQLite writer lock. A collector may have
    // removed an unreferenced blob after async preparation, so republish it.
    function ensureBlob(contentHash: string, content: string) {
      const target = path.join(blobDir, `${contentHash}.json`)
      if (fsSync.existsSync(target)) return
      const temporary = path.join(blobDir, `.${contentHash}.${process.pid}.${crypto.randomUUID()}.tmp`)
      const fd = fsSync.openSync(temporary, "wx", 0o600)
      try {
        fsSync.writeFileSync(fd, content)
        fsSync.fsyncSync(fd)
      } finally {
        fsSync.closeSync(fd)
      }
      fsSync.renameSync(temporary, target)
    }

    // Counts conservatively per pointer, including filesystem block overhead.
    // Triggers make quota admission O(1), under the publication writer lock.
    if (maxBytes) {
      db.run("CREATE TABLE IF NOT EXISTS storage_sizes (logical_key TEXT PRIMARY KEY, bytes INTEGER NOT NULL)")
      db.run("CREATE TABLE IF NOT EXISTS storage_usage (id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL)")
      db.run("INSERT OR IGNORE INTO storage_usage VALUES (1, 0)")
      db.run(
        "CREATE TRIGGER IF NOT EXISTS storage_size_insert AFTER INSERT ON storage_sizes BEGIN UPDATE storage_usage SET bytes = bytes + NEW.bytes WHERE id = 1; END",
      )
      db.run(
        "CREATE TRIGGER IF NOT EXISTS storage_size_update AFTER UPDATE ON storage_sizes BEGIN UPDATE storage_usage SET bytes = bytes + NEW.bytes - OLD.bytes WHERE id = 1; END",
      )
      db.run(
        "CREATE TRIGGER IF NOT EXISTS storage_size_delete AFTER DELETE ON storage_sizes BEGIN UPDATE storage_usage SET bytes = bytes - OLD.bytes WHERE id = 1; END",
      )
      transaction(() => {
        db.run(
          "DELETE FROM storage_sizes WHERE logical_key IN (SELECT logical_key FROM storage_manifest WHERE tombstone = 1)",
        )
        const missing = db
          .query<
            { logical_key: string; content_hash: string },
            []
          >("SELECT m.logical_key, m.content_hash FROM storage_manifest m LEFT JOIN storage_sizes s ON m.logical_key = s.logical_key WHERE m.tombstone = 0 AND s.logical_key IS NULL")
          .all()
        for (const row of missing) {
          const bytes = fsSync.statSync(path.join(blobDir, `${row.content_hash}.json`)).size + 4096
          db.query("INSERT INTO storage_sizes VALUES (?, ?)").run(row.logical_key, bytes)
        }
      })
    }

    function capacity(key: string[], content: string, importing = false, apply = false) {
      if (!maxBytes) return
      const encoded = logicalKey(key)
      const bytes = Buffer.byteLength(content) + 4096
      const used = db.query<{ bytes: number }, []>("SELECT bytes FROM storage_usage WHERE id = 1").get()!.bytes
      const previous =
        db.query<{ bytes: number }, [string]>("SELECT bytes FROM storage_sizes WHERE logical_key = ?").get(encoded)
          ?.bytes ?? 0
      if (!importing && used + bytes - previous > maxBytes && bytes > previous) {
        throw new Error(
          `Storage limit (${maxBytes / 1048576} MiB) reached. Delete unused conversations or run atomcli debug storage --apply before retrying.`,
        )
      }
      if (apply)
        db.query(
          "INSERT INTO storage_sizes VALUES (?, ?) ON CONFLICT(logical_key) DO UPDATE SET bytes = excluded.bytes",
        ).run(encoded, bytes)
    }

    // Replaced versions are not history. Commit the pointer first; a failed
    // transaction must never leave its original referenced blob missing.
    function retire(contentHash?: string) {
      if (!contentHash) return
      try {
        transaction(() => {
          if (
            db.query("SELECT 1 FROM storage_manifest WHERE content_hash = ? AND tombstone = 0 LIMIT 1").get(contentHash)
          )
            return
          const target = path.join(blobDir, `${contentHash}.json`)
          if (fsSync.lstatSync(target).isFile()) fsSync.unlinkSync(target)
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Open handles on Windows may postpone unlink until background GC.
          log.warn("retired blob cleanup postponed", { code: (error as NodeJS.ErrnoException).code })
        }
      }
    }

    function setPointer(
      key: string[],
      contentHash: string,
      content: string,
      expectedRevision?: number,
      importing = false,
    ) {
      const encoded = logicalKey(key)
      let previous: string | undefined
      const result = transaction(() => {
        const current = pointer(key)
        previous = current?.contentHash
        if (expectedRevision === 0) {
          if (current !== undefined) return undefined
        } else if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
          return undefined
        }
        capacity(key, content, importing, true)
        ensureBlob(contentHash, content)
        const revision = (current?.revision ?? 0) + 1
        db.query(
          `INSERT INTO storage_manifest
            (logical_key, namespace, revision, content_hash, tombstone, generation, updated_at)
           VALUES (?, ?, ?, ?, 0, 1, ?)
           ON CONFLICT(logical_key) DO UPDATE SET
             namespace = excluded.namespace,
             revision = excluded.revision,
             content_hash = excluded.content_hash,
             tombstone = 0,
             updated_at = excluded.updated_at`,
        ).run(encoded, key[0] ?? "", revision, contentHash, Date.now())
        return revision
      })
      retire(previous)
      retire(contentHash)
      return result
    }

    function sessionGuard(sessionID: string) {
      const row = db
        .query<
          { generation: number; tombstone: number },
          [string]
        >("SELECT generation, tombstone FROM storage_session_guard WHERE session_id = ?")
        .get(sessionID)
      if (!row) return
      return { generation: row.generation, tombstone: row.tombstone === 1 }
    }

    function setPointerGuarded(
      key: string[],
      contentHash: string,
      content: string,
      sessionID: string,
      expectedGeneration?: number,
      expectedRevision?: number,
    ) {
      const encoded = logicalKey(key)
      let previous: string | undefined
      const result = transaction(() => {
        const guard = sessionGuard(sessionID)
        if (!guard || guard.tombstone) throw new SessionDeletedError(sessionID)
        if (expectedGeneration !== undefined && guard.generation !== expectedGeneration) {
          throw new SessionDeletedError(sessionID)
        }
        const current = pointer(key)
        previous = current?.contentHash
        if (expectedRevision === 0) {
          if (current !== undefined) return undefined
        } else if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
          return undefined
        }
        capacity(key, content, false, true)
        ensureBlob(contentHash, content)
        const revision = (current?.revision ?? 0) + 1
        db.query(
          `INSERT INTO storage_manifest
            (logical_key, namespace, revision, content_hash, tombstone, generation, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(logical_key) DO UPDATE SET
             namespace = excluded.namespace,
             revision = excluded.revision,
             content_hash = excluded.content_hash,
             tombstone = 0,
             generation = excluded.generation,
             updated_at = excluded.updated_at`,
        ).run(encoded, key[0] ?? "", revision, contentHash, guard.generation, Date.now())
        return revision
      })
      retire(previous)
      retire(contentHash)
      return result
    }

    function removePointer(key: string[], sessionID?: string, expectedGeneration?: number) {
      let previous: string | undefined
      const result = transaction(() => {
        if (sessionID !== undefined) {
          const guard = sessionGuard(sessionID)
          if (
            !guard ||
            guard.tombstone ||
            (expectedGeneration !== undefined && guard.generation !== expectedGeneration)
          ) {
            throw new SessionDeletedError(sessionID)
          }
        }
        const current = pointer(key)
        previous = current?.contentHash
        const revision = (current?.revision ?? 0) + 1
        db.query(
          `INSERT INTO storage_manifest
            (logical_key, namespace, revision, content_hash, tombstone, generation, updated_at)
           VALUES (?, ?, ?, NULL, 1, ?, ?)
           ON CONFLICT(logical_key) DO UPDATE SET
             revision = excluded.revision,
             content_hash = NULL,
             tombstone = 1,
             generation = excluded.generation,
             updated_at = excluded.updated_at`,
        ).run(
          logicalKey(key),
          key[0] ?? "",
          revision,
          sessionID === undefined ? 1 : sessionGuard(sessionID)!.generation,
          Date.now(),
        )
        if (maxBytes) db.query("DELETE FROM storage_sizes WHERE logical_key = ?").run(logicalKey(key))
        return revision
      })
      retire(previous)
      return result
    }

    function openBlob(key: string[]) {
      return transaction(() => {
        const current = pointer(key)
        if (!current || current.tombstone || !current.contentHash) return
        const fd = fsSync.openSync(path.join(blobDir, `${current.contentHash}.json`), "r")
        return { ...current, file: Bun.file(fd), close: () => fsSync.closeSync(fd) }
      })
    }

    return {
      pointer,
      openBlob,
      async collectGarbage(options: { dryRun: boolean; olderThan: number; maxBytes: number }) {
        if (!Number.isFinite(options.olderThan) || options.olderThan > Date.now() - 3_600_000) {
          throw new Error("Storage GC requires at least one hour of orphan grace")
        }
        if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("Invalid GC byte budget")
        if (!(await fs.lstat(blobDir)).isDirectory()) throw new Error("Storage blob directory must not be a symlink")
        const result = {
          scanned: 0,
          eligibleFiles: 0,
          eligibleBytes: 0,
          removedFiles: 0,
          removedBytes: 0,
          limited: false,
        }
        const referenced = db.query<{ present: number }, [string]>(
          "SELECT 1 AS present FROM storage_manifest WHERE content_hash = ? AND tombstone = 0 LIMIT 1",
        )
        const initialReferences = new Set(
          db
            .query<{ content_hash: string }, []>(
              "SELECT DISTINCT content_hash FROM storage_manifest WHERE tombstone = 0 AND content_hash IS NOT NULL",
            )
            .all()
            .map((row) => row.content_hash),
        )
        const directory = await fs.opendir(blobDir)
        for await (const entry of directory) {
          if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue
          result.scanned++
          if (initialReferences.has(entry.name.slice(0, -5))) continue
          const target = path.join(blobDir, entry.name)
          const initial = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error
          })
          if (!initial || !initial.isFile() || Math.max(initial.mtimeMs, initial.ctimeMs) >= options.olderThan) continue
          if (options.dryRun) {
            if (referenced.get(entry.name.slice(0, -5))) continue
            result.eligibleFiles++
            result.eligibleBytes += initial.size
            result.limited ||= result.eligibleBytes > options.maxBytes
            continue
          }
          // Recheck reachability and unlink under the SAME cross-process lock.
          transaction(() => {
            const stat = fsSync.lstatSync(target, { throwIfNoEntry: false })
            if (!stat?.isFile() || Math.max(stat.mtimeMs, stat.ctimeMs) >= options.olderThan) return
            if (referenced.get(entry.name.slice(0, -5))) return
            result.eligibleFiles++
            result.eligibleBytes += stat.size
            if (result.removedBytes + stat.size > options.maxBytes) {
              result.limited = true
              return
            }
            fsSync.unlinkSync(target)
            result.removedFiles++
            result.removedBytes += stat.size
          })
          if (result.limited || result.removedBytes >= options.maxBytes) {
            result.limited = true
            break
          }
        }
        return result
      },
      expireDiagnostics(olderThan: number, dryRun: boolean, replay = true) {
        if (!Number.isFinite(olderThan) || olderThan > Date.now() - 3_600_000)
          throw new Error("Invalid diagnostic expiry")
        const rows = transaction(() => {
          const rows = db
            .query<
              { logical_key: string; content_hash: string },
              [number, number]
            >("SELECT logical_key, content_hash FROM storage_manifest WHERE namespace IN ('request', 'session_event') AND tombstone = 0 AND (updated_at < ? OR (namespace = 'request' AND ? = 0))")
            .all(olderThan, replay ? 1 : 0)
          if (!dryRun) {
            for (const row of rows) {
              db.query(
                "UPDATE storage_manifest SET revision = revision + 1, content_hash = NULL, tombstone = 1, updated_at = ? WHERE logical_key = ?",
              ).run(Date.now(), row.logical_key)
            }
          }
          if (!dryRun && maxBytes)
            for (const row of rows) db.query("DELETE FROM storage_sizes WHERE logical_key = ?").run(row.logical_key)
          return rows
        })
        if (!dryRun) for (const row of rows) retire(row.content_hash)
        return { eligible: rows.length, removed: dryRun ? 0 : rows.length }
      },
      logicalKeys() {
        return new Set(
          db
            .query<{ logical_key: string }, []>("SELECT logical_key FROM storage_manifest")
            .all()
            .map((row) => row.logical_key),
        )
      },
      legacyImportComplete() {
        return (
          db
            .query<{ value: string }, [string]>("SELECT value FROM storage_meta WHERE key = ?")
            .get("legacy_import_complete")?.value === "1"
        )
      },
      markLegacyImportComplete() {
        db.query("INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)").run("legacy_import_complete", "1")
      },
      sessionGuard,
      activateSession(sessionID: string) {
        return transaction(() => {
          const current = sessionGuard(sessionID)
          if (current?.tombstone) throw new SessionDeletedError(sessionID)
          if (current) return current
          const now = Date.now()
          db.query(
            "INSERT INTO storage_session_guard (session_id, generation, tombstone, updated_at) VALUES (?, 1, 0, ?)",
          ).run(sessionID, now)
          return { generation: 1, tombstone: false }
        })
      },
      tombstoneSessions(sessionIDs: string[]) {
        return transaction(() => {
          const now = Date.now()
          for (const sessionID of new Set(sessionIDs)) {
            db.query(
              `INSERT INTO storage_session_guard (session_id, generation, tombstone, updated_at)
               VALUES (?, 1, 1, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 generation = CASE WHEN tombstone = 1 THEN generation ELSE generation + 1 END,
                 tombstone = 1,
                 updated_at = excluded.updated_at`,
            ).run(sessionID, now)
          }
          return sessionIDs.map((sessionID) => ({ sessionID, ...sessionGuard(sessionID)! }))
        })
      },
      backfillSessionGuards() {
        return transaction(() => {
          const rows = db
            .query<
              { logical_key: string },
              []
            >("SELECT logical_key FROM storage_manifest WHERE namespace = 'session' AND tombstone = 0")
            .all()
          const now = Date.now()
          for (const row of rows) {
            const key = parseLogicalKey(row.logical_key)
            const sessionID = key[2]
            if (!sessionID) continue
            db.query(
              `INSERT OR IGNORE INTO storage_session_guard
                (session_id, generation, tombstone, updated_at) VALUES (?, 1, 0, ?)`,
            ).run(sessionID, now)
          }
        })
      },
      blobPath(contentHash: string) {
        return path.join(blobDir, `${contentHash}.json`)
      },
      async read(key: string[]) {
        const opened = openBlob(key)
        if (!opened) return
        try {
          return {
            revision: opened.revision,
            contentHash: opened.contentHash,
            tombstone: false,
            content: await opened.file.text(),
          }
        } finally {
          opened.close()
        }
      },
      async replace(key: string[], content: string) {
        transaction(() => capacity(key, content))
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash, content)
      },
      async compareAndSwap(key: string[], expectedRevision: number, content: string) {
        transaction(() => capacity(key, content))
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash, content, expectedRevision)
      },
      async replaceGuarded(key: string[], sessionID: string, expectedGeneration: number | undefined, content: string) {
        transaction(() => capacity(key, content))
        const contentHash = await prepareBlob(content)
        return setPointerGuarded(key, contentHash, content, sessionID, expectedGeneration)
      },
      async compareAndSwapGuarded(
        key: string[],
        expectedRevision: number,
        sessionID: string,
        expectedGeneration: number | undefined,
        content: string,
      ) {
        transaction(() => capacity(key, content))
        const contentHash = await prepareBlob(content)
        return setPointerGuarded(key, contentHash, content, sessionID, expectedGeneration, expectedRevision)
      },
      remove(key: string[]) {
        return removePointer(key)
      },
      removeGuarded(key: string[], sessionID: string, expectedGeneration?: number) {
        return removePointer(key, sessionID, expectedGeneration)
      },
      list(prefix: string[]) {
        const encoded = logicalKey(prefix)
        const start = encoded.slice(0, -1) + ","
        const end = encoded.slice(0, -1) + "-"
        const rows = db
          .query<
            { logical_key: string },
            [string, string, string]
          >("SELECT logical_key FROM storage_manifest WHERE tombstone = 0 AND (logical_key = ? OR (logical_key >= ? AND logical_key < ?)) ORDER BY logical_key")
          .all(encoded, start, end)
        return rows
          .map((row) => parseLogicalKey(row.logical_key))
          .filter((key) => prefix.every((part, index) => key[index] === part))
          .sort((a, b) => logicalKey(a).localeCompare(logicalKey(b)))
      },
      async importLegacy(key: string[], content: string) {
        if (pointer(key)) return false
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash, content, 0, true) !== undefined
      },
      close() {
        db.close()
      },
    }
  }
}
