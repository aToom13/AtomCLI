import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import { Storage } from "@/core/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("storage migrations", () => {
  test("does not advance the migration marker after a failed migration", async () => {
    await using tmp = await tmpdir()
    const marker = path.join(tmp.path, "migration")

    await expect(
      Storage._internals.runMigrations(tmp.path, 0, [
        async () => {
          throw new Error("intentional migration failure")
        },
      ]),
    ).rejects.toThrow("intentional migration failure")

    expect(await Bun.file(marker).exists()).toBe(false)

    await Storage._internals.runMigrations(tmp.path, 0, [async () => {}])
    expect(await Bun.file(marker).text()).toBe("1")
  })
})
