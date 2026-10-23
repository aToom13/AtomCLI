import "../preload"
import { expect, spyOn, test } from "bun:test"
import { McpTools } from "@/integrations/tool/mcp-tools"
import { MCP } from "@/integrations/mcp"
import { Agent } from "@/integrations/agent/agent"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { resolveTools } from "@/core/session/prompt/tools"
import { tmpdir } from "../fixture/fixture"

test("207 tools remain discoverable, load explicitly, survive instance disposal, recheck schemas and permissions", async () => {
  await using tmp = await tmpdir({ git: true, config: { permission: { rea_tool_000: "deny" } } })
  const { jsonSchema } = await import("ai")
  const available = Object.fromEntries(
    Array.from({ length: 207 }, (_, i) => [
      `rea_tool_${String(i).padStart(3, "0")}`,
      {
        description: "MCP operation " + "documentation ".repeat(260),
        inputSchema: jsonSchema({ type: "object", properties: { value: { type: "string" } } }),
        execute: async () => ({ content: [{ type: "text", text: "executed" }] }),
      },
    ]),
  ) as McpTools.Available
  let listing = available
  const list = spyOn(MCP, "tools").mockImplementation(async () => listing)
  let sessionID = ""
  let selectedHash = ""
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        sessionID = session.id
        const agent = (await Agent.get("agent"))!
        const model = {
          id: "fixture",
          providerID: "test",
          api: { id: "fixture", npm: "@ai-sdk/openai" },
          limit: { context: 64000, output: 4096 },
        } as never
        const context = {
          sessionID,
          messageID: Identifier.ascending("message"),
          agent: "agent",
          abort: new AbortController().signal,
          extra: { model, userTools: { rea_tool_001: false } },
          metadata() {},
          ask: async () => {},
        }
        const tool = await McpTools.Info.init()
        const ids: string[] = []
        let offset: number | null = 0
        while (offset !== null) {
          const page = JSON.parse((await tool.execute({ action: "list", offset }, context)).output)
          expect(page.total).toBe(205)
          for (const item of page.tools) expect(item.description.length).toBeLessThanOrEqual(160)
          ids.push(...page.tools.map((item: { id: string }) => item.id))
          offset = page.nextOffset
        }
        expect(new Set(ids).size).toBe(205)
        expect(ids).not.toContain("rea_tool_000")
        expect(ids).not.toContain("rea_tool_001")
        const input = {
          agent,
          model,
          session,
          tools: context.extra.userTools,
          processor: { message: { id: context.messageID }, partFromToolCall: () => undefined } as never,
          bypassAgentCheck: false,
          hasPriorToolActivity: false,
          loadedMcpNames: new Set<string>(),
          prompt: "Arbitrary task without keywords",
        }
        const initial = await resolveTools(input)
        expect(initial.mcp_tools).toBeDefined()
        expect(Object.keys(initial).filter((id) => id.startsWith("rea_"))).toEqual([])
        await tool.execute({ action: "load", ids: ["rea_tool_002", "rea_tool_003"] }, context)
        const loaded = await resolveTools(input)
        expect(loaded.rea_tool_002).toBeDefined()
        expect(loaded.rea_tool_003).toBeDefined()
        expect(Object.keys(loaded).filter((id) => id.startsWith("rea_"))).toHaveLength(2)
        expect(await McpTools.schemaTokens((await McpTools.selected(sessionID, available)).tools)).toBeLessThan(
          (await McpTools.schemaTokens(available)) / 50,
        )
        await expect(tool.execute({ action: "load", ids: ["rea_tool_000"] }, context)).rejects.toThrow(
          "unavailable or denied",
        )
        await expect(tool.execute({ action: "load", ids: ids.slice(0, 50) }, context)).rejects.toThrow("budget")
        expect(Object.keys(await McpTools.selection(sessionID))).toHaveLength(2)
        selectedHash = (await McpTools.selection(sessionID)).rea_tool_002
        listing = { ...available, rea_tool_002: { ...available.rea_tool_002, description: "Schema changed" } }
        const stale = await resolveTools(input)
        expect(stale.rea_tool_002).toBeUndefined()
        expect(stale.mcp_tools.description).toContain("rea_tool_002")
        await expect(
          loaded.rea_tool_002.execute!({}, { toolCallId: "stale", messages: [], abortSignal: context.abort }),
        ).rejects.toThrow("changed or is no longer permitted")
        await tool.execute({ action: "load", ids: ["rea_tool_002"] }, context)
        expect((await McpTools.selection(sessionID)).rea_tool_002).not.toBe(selectedHash)
        const other = await Session.create({ parentID: sessionID })
        expect(await McpTools.selection(other.id)).toEqual({})
        const hidden = await McpTools.permitted({ sessionID: other.id, agent, available })
        expect(hidden.rea_tool_000).toBeUndefined()
        await expect(tool.execute({ action: "list" }, { ...context, agent: "reviewer" })).rejects.toThrow("reviewers")
        await Instance.dispose()
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Object.keys(await McpTools.selection(sessionID))).toHaveLength(2)
        listing = {} // Disconnected tools remain selected, visibly stale, never callable.
        expect((await McpTools.selected(sessionID, listing)).stale).toHaveLength(2)
        expect(Object.keys(await McpTools.selection(sessionID))).toHaveLength(2)
        listing = available
        const agent = (await Agent.get("agent"))!
        const tool = await McpTools.Info.init()
        await tool.execute(
          { action: "unload", ids: ["rea_tool_002"] },
          {
            sessionID,
            messageID: "test",
            agent: agent.name,
            abort: new AbortController().signal,
            metadata() {},
            ask: async () => {},
          },
        )
        expect(Object.keys(await McpTools.selection(sessionID))).toEqual(["rea_tool_003"])
        await Session.remove(sessionID)
        expect(await McpTools.selection(sessionID)).toEqual({})
      },
    })
  } finally {
    list.mockRestore()
  }
}, 30000)
