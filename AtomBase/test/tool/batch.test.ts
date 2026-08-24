import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { Identifier } from "@/core/id/id"
import { BatchTool } from "@/integrations/tool/batch"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const context = () => ({
  sessionID: Identifier.ascending("session"),
  messageID: Identifier.ascending("message"),
  callID: Identifier.ascending("part"),
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

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

  test("executes multiple read-only tools and records their outcomes", async () => {
    await using tmp = await tmpdir({ git: true, config: { plugin: [] } })
    await Bun.write(path.join(tmp.path, "batch-fixture.txt"), "batch execution works\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BatchTool.init({})
        const result = await tool.execute(
          {
            tool_calls: [
              { tool: "read", parameters: { filePath: "batch-fixture.txt" } },
              { tool: "find", parameters: { pattern: "**/*.txt" } },
            ],
          },
          context(),
        )

        expect(result.title).toBe("Batch execution (2/2 successful)")
        expect(result.metadata).toMatchObject({
          totalCalls: 2,
          successful: 2,
          failed: 0,
          tools: ["read", "find"],
        })
        expect(result.metadata.details).toEqual([
          { tool: "read", success: true },
          { tool: "find", success: true },
        ])
      },
    })
  })
})
