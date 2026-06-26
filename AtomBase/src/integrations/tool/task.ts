import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "@/core/session"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { MessageV2 } from "@/core/session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "@/core/session/prompt"
import { iife } from "@/util/util/iife"
import { SubAgent } from "./subagent"
import { WorkflowFS } from "./workflow-fs"

import { Config } from "@/core/config/config"
import { PermissionNext } from "@/util/permission/next"

const parameters = z.object({
  action: z.enum(["run", "abort"]).optional().describe("Defaults to run. Set to abort to kill a session_id"),
  description: z.string().optional().describe("A short (3-5 words) description of the task. Required for run."),
  prompt: z.string().optional().describe("The task for the agent to perform. Required for run."),
  subagent_type: z
    .string()
    .optional()
    .describe("The type of specialized agent to use for this task. Required for run."),
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
        } catch {
          /* ignore */
        }
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

      // Build permissions using shared utility
      const experimentalPermissions = (config.experimental?.primary_tools ?? []).map((t) => ({
        pattern: "*",
        action: "allow" as const,
        permission: t,
      }))
      const permissions = SubAgent.buildPermissions(parentPermissions, experimentalPermissions)

      // Create/reuse session (done before background detach for part tracking)
      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) {
            try {
              await Bus.publish(TuiEvent.SubAgentReactivate, {
                sessionId: found.id,
                description: params.description,
              })
            } catch {
              /* TUI may not be available */
            }
            return found
          }
        }
        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: permissions,
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
      } catch {
        /* TUI may not be available */
      }

      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
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

      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // ─── NON-BLOCKING: Start sub-agent in background, return immediately ───
      const runInBackground = async () => {
        try {
          const result = await SubAgent.spawn({
            parentSessionID: ctx.sessionID,
            agent,
            model,
            parts: promptParts,
            permissions,
            description: params.description!,
            sessionId: session.id, // Reuse the session we already created
            deniedTools: Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
          })

          unsub()

          // Write results to file — no system_notification, parent LLM stays asleep
          const taskRunId = `task_${session.id}`
          await WorkflowFS.writeSuccess(taskRunId, params.subagent_type!, params.subagent_type!, result.output)
        } catch (e) {
          unsub()
          // Write failure file — no system_notification
          try {
            const taskRunId = `task_${session.id}`
            await WorkflowFS.writeFailed(taskRunId, params.subagent_type!, params.subagent_type!, (e as Error).message)
          } catch {
            /* file write failure is non-critical */
          }
        }
      }

      // Detach execution — do NOT await
      setTimeout(runInBackground, 0)

      // Return immediately — main agent is free to continue
      return {
        title: params.description,
        metadata: {
          summary: [],
          sessionId: session.id,
          error: false,
          aborted: 0,
        },
        output: `Task "${params.description}" started in background (@${params.subagent_type}, session: ${session.id}). Results will be written to \`.atomcli/runs/task_${session.id}/\` when complete. Continue chatting with the user.`,
      }
    },
  }
})
