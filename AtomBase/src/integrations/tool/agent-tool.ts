import z from "zod"
import { Tool } from "./tool"
import { Agent } from "../agent/agent"
import { PermissionNext } from "@/util/permission/next"
import { Session } from "@/core/session"
import { SessionStatus } from "@/core/session/status"
import { SessionReuse } from "./session-reuse"

const parameters = z.object({
  action: z
    .enum(["spawn", "workflow", "abort", "status"])
    .default("spawn")
    .describe(
      "Action to perform: 'spawn' for a single blocking sub-agent task, 'workflow' for a multi-task DAG, 'abort' to cancel, 'status' to check progress",
    ),

  // Parameters for action='spawn' (single sub-agent task, blocking)
  subagent_type: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("The specialized agent type to use (e.g., 'explore', 'coder', 'checker') for action='spawn'"),
  prompt: z
    .string()
    .min(1)
    .max(100_000)
    .optional()
    .describe("The task prompt for the agent to perform (for action='spawn')"),
  description: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("A short (3-5 words) description of the task (for action='spawn')"),
  model: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Exact provider/model for action='spawn'; otherwise the agent's configured model or router selection is used",
    ),

  // Parameters for action='workflow' (multi-step DAG)
  workflow_action: z
    .enum(["plan", "execute", "status", "abort"])
    .optional()
    .describe("Sub-action for workflow: 'plan', 'execute', 'status', or 'abort'"),
  workflowId: z
    .string()
    .max(200)
    .optional()
    .describe("Workflow ID returned from action='workflow' with workflow_action='plan'"),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        prompt: z.string().min(1).max(100_000),
        category: z.enum(["coding", "documentation", "analysis", "general"]).optional(),
        dependsOn: z.array(z.string().max(100)).max(50).optional(),
        agent: z.string().max(100).optional(),
        model: z.string().max(200).optional(),
      }),
    )
    .max(50)
    .optional()
    .describe("Task list for action='workflow' plan"),

  session_id: z.string().max(200).optional().describe("Session ID to continue (spawn) or abort"),
})

/**
 * Stable, filesystem-safe task id derived from the human-readable description.
 * Repeated spawns with the same description reuse the same sub-agent session
 * (context continuity via OrchestrateTool's AGENT_SESSION_MAP).
 */
const safeTaskId = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "task"

