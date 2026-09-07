import { describe, expect, test } from "bun:test"
import "../preload"
import fs from "fs/promises"
import path from "path"
import { StorageBackup } from "@/core/storage/backup"
import { tmpdir } from "../fixture/fixture"

describe("storage backup", () => {
  test("verifies a backup and restores it without changing the source", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    const backup = path.join(tmp.path, "backup")
    const restore = path.join(tmp.path, "restore")
    await fs.mkdir(path.join(source, "session", "project"), { recursive: true })
    await Bun.write(path.join(source, "session", "project", "one.json"), JSON.stringify({ id: "one" }))

    const created = await StorageBackup.createLegacy(source, backup, 123)
    expect(created.createdAt).toBe(123)
    expect(await StorageBackup.restore({ backupDir: backup, destination: restore, dryRun: true })).toEqual({
      files: 1,
      applied: false,
    })
    expect(await StorageBackup.restore({ backupDir: backup, destination: restore })).toEqual({
      files: 1,
      applied: true,
    })
    expect(await Bun.file(path.join(restore, "session", "project", "one.json")).json()).toEqual({ id: "one" })
  })

  test("rejects corruption before restore and preserves the backup", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    const backup = path.join(tmp.path, "backup")
    await fs.mkdir(source, { recursive: true })
    await Bun.write(path.join(source, "one.json"), JSON.stringify({ id: "one" }))
    await StorageBackup.createLegacy(source, backup)
    await Bun.write(path.join(backup, "records", "one.json"), JSON.stringify({ id: "changed" }))

    await expect(
      StorageBackup.restore({ backupDir: backup, destination: path.join(tmp.path, "restore") }),
    ).rejects.toThrow("integrity check failed")
    expect(await Bun.file(path.join(backup, "manifest.json")).exists()).toBe(true)
  })

  test("preserves an invalid legacy JSON record for recovery", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    const backup = path.join(tmp.path, "backup")
    await fs.mkdir(source, { recursive: true })
    await Bun.write(path.join(source, "broken.json"), "{not-json")

    const created = await StorageBackup.createLegacy(source, backup)
    expect(created.files).toHaveLength(1)
    expect(await Bun.file(path.join(backup, "records", "broken.json")).text()).toBe("{not-json")
    expect(await Bun.file(path.join(source, "broken.json")).text()).toBe("{not-json")
  })
})
