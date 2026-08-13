import { describe, expect, test } from "bun:test"
import { BatchTool } from "@/integrations/tool/batch"

describe("BatchTool", () => {
  test("bounds the number of concurrent tool requests", async () => {
    const tool = await BatchTool.init({})
    const tool_calls = Array.from({ length: 11 }, () => ({ tool: "read", parameters: {} }))

    expect(tool.parameters.safeParse({ tool_calls }).success).toBe(false)
  })

  test("documents the read-only execution boundary", async () => {
    const tool = await BatchTool.init({})

    expect(tool.description).toContain("Only read-only tools")
    expect(tool.description).toContain("Up to four")
  })
})
