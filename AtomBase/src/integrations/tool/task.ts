import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "@/core/session"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "@/core/session/prompt"
import { iife } from "@/util/util/iife"
import { defer } from "@/util/util/defer"
import { Config } from "@/core/config/config"
import { PermissionNext } from "@/util/permission/next"

const parameters = z.object({
  action: z.enum(["run", "abort"]).optional().describe("Defaults to run. Set to abort to kill a session_id"),
  description: z.string().optional().describe("A short (3-5 words) description of the task. Required for run."),
  prompt: z.string().optional().describe("The task for the agent to perform. Required for run."),
  subagent_type: z.string().optional().describe("The type of specialized agent to use for this task. Required for run."),
  session_id: z.string().describe("Existing Task session to continue, or to abort").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "abort") {
        if (!params.session_id) throw new Error("session_id is required to abort a task")
        SessionPrompt.cancel(params.session_id)
        try {
          await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: params.session_id })
        } catch { /* ignore */ }
        return {
          title: "Abort Successful",
          output: `Aborted and removed session ${params.session_id} from UI.`,
          metadata: { error: false, aborted: 1, summary: [], sessionId: params.session_id },
        }
      }

      if (!params.description || !params.prompt || !params.subagent_type) {
        throw new Error("description, prompt, and subagent_type are required when starting a task")
      }

      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Get parent session for permission inheritance
      const parentSession = await Session.get(ctx.sessionID).catch(() => null)
      const parentPermissions = parentSession?.permission ?? []

      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => { })
          if (found) {
            // Reactivate existing session - notify TUI
            try {
              await Bus.publish(TuiEvent.SubAgentReactivate, {
                sessionId: found.id,
                description: params.description,
              })
            } catch { /* TUI may not be available */ }
            return found
          }
        }

        // Base permissions for subagents (deny tools that shouldn't be nested)
        const subagentBasePermissions: PermissionNext.Rule[] = [
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny" as const,
          },
          {
            permission: "todoread",
            pattern: "*",
            action: "deny" as const,
          },
          {
            permission: "task",
            pattern: "*",
            action: "deny" as const,
          },
        ]

        // Inherit parent permissions (but subagent base permissions take precedence)
        const inheritedPermissions = PermissionNext.merge(parentPermissions, subagentBasePermissions)

        // Add experimental primary_tools if configured
        const experimentalPermissions = (config.experimental?.primary_tools ?? []).map((t) => ({
          pattern: "*",
          action: "allow" as const,
          permission: t,
        }))

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: PermissionNext.merge(inheritedPermissions, experimentalPermissions),
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
        },
      })

      // Notify TUI to open dynamic sub-agent panel for this session
      try {
        await Bus.publish(TuiEvent.SubAgentActive, {
          sessionId: session.id,
          agentType: params.subagent_type,
          description: params.description,
        })
      } catch { /* TUI may not be available */ }

      const messageID = Identifier.ascending("message")
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          task: false,
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })
      unsub()
      const messages = await Session.messages({ sessionID: session.id })
      const summary = messages
        .filter((x) => x.info.role === "assistant")
        .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
        .map((part) => ({
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }))
      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      // Notify TUI that sub-agent finished (mark as waiting, keep visible, pass output for context)
      try {
        await Bus.publish(TuiEvent.SubAgentDone, {
          sessionId: session.id,
          lastOutput: text.slice(0, 2000), // Truncate for UI but full text goes to orchestrator
        })
      } catch { /* TUI may not be available */ }

      return {
        title: params.description,
        metadata: {
          summary,
          sessionId: session.id,
          error: false,
          aborted: 0,
        },
        output: text,
      }
    },
  }
})
