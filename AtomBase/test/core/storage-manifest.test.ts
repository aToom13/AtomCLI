import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import fs from "fs/promises"
import { Storage } from "@/core/storage/storage"
import { StorageManifest } from "@/core/storage/manifest"
import { tmpdir } from "../fixture/fixture"

const worker = path.join(import.meta.dir, "storage-worker.ts")

async function runWorker(operation: string, key: string[], value?: number, startAt?: number, home?: string) {
  const child = Bun.spawn(
    [process.execPath, "run", worker, operation, JSON.stringify(key), String(value ?? 0), String(startAt ?? 0)],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...process.env, ...(home ? { ATOMCLI_TEST_HOME: home } : {}) },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ])
  if (exitCode !== 0) throw new Error(`Storage worker failed (${exitCode}): ${stderr}`)
  return stdout
}

describe("storage manifest", () => {
  test("records a completed legacy import and indexes known keys without reading blobs", async () => {
    await using tmp = await tmpdir()
    const manifest = await StorageManifest.open(tmp.path)
    try {
      expect(manifest.legacyImportComplete()).toBe(false)
      await manifest.importLegacy(["session", "project", "session"], '{"id":"session"}')
      expect(manifest.logicalKeys()).toContain(StorageManifest.logicalKey(["session", "project", "session"]))
      manifest.markLegacyImportComplete()
      expect(manifest.legacyImportComplete()).toBe(true)
    } finally {
      manifest.close()
    }
  })

  test("opens an interrupted legacy cutover immediately and imports only requested records", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const dir = path.join(home, ".atomcli", "data", "storage")
    await fs.mkdir(path.join(dir, "project"), { recursive: true })
    await Bun.write(path.join(dir, "project", "wanted.json"), '{"id":"wanted"}')
    await Bun.write(path.join(dir, "project", "untouched.json"), '{"id":"untouched"}')
    const manifest = await StorageManifest.open(dir)
    manifest.close()

    expect(await runWorker("read", ["project", "wanted"], 0, 0, home)).toBe('{"id":"wanted"}')

    const reopened = await StorageManifest.open(dir)
    try {
      expect(reopened.pointer(["project", "wanted"])).toBeDefined()
      expect(reopened.pointer(["project", "untouched"])).toBeUndefined()
    } finally {
      reopened.close()
    }
  })

  test("invalidates a warm read cache after another process replaces a record", async () => {
    const key = ["storage-race", crypto.randomUUID()]
    await Storage.write(key, { value: 1 })
    expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 1 })

    await runWorker("write", key, 2)

    expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 2 })
  })

  test("does not lose concurrent updates from two processes", async () => {
    const key = ["storage-race", crypto.randomUUID()]
    await Storage.write(key, { value: 0 })
    const startAt = Date.now() + 250

    await Promise.all([runWorker("increment", key, 30, startAt), runWorker("increment", key, 30, startAt)])

    expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 60 })
  })

  test("a cross-process tombstone prevents cached and legacy resurrection", async () => {
    const key = ["storage-race", crypto.randomUUID()]
    await Storage.write(key, { value: 1 })
    expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 1 })

    await runWorker("remove", key)

    await expect(Storage.read(key)).rejects.toBeInstanceOf(Storage.NotFoundError)
    expect(await Storage.list(["storage-race"])).not.toContainEqual(key)
  })
})
