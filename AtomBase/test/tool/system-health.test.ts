import { describe, expect, test } from "bun:test"
import { SystemHealthTool } from "@/integrations/tool/system-health"

const context = {
  sessionID: "system-health-test",
  messageID: "system-health-message",
  agent: "checker",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("SystemHealthTool", () => {
  test("exposes diagnostics only", async () => {
    const tool = await SystemHealthTool.init({})

    expect(tool.parameters.safeParse({ action: "kill", pid: 1 }).success).toBe(false)
    expect(tool.parameters.safeParse({ action: "optimize" }).success).toBe(false)
    expect(tool.description).toContain("never terminates processes")
  })

  test("reports portable CPU, memory, and platform information", async () => {
    const tool = await SystemHealthTool.init({})
    const result = await tool.execute({ action: "check" }, context)

    expect(result.title).toBe("System Health Check")
    expect(result.metadata.cpuCount).toBeGreaterThan(0)
    expect(result.metadata.platform).toBe(process.platform)
    expect(result.output).toContain("Memory:")
  })
})
