import { describe, test, expect } from "bun:test"
import { ExecutionTrace } from "@/core/session/trace"

describe("ExecutionTrace", () => {
  test("records and retrieves trace events in memory", () => {
    const sessionID = `test-trace-${Date.now()}`
    ExecutionTrace.clear(sessionID)

    ExecutionTrace.record(sessionID, {
      stepIndex: 0,
      event: "step_start",
    })

    ExecutionTrace.record(sessionID, {
      stepIndex: 0,
      event: "tool_call",
      tool: "read",
      args: { path: "index.ts" },
    })

    const records = ExecutionTrace.get(sessionID)
    expect(records.length).toBe(2)
    expect(records[0].event).toBe("step_start")
    expect(records[1].tool).toBe("read")
  })

  test("clears trace records for a session", () => {
    const sessionID = `test-trace-clear-${Date.now()}`
    ExecutionTrace.record(sessionID, { stepIndex: 0, event: "step_start" })
    expect(ExecutionTrace.get(sessionID).length).toBe(1)

    ExecutionTrace.clear(sessionID)
    expect(ExecutionTrace.get(sessionID).length).toBe(0)
  })
})
