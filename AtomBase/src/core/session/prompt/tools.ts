import z from "zod"
import type { Tool as AITool, ToolCallOptions } from "ai"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { ProviderTransform } from "@/integrations/provider/transform"
import { MCP } from "@/integrations/mcp"
import { PermissionNext } from "@/util/permission/next"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionProcessor } from "../processor"
import { ToolRegistry } from "@/integrations/tool/registry"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { Tool } from "@/integrations/tool/tool"
import { McpTools } from "@/integrations/tool/mcp-tools"
import { ToolNotAppliedError } from "@/integrations/tool/runtime-error"
import { Identifier } from "@/core/id/id"
import { PromptContext } from "./context"
import { getJsonSchema, getTool } from "@/util/util/ai-compat"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "session.prompt.tools" })

/** Returns true if the prompt indicates a need for a visible todo checklist. */
function needsTodoPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  // Turkish stems: "görev" (task), "yapılacak(lar)" (to-do / things to do), "liste" (list).
  return /\b(?:todo|to[- ]?do|checklist|liste|g\u00f6rev|yap\u0131lacak|g\u00f6revler|task)\b/i.test(lower)
}

export function shouldLoadMcpTools(input: { prompt: string; loadAll: boolean; reviewer: boolean }) {
  return !input.reviewer
}

export function requestedToolIDs(allowedTools: string[] | undefined, loadAll: boolean) {
  if (allowedTools !== undefined)
    return new Set([...allowedTools, "model_control", "scope_control", "mcp_tools", "skill", "invalid"])
  return loadAll ? undefined : new Set(["model_control", "scope_control", "mcp_tools", "skill", "invalid"])
}

export function filterTurnTools<T>(
  tools: Record<string, T>,
  input: {
    checkpointRequired?: boolean
    expert?: boolean
    pendingSkills?: boolean
  },
) {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => {
      const reason = input.checkpointRequired
        ? "checkpoint"
        : input.expert && !["read", "grep", "find"].includes(name)
          ? "expert_read_only"
          : input.pendingSkills &&
              ![
                "read",
                "grep",
                "find",
                "skill",
                "todo",
                "scope_control",
                "model_control",
                "question",
                "invalid",
              ].includes(name)
            ? "skill_reads_pending"
            : undefined
      if (reason) log.debug("Pruning tool for turn", { tool: name, reason })
      return !reason
    }),
  )
}