export const AgentTool = Tool.define("agent", async (ctx) => {
  let taskToolPromise: ReturnType<(typeof import("./task"))["TaskTool"]["init"]> | undefined
  let orchestrateToolPromise: ReturnType<(typeof import("./orchestrate"))["OrchestrateTool"]["init"]> | undefined
  const taskTool = () => (taskToolPromise ??= import("./task").then((mod) => mod.TaskTool.init(ctx)))
  const orchestrateTool = () =>
    (orchestrateToolPromise ??= import("./orchestrate").then((mod) => mod.OrchestrateTool.init(ctx)))

  // List accessible sub-agent types so the LLM knows valid subagent_type values
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission ?? []).action !== "deny")
    : agents
  const agentList = accessibleAgents
    .map((a) => `- ${a.name}: ${a.description ?? "Sub-agent for delegated work."}`)
    .join("\n")

  const description = [
    "Unified Agent tool — the single tool for running sub-agents and multi-step workflows.",
    "",
    "⚠️ **BLOCKING TOOL**: action='spawn' BLOCKS until the sub-agent finishes. Tasks that",
    "change files or write code receive independent reviewer QA; read-only investigation does not",
    "spawn a redundant reviewer. Rejected reviewed work is auto-retried up to 2 times. You CANNOT do other",
    'work while a spawn is running. Do not say "I\'ll also do X while sub-agents work".',
    "",
    "ACTIONS:",
    "1. action='spawn': Run a single sub-agent task (specify subagent_type, prompt, description).",
    "   Blocking with adaptive QA verification. This is the DEFAULT action.",
    "2. action='workflow': Execute a multi-task DAG workflow (workflow_action='plan'|'execute').",
    "   'plan' first, then 'execute' with the returned workflowId.",
    "3. action='abort': Cancel a running sub-agent session or workflow (specify session_id or workflowId)",
    "4. action='status': Check workflow or sub-agent status (specify workflowId or session_id)",
    "",
    "AVAILABLE SUB-AGENT TYPES:",
    agentList,
  ].join("\n")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const ownedChildSession = async (sessionID: string) => {
        const session = await Session.get(sessionID).catch(() => null)
        if (!session) throw new Error(`Sub-agent session "${sessionID}" not found`)
        if (!SessionReuse.isAllowed(session, ctx.sessionID)) {
          throw new Error(`Session "${sessionID}" is not a child of the current session`)
        }
        return session
      }

      if (params.action === "workflow") {
        const orchestrateToolInstance = await orchestrateTool()
        const wfAction = params.workflow_action || (params.tasks ? "plan" : "execute")

        // Permission gate — the same "task" permission that guards spawn must also
        // guard the workflow path, otherwise agent(action='workflow', tasks=[...])
        // would bypass the sub-agent spawn control entirely.
        if (params.tasks && !ctx.extra?.bypassAgentCheck) {
          for (const t of params.tasks) {
            // Must mirror OrchestrateTool's default (orchestrate.ts: `agent: t.agent || "coder"`),
            // otherwise tasks without an explicit agent bypass the spawn permission gate.
            const agent = t.agent ?? "coder"
            await ctx.ask({
              permission: "task",
              patterns: [agent],
              always: ["*"],
              metadata: {
                description: t.id,
                subagent_type: agent,
              },
            })
          }
        }

        return orchestrateToolInstance.execute(
          {
            action: wfAction as any,
            workflowId: params.workflowId,
            tasks: params.tasks as any,
          },
          ctx,
        )
      }

      if (params.action === "abort") {
        if (params.workflowId) {
          const orchestrateToolInstance = await orchestrateTool()
          return orchestrateToolInstance.execute({ action: "abort", workflowId: params.workflowId }, ctx)
        }
        if (!params.session_id) throw new Error("Parameter 'session_id' or 'workflowId' is required for action='abort'")
        await ownedChildSession(params.session_id)
        const taskToolInstance = await taskTool()
        return taskToolInstance.execute({ action: "abort", session_id: params.session_id }, ctx)
      }

      if (params.action === "status") {
        if (params.workflowId) {
          const orchestrateToolInstance = await orchestrateTool()
          return orchestrateToolInstance.execute({ action: "status", workflowId: params.workflowId }, ctx)
        }
        if (params.session_id) {
          const session = await ownedChildSession(params.session_id)
          const status = SessionStatus.get(params.session_id)
          const retry = status.type === "retry" ? ` (attempt ${status.attempt}: ${status.message})` : ""
          return {
            title: "Task Status",
            output: `Session ${params.session_id} is ${status.type}${retry}.\nTitle: ${session.title}`,
            metadata: { sessionId: params.session_id, status: status.type },
          }
        }
        throw new Error("Parameter 'workflowId' or 'session_id' is required for action='status'")
      }

      // ─── action === "spawn": single sub-agent task, BLOCKING with reviewer QA ───
      if (!params.subagent_type || !params.prompt || !params.description) {
        throw new Error("subagent_type, prompt, and description are required when starting a task")
      }

      // Permission gate — same permission id as TaskTool.run so existing rules keep working
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

      // Delegate to a single-task blocking workflow: OrchestrateTool plan + execute.
      // This gives spawn the orchestrator behavior: reviewer QA gate, retries, Chain UI
      // progress, and results written to .atomcli/runs/<workflowId>/.
      const taskId = safeTaskId(params.description)
      const orchestrateToolInstance = await orchestrateTool()
      const planResult = await orchestrateToolInstance.execute(
        {
          action: "plan",
          tasks: [
            {
              id: taskId,
              prompt: params.prompt,
              agent: params.subagent_type,
              model: params.model,
              sessionId: params.session_id,
            },
          ],
        },
        ctx,
      )

      const workflowId = planResult.metadata?.workflowId
      if (planResult.metadata?.error || !workflowId) {
        return planResult
      }

      return orchestrateToolInstance.execute({ action: "execute", workflowId }, ctx)
    },
  }
})
