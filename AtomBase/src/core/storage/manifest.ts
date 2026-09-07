import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"

const FORMAT_VERSION = 1
export const STORAGE_UPDATE_RETRIES = 32

type Row = {
  logical_key: string
  revision: number
  content_hash: string | null
  tombstone: number
}

export namespace StorageManifest {
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

  export async function open(dir: string) {
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

    function setPointer(key: string[], contentHash: string, expectedRevision?: number) {
      const encoded = logicalKey(key)
      return transaction(() => {
        const current = pointer(key)
        if (expectedRevision === 0) {
          if (current !== undefined) return undefined
        } else if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
          return undefined
        }
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
      sessionID: string,
      expectedGeneration?: number,
      expectedRevision?: number,
    ) {
      const encoded = logicalKey(key)
      return transaction(() => {
        const guard = sessionGuard(sessionID)
        if (!guard || guard.tombstone) throw new SessionDeletedError(sessionID)
        if (expectedGeneration !== undefined && guard.generation !== expectedGeneration) {
          throw new SessionDeletedError(sessionID)
        }
        const current = pointer(key)
        if (expectedRevision === 0) {
          if (current !== undefined) return undefined
        } else if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
          return undefined
        }
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
    }

    function removePointer(key: string[], sessionID?: string, expectedGeneration?: number) {
      return transaction(() => {
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
        return revision
      })
    }

    return {
      pointer,
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
        const current = pointer(key)
        if (!current || current.tombstone || !current.contentHash) return
        return {
          ...current,
          content: await Bun.file(path.join(blobDir, `${current.contentHash}.json`)).text(),
        }
      },
      async replace(key: string[], content: string) {
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash)
      },
      async compareAndSwap(key: string[], expectedRevision: number, content: string) {
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash, expectedRevision)
      },
      async replaceGuarded(key: string[], sessionID: string, expectedGeneration: number | undefined, content: string) {
        const contentHash = await prepareBlob(content)
        return setPointerGuarded(key, contentHash, sessionID, expectedGeneration)
      },
      async compareAndSwapGuarded(
        key: string[],
        expectedRevision: number,
        sessionID: string,
        expectedGeneration: number | undefined,
        content: string,
      ) {
        const contentHash = await prepareBlob(content)
        return setPointerGuarded(key, contentHash, sessionID, expectedGeneration, expectedRevision)
      },
      remove(key: string[]) {
        return removePointer(key)
      },
      removeGuarded(key: string[], sessionID: string, expectedGeneration?: number) {
        return removePointer(key, sessionID, expectedGeneration)
      },
      list(prefix: string[]) {
        const rows = db
          .query<
            { logical_key: string },
            [string]
          >("SELECT logical_key FROM storage_manifest WHERE namespace = ? AND tombstone = 0 ORDER BY logical_key")
          .all(prefix[0] ?? "")
        return rows
          .map((row) => parseLogicalKey(row.logical_key))
          .filter((key) => prefix.every((part, index) => key[index] === part))
          .sort((a, b) => logicalKey(a).localeCompare(logicalKey(b)))
      },
      async importLegacy(key: string[], content: string) {
        if (pointer(key)) return false
        const contentHash = await prepareBlob(content)
        return setPointer(key, contentHash, 0) !== undefined
      },
      close() {
        db.close()
      },
    }
  }
}
