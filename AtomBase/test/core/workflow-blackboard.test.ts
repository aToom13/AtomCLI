import { describe, expect, test } from "bun:test"
import { WorkflowBlackboard } from "@/core/orchestration/blackboard"

describe("WorkflowBlackboard", () => {
  test("extracts bounded typed artifacts", () => {
    const artifacts = WorkflowBlackboard.fromOutput("build", "Decision: use cache\nTests: passed\nChanged: src/a.ts")
    expect(artifacts.map((item) => item.kind)).toEqual(["summary", "decision", "test_result", "edited_file"])
    expect(WorkflowBlackboard.render(artifacts)).toContain("[decision]")
  })

  test("prefers structured evidence and reports conflicting keyed claims", () => {
    const first = WorkflowBlackboard.fromOutput(
      "a",
      `<agent_result>{"summary":"one","facts":[{"key":"runtime","value":"bun","evidence":["package.json:4"]}],"confidence":0.9}</agent_result>`,
    )
    const second = WorkflowBlackboard.fromOutput(
      "b",
      `<agent_result>{"summary":"two","facts":[{"key":"runtime","value":"node"}],"confidence":0.5}</agent_result>`,
    )
    expect(first.find((item) => item.kind === "fact")).toMatchObject({
      key: "runtime",
      content: "bun",
      evidence: ["package.json:4"],
    })
    expect(WorkflowBlackboard.conflicts([...first, ...second])).toHaveLength(1)
  })

  test("falls back safely when an agent result violates the contract", () => {
    const artifacts = WorkflowBlackboard.fromOutput(
      "bad",
      `<agent_result>{"facts":[null],"confidence":"high"}</agent_result>`,
    )
    expect(() => WorkflowBlackboard.render(artifacts)).not.toThrow()
    expect(artifacts.every((item) => typeof item.content === "string")).toBe(true)
  })
})
