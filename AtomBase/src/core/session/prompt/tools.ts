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

export function requestedToolIDs(allowedTools: string[] | undefined, loadAll: boolean) {
  if (allowedTools !== undefined)
    return new Set([...allowedTools, "model_control", "scope_control", "skill", "invalid"])
  return loadAll ? undefined : new Set(["model_control", "scope_control", "skill", "invalid"])
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
  if (atomicWork) requestedTools?.add("task")

  // The visible `todo` checklist is only advertised for non-direct scopes and
  // only when the prompt actually asks for one. Direct turns stay tool-free and
  // must never gain a coordination/checklist surface.
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
  for (const item of await ToolRegistry.tools(input.model.providerID, input.agent, requestedTools, atomicWork)) {
    if (atomicExecution && item.id === "taskflow" && !input.checkpointRequired) continue
    if (atomicExecution && ["agent", "orchestrate"].includes(item.id)) continue
    if (item.id === "model_control" && input.session.parentID) continue
    const schema = z.toJSONSchema(item.parameters)
    if (item.id === "edit") {
      // Native revisions own freshness; legacy direct callers retain explicit hashes and range anchors.
      for (const shape of [schema, (schema.properties?.operations as typeof schema)?.items as typeof schema])
        for (const field of ["contentHash", "startAnchor", "endAnchor"]) delete shape?.properties?.[field]
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

  if (reviewer || !loadAll || allowedTools) return tools
  const mcpAbort = new AbortController()
  const mcpTimer = setTimeout(() => {
    mcpAbort.abort()
    log.debug("MCP tools are still initializing; skipping them for this turn")
  }, 250)
  const mcpTools = await MCP.tools(mcpAbort.signal, input.loadedMcpNames).catch(() => {
    input.loadedMcpNames.clear()
    return {}
  })
  clearTimeout(mcpTimer)
  for (const [key, item] of Object.entries(mcpTools)) {
    const execute = item.execute
    if (!execute) continue
    item.execute = async (args, opts) => {
      const ctx = context(args, opts)
      return ToolRuntime.execute({
        tool: key,
        args,
        context: ctx,
        permission: async (_nextArgs, nextContext) =>
          nextContext.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] }),
        execute: async (nextArgs, nextContext) => {
          const result = await execute(nextArgs, { ...opts, abortSignal: nextContext.abort })
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
    }
    item.toModelOutput = (result) => ({ type: "text", value: result.output })
    tools[key] = item
  }
  return tools
}
