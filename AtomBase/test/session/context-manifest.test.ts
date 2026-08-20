import { describe, expect, test } from "bun:test"
import { ContextManifest } from "@/core/session/context-manifest"

describe("ContextManifest", () => {
  test("keeps a relevant bounded view of large trees", () => {
    const tree = Array.from({ length: 200 }, (_, i) => i === 173 ? "src/auth/session.ts" : `src/generated/file-${i}.ts`).join("\n")
    const result = ContextManifest.selectTree(tree, "fix auth session", 20)
    expect(result).toContain("src/auth/session.ts")
    expect(result.split("\n").length).toBeLessThanOrEqual(20)
  })
})
