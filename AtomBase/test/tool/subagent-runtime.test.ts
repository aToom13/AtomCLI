import { describe, expect, test } from "bun:test"
import { SubAgentRuntime } from "@/integrations/tool/subagent-runtime"

describe("SubAgentRuntime", () => {
  const capabilities: SubAgentRuntime.Capabilities = {
    outputSchema: false,
    persona: true,
    toolFilter: true,
    depthLimit: true,
    continuation: true,
    cancellation: true,
  }

  test("rejects unsupported requirements before runtime execution", () => {
    let started = false
    expect(() => {
      SubAgentRuntime.negotiate("atom-inprocess", capabilities, ["outputSchema"])
      started = true
    }).toThrow("does not support: outputSchema")
    expect(started).toBe(false)
  })

  test("accepts supported runtime requirements", () => {
    expect(() => SubAgentRuntime.negotiate("atom-inprocess", capabilities, ["persona", "cancellation"])).not.toThrow()
  })
})
