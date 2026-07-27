import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { FindTool } from "./find"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { ChainUpdateTool } from "./chainupdate"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { SkillAddTool } from "./skilladd"
import { McpAddTool } from "./mcpadd"
import { MemoryTool } from "./memory"
import { TestGenTool } from "./test-gen"
import { DocsTool } from "./docs"
import { RefactorTool } from "./refactor"
import { ReviewTool } from "./review"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
import path from "path"
import { type ToolDefinition } from "@atomcli/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { FinanceAnalyzeTool } from "./finance"
import { Flag } from "@/interfaces/flag/flag"
import { Log } from "@/util/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { BrowserTool } from "./browser"
import { SystemHealthTool } from "./system-health"
import { SelfMaintenanceTool } from "./self-maintenance"
import { OrchestrateTool } from "./orchestrate"
import { AgentTool } from "./agent-tool"
import { TaskFlowTool } from "./taskflow"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("tool/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        const namespace = path.basename(match, path.extname(match))
        const mod = await import(match)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const result = await def.execute(args as any, ctx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      ...(Flag.ATOMCLI_CLIENT === "cli" ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      FindTool,
      GrepTool,
      EditTool,
      WriteTool,
      AgentTool,
      TaskTool,
      TaskFlowTool,
      WebFetchTool,
      WebSearchTool,
      CodeSearchTool,
      FinanceAnalyzeTool,
      SkillTool,
      SkillAddTool,
      McpAddTool,
      MemoryTool,
      BrowserTool,
      SystemHealthTool,
      SelfMaintenanceTool,

      OrchestrateTool,
      ...(Flag.ATOMCLI_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool !== false ? [BatchTool] : []),
      ...custom,
    ]
  }

  export const AGENT_TOOL_ALLOW_LISTS: Record<string, string[]> = {
    explore: ["read", "find", "grep", "bash", "webfetch", "websearch", "codesearch", "skill", "memory", "taskflow"],
    checker: ["read", "grep", "find", "bash", "webfetch", "websearch", "codesearch", "skill", "memory", "system_health", "taskflow"],
    reviewer: ["read", "find", "grep", "bash", "browser", "webfetch", "codesearch", "skill", "memory", "taskflow"],
    analyst: ["read", "find", "grep", "bash", "webfetch", "websearch", "codesearch", "finance_analyze", "skill", "memory", "taskflow"],
    documenter: ["read", "write", "edit", "find", "grep", "bash", "webfetch", "skill", "memory", "taskflow"],
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(providerID: string, agent?: Agent.Info) {
    const allTools = await all()
    const allowList = agent?.name ? AGENT_TOOL_ALLOW_LISTS[agent.name] : undefined

    let filteredTools = allTools.filter((t) => {
      if (t.id === "codesearch") {
        if (providerID !== "atomcli" && !Flag.ATOMCLI_ENABLE_EXA) return false
      }
      if (allowList) {
        return allowList.includes(t.id)
      }
      return true
    })

    if (allowList && filteredTools.length === 0) {
      log.warn("Agent tool allow list produced 0 tools, falling back to all tools", { agent: agent?.name })
      filteredTools = allTools
    }

    const result = await Promise.all(
      filteredTools.map(async (t) => {
        using _ = log.time(t.id)
        return {
          id: t.id,
          ...(await t.init({ agent })),
        }
      }),
    )
    return result
  }
}