export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  hasPriorToolActivity: boolean
  loadedMcpNames: Set<string>
  prompt: string
  execution?: import("@/core/execution/runtime").ExecutionRuntime.Context
  checkpointRequired?: boolean
}) {
  using _ = log.time("resolveTools")
  const explicitTools = Object.values(input.tools ?? {}).some((enabled) => enabled === true)
  const loadAll = PromptContext.shouldLoadTools({
    providerID: input.model.providerID,
    prompt: input.prompt,
    explicitTools,
    bypassAgentCheck: input.bypassAgentCheck,
    hasPriorToolActivity: input.hasPriorToolActivity,
  })
  const tools: Record<string, AITool> = {}
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const reviewer = Boolean(input.execution && ExecutionRuntime.isReviewer(input.execution))
  const allowedTools =
    input.execution && !reviewer
      ? ExecutionRuntime.getExecutionPolicy(input.execution.executionID)?.allowedTools
      : undefined
  const atomicExecution = Boolean(input.execution && ExecutionRuntime.atomicRoot(input.execution.executionID))
  const atomicWork = !input.session.parentID && atomicExecution
  const requestedTools = requestedToolIDs(allowedTools, loadAll || atomicWork || reviewer)
  if (atomicWork) requestedTools?.add("agent")

  // The visible `todo` checklist is only advertised for non-direct scopes and
  // only when the prompt actually asks for one. Direct turns must never gain a
  // coordination/checklist surface.
  const scope = input.execution ? ExecutionRuntime.getExecutionContract(input.execution.executionID)?.scope : undefined
  if (scope && scope !== "direct" && needsTodoPrompt(input.prompt)) {
    requestedTools?.add("todo")
  }

  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      execution: input.execution,
      checkpointRequired: input.checkpointRequired,
      userPrompt: input.prompt,
      userTools: input.tools,
    },
    agent: input.agent.name,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        })
      }
    },
    async ask(req) {
      const latestSession = await Session.get(input.session.id)
      if (latestSession.parentID) {
        const parent = await Session.get(latestSession.parentID)
        const denied = req.patterns
          .map((pattern) => PermissionNext.evaluate(req.permission, pattern, parent.permission ?? []))
          .filter((rule) => rule.action === "deny")
        if (denied.length) throw new PermissionNext.DeniedError(denied)
      }
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, latestSession.permission ?? []),
      })
    },
  })

  const tool = await getTool()
  const jsonSchema = await getJsonSchema()
  for (const item of await ToolRegistry.tools(input.model.providerID, input.agent, requestedTools)) {
    if (item.id === "mcp_tools" && (reviewer || input.agent.name === "reviewer")) continue
    if (atomicExecution && item.id === "taskflow" && !input.checkpointRequired) continue
    if (atomicExecution && ["task", "orchestrate"].includes(item.id)) continue
    if (atomicExecution && item.id === "agent" && !atomicWork) continue
    if (item.id === "model_control" && input.session.parentID) continue
    const schema = z.toJSONSchema(item.parameters)
    if (item.id === "edit") {
      // Native revisions own freshness; legacy direct callers retain explicit hashes and range anchors.
      for (const shape of [schema, (schema.properties?.operations as typeof schema)?.items as typeof schema])
        for (const field of ["contentHash", "startAnchor", "endAnchor"]) delete shape?.properties?.[field]
      // Advertise one edit mode; native callers and persisted legacy calls still accept single-edit fields.
      for (const field of ["oldString", "newString", "replaceAll"]) delete schema.properties?.[field]
      schema.required = [...new Set([...(schema.required ?? []), "operations"])]
      schema.properties.operations = { ...(schema.properties.operations as typeof schema), minItems: 1 }
    }
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(ProviderTransform.schema(input.model, schema) as any),
      async execute(args, options) {
        const ctx = context(args, options)
        return ToolRuntime.execute({
          tool: item.id,
          args,
          context: ctx,
          mutating: item.mutating,
          effects: item.effects,
          execute: (nextArgs, nextContext) => item.execute(nextArgs, nextContext),
        })
      },
      toModelOutput(result) {
        return { type: "text", value: result.output }
      },
    })
  }

  // MCP tools are discovered outside ToolRegistry. A policy allowlist only
  // narrows native tools; treating its presence as a veto silently removes
  // every connected MCP from focused/coordinated turns.
  if (reviewer || input.agent.name === "reviewer") return tools
  // Local MCP transports can take several seconds to start (for example, an
  // npx-backed stdio server). Let MCP's configured connection timeout govern
  // startup; a short prompt-side timer made every first turn lose its tools.
  const mcpTools = await MCP.tools(undefined, input.loadedMcpNames).catch((error) => {
    input.loadedMcpNames.clear()
    log.warn("MCP tools unavailable for turn", { error: error instanceof Error ? error.message : String(error) })
    return {}
  })
  const available = await McpTools.permitted({
    sessionID: input.session.id,
    agent: input.agent,
    tools: input.tools,
    available: mcpTools,
  })
  if (!Object.keys(available).length) delete tools.mcp_tools
  const selected = await McpTools.selected(input.session.id, available)
  const schemaBudget = Math.min(McpTools.MAX_SCHEMA_TOKENS, Math.floor(input.model.limit.context / 4))
  const overBudget = (await McpTools.schemaTokens(selected.tools)) > schemaBudget
  if (overBudget && tools.mcp_tools)
    tools.mcp_tools.description += ` BLOCKED: loaded schemas exceed this model's ${schemaBudget} estimated-token budget. Selections retained; unload tools explicitly to resume dispatch.`
  if (tools.mcp_tools)
    tools.mcp_tools.description += ` Available: ${Object.keys(available).length}. Stale selections requiring reload: ${selected.stale.join(", ") || "none"}.`
  for (const [key, item] of Object.entries(overBudget ? {} : selected.tools)) {
    const execute = item.execute
    if (!execute) continue
    // MCP.tools caches tool objects; wrapping a copy keeps repeated turns from nesting runtime middleware.
    const wrapped = {
      ...item,
      execute: async (args: any, opts: ToolCallOptions) => {
        const ctx = context(args, opts)
        return ToolRuntime.execute({
          tool: key,
          args,
          context: ctx,
          permission: async (_nextArgs, nextContext) =>
            nextContext.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] }),
          // MCP tools can affect an external service, but they do not own the
          // AtomCLI workspace. Keep them in execution recovery without sending
          // them through file ownership guards.
          mutating: true,
          effects: {
            workspace: "none",
            external: "write",
            reversible: false,
            destructive: false,
            privileged: false,
          },
          execute: async (nextArgs, nextContext) => {
            const latest = await McpTools.permitted({
              sessionID: input.session.id,
              agent: input.agent,
              tools: input.tools,
              available: await MCP.tools(nextContext.abort),
            })
            if (!latest[key] || (await McpTools.digest(latest[key])) !== (await McpTools.digest(item)))
              throw new ToolNotAppliedError(
                new Error(`MCP tool changed or is no longer permitted: ${key}; refresh catalog and load again`),
              )
            const result = await latest[key].execute!(nextArgs, { ...opts, abortSignal: nextContext.abort })
            const textParts: string[] = []
            const attachments: MessageV2.FilePart[] = []
            for (const contentItem of result.content) {
              if (contentItem.type === "text") textParts.push(contentItem.text)
              else if (contentItem.type === "image") {
                attachments.push({
                  id: Identifier.ascending("part"),
                  sessionID: input.session.id,
                  messageID: input.processor.message.id,
                  type: "file",
                  mime: contentItem.mimeType,
                  url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                })
              }
            }
            return {
              title: "",
              metadata: result.metadata ?? {},
              output: textParts.join("\n\n"),
              attachments,
              content: result.content,
            }
          },
        })
      },
      toModelOutput: (result: ToolRuntime.Result) => ({ type: "text", value: result.output }),
    } as AITool
    tools[key] = wrapped
  }
  return tools
}
