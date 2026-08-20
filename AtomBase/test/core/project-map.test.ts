import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { SemanticProjectMap } from "@/core/session/project-map"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SemanticProjectMap", () => {
  test("indexes symbols, imports, and test role", () => {
    const entry = SemanticProjectMap.parse(
      "test/auth/session.test.ts",
      `import { Session } from "@/auth/session"\nexport function verifiesToken() {}`,
    )
    expect(entry.symbols).toContain("verifiesToken")
    expect(entry.imports).toContain("@/auth/session")
    expect(entry.isTest).toBe(true)
  })

  test("ranks symbol matches even when the filename does not match", () => {
    const selected = SemanticProjectMap.select(
      [
        SemanticProjectMap.parse("src/a.ts", "export function authenticateUser() {}"),
        SemanticProjectMap.parse("src/auth.ts", "export function unrelated() {}"),
      ],
      "authenticate user",
    )
    expect(selected[0]?.path).toBe("src/a.ts")
  })

  test("indexes nested flat paths and refreshes same-size content changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const relative = "src/nested/service.ts"
    await Bun.write(path.join(tmp.path, relative), "export function firstSymbol() {}\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await SemanticProjectMap.get("firstSymbol", [relative])).toContain(relative)
        await Bun.write(path.join(tmp.path, relative), "export function otherSymbol() {}\n")
        expect(await SemanticProjectMap.get("otherSymbol", [relative])).toContain(relative)
        expect(await SemanticProjectMap.get("firstSymbol", [relative])).toBe("(no semantic matches)")
      },
    })
  })

  test("drops cached entries when an indexed file is deleted", async () => {
    await using tmp = await tmpdir({ git: true })
    const relative = "src/removable.ts"
    const absolute = path.join(tmp.path, relative)
    await Bun.write(absolute, "export function removableSymbol() {}\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await SemanticProjectMap.get("removableSymbol", [relative])).toContain(relative)
        await fs.unlink(absolute)
        expect(await SemanticProjectMap.get("removableSymbol", [relative])).toBe("(no semantic matches)")
      },
    })
  })
})
