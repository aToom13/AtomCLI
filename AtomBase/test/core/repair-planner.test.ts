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
  })

  test("classifies missing modules as dependency failures", () => {
    expect(RepairPlanner.classify("Module not found: foo")).toMatchObject({ kind: "dependency", retryable: true })
  })
})
