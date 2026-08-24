import "../preload"
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
    isolation: true,
    wait: true,
    steer: false,
    revive: true,
    status: true,
    liveActivity: true,
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

  const schema = SubAgentRuntime.parseSchema({
    type: "object",
    properties: {
      status: { type: "string", enum: ["success", "failed"] },
      changedFiles: { type: "array", items: { type: "string" } },
    },
    required: ["status", "changedFiles"],
  })

  test("strictly validates a tagged structured result", () => {
    const result = SubAgentRuntime.validateOutput(
      'Completed.\n<structured_output>{"status":"success","changedFiles":["src/a.ts"]}</structured_output>',
      schema,
      "strict",
    )
    expect(result).toEqual({
      success: true,
      data: { status: "success", changedFiles: ["src/a.ts"] },
    })
  })

  test("reports structured validation failures with exact paths", () => {
    const result = SubAgentRuntime.validateOutput(
      '<structured_output>{"status":"unknown","extra":true}</structured_output>',
      schema,
      "strict",
    )
    expect(result.success).toBe(false)
    if (!("error" in result)) return
    expect(result.error.code).toBe("OUTPUT_VALIDATION_FAILED")
    expect(result.error.issues).toContainEqual({ path: "$.changedFiles", message: "required property is missing" })
    expect(result.error.issues).toContainEqual({ path: "$.extra", message: "additional property is not allowed" })
  })

  test("permissive mode accepts a bare JSON result and unknown keys", () => {
    const result = SubAgentRuntime.validateOutput(
      '{"status":"success","changedFiles":[],"providerDetail":"kept"}',
      schema,
      "permissive",
    )
    expect(result.success).toBe(true)
  })

  test("rejects unsupported schemas before a sub-agent starts", () => {
    expect(() => SubAgentRuntime.parseSchema({ type: "object", oneOf: [] })).toThrow("unsupported JSON Schema")
  })
})
