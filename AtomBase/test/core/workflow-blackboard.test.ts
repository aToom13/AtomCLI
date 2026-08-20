import { describe, expect, test } from "bun:test"
import { WorkflowBlackboard } from "@/core/orchestration/blackboard"

describe("WorkflowBlackboard", () => {
  test("extracts bounded typed artifacts", () => {
    const artifacts = WorkflowBlackboard.fromOutput("build", "Decision: use cache\nTests: passed\nChanged: src/a.ts")
    expect(artifacts.map((item) => item.kind)).toEqual(["summary", "decision", "test_result", "edited_file"])
    expect(WorkflowBlackboard.render(artifacts)).toContain("[decision]")
  })
})
