import { describe, expect, test } from "bun:test"
import { SessionSummary } from "@/core/session/summary"

describe("session local titles", () => {
  test("creates a title without an auxiliary model request", () => {
    expect(SessionSummary.localTitle("  Selam\n\nAtomCLI  ")).toBe("Selam AtomCLI")
  })

  test("removes hidden reasoning and bounds long titles", () => {
    const title = SessionSummary.localTitle(`<think>internal</think>${"a".repeat(120)}`)
    expect(title).toHaveLength(100)
    expect(title?.endsWith("...")).toBe(true)
    expect(title).not.toContain("internal")
  })

  test("summarizes changed files locally without another model request", () => {
    expect(
      SessionSummary.localDiffSummary([
        { file: "src/a.ts", before: "", after: "", additions: 3, deletions: 1 },
        { file: "src/b.ts", before: "", after: "", additions: 2, deletions: 4 },
      ]),
    ).toBe("Changed 2 files (+5/-5): src/a.ts, src/b.ts")
  })
})
