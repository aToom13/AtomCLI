import "../preload"
import { describe, expect, test } from "bun:test"
import { RepairPlanner } from "@/core/execution/repair-planner"

describe("RepairPlanner", () => {
  test("changes strategy for schema failures", () => {
    const advice = RepairPlanner.classify("Validation error: expected string", "browser")
    expect(advice.kind).toBe("schema")
    expect(advice.retryable).toBe(true)
    expect(RepairPlanner.annotate("Validation error", "browser")).toContain("[repair:schema]")
  })

  test("does not blindly retry permission rejection", () => {
    expect(RepairPlanner.classify("Permission denied")).toMatchObject({ kind: "permission", retryable: false })
    expect(
      RepairPlanner.classify("Write path is outside task ownership: /tmp/test-agents/word-count.ts"),
    ).toMatchObject({ kind: "permission", retryable: false })
  })

  test("classifies missing modules as dependency failures", () => {
    expect(RepairPlanner.classify("ECONNRESET")).toMatchObject({ kind: "transient", retryable: true })
    expect(RepairPlanner.classify("Module not found: foo")).toMatchObject({ kind: "dependency", retryable: true })
  })

  test("a missing JSON filename is discovery failure, not malformed JSON", () => {
    for (const file of ["config/settings.json", "parser/settings.json"])
      expect(RepairPlanner.classify(`File not found: /project/${file}`, "read")).toMatchObject({
        kind: "not_found",
        strategy: expect.stringContaining("Refresh"),
      })
    for (const message of ["JSON Parse error: unexpected identifier", "Invalid JSON", "Failed to parse JSON"])
      expect(RepairPlanner.classify(message, "read")).toMatchObject({ kind: "schema" })
  })

  test("gives edit-specific recovery based on failure state", () => {
    expect(
      RepairPlanner.classify("Use either oldString/newString or operations; mixed edits are not applied", "edit"),
    ).toMatchObject({
      kind: "schema",
      retryable: true,
      strategy: expect.stringContaining("Remove the other mode's fields"),
    })
    expect(RepairPlanner.annotate("Stale edit: anchored content changed", "edit")).toContain("[repair:stale]")
    expect(RepairPlanner.classify("oldString not found in content", "edit").strategy).toContain("already have applied")
    expect(
      RepairPlanner.classify("Tool edit completed its operation, but post-processing failed", "edit"),
    ).toMatchObject({
      retryable: false,
    })
  })

  test("classifies edit stale/not-found failures without an explicit tool name", () => {
    expect(RepairPlanner.classify(new Error("stale edit: changed"))).toMatchObject({ kind: "stale", retryable: true })
    expect(RepairPlanner.classify(new Error("oldString not found in content"))).toMatchObject({ kind: "not_found" })
    expect(RepairPlanner.classify(new Error("stale edit: changed"), "edit-anchor")).toMatchObject({ kind: "stale" })
  })

  test("reads the nested cause chain when classifying", () => {
    const nested = new Error("wrapper failure", { cause: new Error("invalid argument: expected string") })
    expect(RepairPlanner.classify(nested)).toMatchObject({ kind: "schema", retryable: true })
    const deep = new Error("outer", { cause: new Error("middle", { cause: new Error("ECONNRESET") }) })
    expect(RepairPlanner.classify(deep)).toMatchObject({ kind: "transient" })
  })
})
