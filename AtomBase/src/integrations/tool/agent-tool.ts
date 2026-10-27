import z from "zod"
import { Tool } from "./tool"
import { TaskActions } from "./task"
import { ToolNotAppliedError } from "./runtime-error"
import { Agent } from "../agent/agent"
import { PermissionNext } from "@/util/permission/next"
import { Session } from "@/core/session"
import { SessionReuse } from "./session-reuse"
import { SubAgent } from "./subagent"
import { TaskSchema, RecoverySchema } from "./orchestrate/schema"
import { Instance } from "@/services/project/instance"
import { activeOwnershipRoot } from "./orchestrate/ownership"

const delegation = z.object({
  action: z
    .enum(["spawn", "workflow", "abort", "cancel", "wait", "steer", "revive", "status"])
    .default("spawn")
    .describe("Action: spawn, workflow, cancel/abort, wait, steer an idle child, revive a child, or status"),

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
  outputSchema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional supported JSON Schema for a validated machine-readable sub-agent result"),
  validationMode: z.enum(["strict", "permissive"]).optional().default("strict"),
  owns: z
    .array(z.string().max(4096))
    .max(200)
    .optional()
    .describe("Exclusive literal file/directory paths within the active ownership root; no globs"),
  isolation: z
    .enum(["auto", "required"])
    .optional()
    .default("auto")
    .describe(
      "auto uses Git worktrees when available, otherwise shared workspace with ownership/permission guards; required rejects non-Git plans without downgrade",
    ),

  // Parameters for action='workflow' (multi-step DAG)
  workflow_action: z
    .enum(["plan", "execute", "status", "abort", "recover"])
    .optional()
    .describe("Sub-action for workflow: 'plan', 'execute', 'status', 'abort', or evidence-backed 'recover'"),
  workflowId: z
    .string()
    .max(200)
    .optional()
    .describe("Workflow ID returned from action='workflow' with workflow_action='plan'"),
  tasks: z
    .array(TaskSchema)
    .max(50)
    .optional()
    .describe("Task DAG for workflow plan; independent tasks run concurrently"),
  recovery: RecoverySchema.optional(),

  session_id: z.string().max(200).optional().describe("Session ID to continue (spawn) or abort"),
  timeoutSeconds: z.number().int().min(1).max(600).optional().default(30).describe("Maximum wait duration"),
  executionTimeoutSeconds: z.number().int().min(1).max(3_600).optional().describe("Maximum child execution duration"),
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
  const parameters = z.union([...TaskActions.Atomic.options, delegation])
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
    `Active session workspace: ${Instance.directory}. Workflow ownership root: ${activeOwnershipRoot()}.`,
    "owns accepts absolute paths within that root or paths relative to it. Ownership does not grant file permissions.",
    "owns uses literal paths, not globs. List implementation and test files explicitly (wordCount.ts, wordCount.test.ts); preserve those names in the child prompt.",
    "Without Git isolation, owned children write with edit/write; shell commands require an OS read-only sandbox. The parent runs acceptance checks.",
    "isolation=auto uses Git worktrees when available, otherwise the guarded shared workspace. isolation=required needs a Git worktree and is rejected during planning outside Git; never downgrade a user requirement.",
    "Keep delegation within the user's target. A denied path must not be retried through another tool or child agent.",
    "",
    "⚠️ **BLOCKING TOOL**: action='spawn' BLOCKS until the sub-agent finishes. Tasks that",
    "change files or write code need tests and validation; independent reviewer QA is optional.",
    "When review is requested, use one reviewer; multiple reviewers require an explicit request. You CANNOT do other",
    'work while a spawn is running. Do not say "I\'ll also do X while sub-agents work".',
    "",
    "ACTIONS:",
    "1. action='spawn': Run a single sub-agent task (specify subagent_type, prompt, description).",
    "   Blocking with optional QA verification. This is the DEFAULT action.",
    "   Preserve the user's acceptance criteria in the child prompt; do not weaken functional or technical requirements.",
    "2. action='workflow': Execute a multi-task DAG workflow (workflow_action='plan'|'execute').",
    "   'plan' first, then 'execute' with the returned workflowId. Independent tasks share a parallel layer (up to 4).",
    "   Use 'status' to inspect unresolved tasks; 'recover' verifies root-created artifacts without replaying a failed child.",
    "   executionTimeoutSeconds limits each child attempt; timeoutSeconds only limits wait.",
    "3. action='cancel' (or legacy 'abort'): Cancel a running session or workflow.",
    "4. action='wait': Wait up to timeoutSeconds for a child lifecycle transition.",
    "5. action='steer': Continue an idle child with new guidance; active in-process turns must be cancelled or awaited first.",
    "6. action='revive': Continue a completed/failed child session with a new prompt.",
    "7. action='status': Return runtime status, timestamps, and elapsed time.",
    "One independent task: blocking spawn. Multiple independent tasks: workflow plan+execute; put dependencies in the DAG.",
    "",
    "Atomic Work profile: plan(tasks, acceptance), execute, status, verify(task_id, checks), revise. The durable ledger controls acceptance and dependencies; the same workflow scheduler runs the DAG.",
    "Dispatch is action-based: plan/execute/verify/revise always use the Atomic adapter and require a native Atomic root. During Atomic Work spawn/workflow/steer/revive are rejected. wait, targeted status, cancel/abort remain lifecycle controls; untargeted status reads the Atomic ledger.",
    "AVAILABLE SUB-AGENT TYPES:",
    agentList,
  ].join("\n")

  return {
    description,
    parameters,
    mutating: (params: z.infer<typeof parameters>) => params.action !== "status" && params.action !== "wait",
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (
        params.action === "plan" ||
        params.action === "execute" ||
        params.action === "verify" ||
        params.action === "revise"
      )
        return (await taskTool()).execute(params, ctx)
      if (params.action === "status" && !params.session_id && !params.workflowId && ctx.extra?.execution) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (ExecutionRuntime.atomicRoot(ctx.extra.execution.executionID))
          return (await taskTool()).execute({ action: "status" }, ctx)
      }

      if (ctx.extra?.execution && ["spawn", "workflow", "steer", "revive"].includes(params.action)) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (ExecutionRuntime.atomicRoot(ctx.extra.execution.executionID))
          throw new Error("ATOMIC_PLAN_REQUIRED: use agent plan/execute for Atomic Work children")
      }

      const ownedChildSession = async (sessionID: string) => {
        const session = await Session.get(sessionID).catch(() => null)
        if (!session) throw new ToolNotAppliedError(new Error(`Sub-agent session "${sessionID}" not found`))
        if (!SessionReuse.isAllowed(session, ctx.sessionID)) {
          throw new ToolNotAppliedError(new Error(`Session "${sessionID}" is not a child of the current session`))
        }
        return session
      }

      if (params.action === "workflow") {
        const orchestrateToolInstance = await orchestrateTool()
        const wfAction = params.workflow_action || (params.tasks ? "plan" : "execute")

        if (params.tasks) {
          for (const t of params.tasks) {
            // Must mirror OrchestrateTool's default (orchestrate.ts: `agent: t.agent || "coder"`),
            // otherwise tasks without an explicit agent bypass the spawn permission gate.
            const agent = t.agent ?? "coder"
            if (wfAction === "plan" && !ctx.extra?.bypassAgentCheck) {
              await ctx.ask({
                permission: "task",
                patterns: [agent],
                always: ["*"],
                metadata: { description: t.id, subagent_type: agent },
              })
            }
          }
        }

        const result = await orchestrateToolInstance.execute(
          {
            action: wfAction as any,
            workflowId: params.workflowId,
            tasks: params.tasks as any,
            recovery: params.recovery,
          },
          ctx,
        )
        if (wfAction === "plan")
          result.output = result.output.replace(
            'orchestrate(action="execute",',
            'agent(action="workflow", workflow_action="execute",',
          )
        return result
      }

      if (params.action === "abort" || params.action === "cancel") {
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
          const status = SubAgent.status(params.session_id)
          const elapsedMs = Math.max(
            0,
            (status.status === "running" ? Date.now() : status.updatedAt) - status.startedAt,
          )
          return {
            title: "Task Status",
            output: `Session ${params.session_id} is ${status.status}.\nTitle: ${session.title}\nRuntime: ${status.runtime}\nElapsed: ${elapsedMs}ms`,
            metadata: { ...status, elapsedMs, capabilities: SubAgent.capabilities(status.runtime) },
          }
        }
        throw new Error("Parameter 'workflowId' or 'session_id' is required for action='status'")
      }

      if (params.action === "wait") {
        if (!params.session_id) throw new Error("Parameter 'session_id' is required for action='wait'")
        const session = await ownedChildSession(params.session_id)
        const status = await SubAgent.wait(params.session_id, {
          timeoutMs: params.timeoutSeconds * 1_000,
          signal: ctx.abort,
        })
        const messages = await Session.messages({ sessionID: params.session_id, limit: 20, excludePatches: true })
        const lastOutput = messages
          .toReversed()
          .find((message) => message.info.role === "assistant")
          ?.parts.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n\n")
        return {
          title: "Task Wait",
          output: `Session ${params.session_id} is ${status.status}.\nTitle: ${session.title}${lastOutput ? `\n\n${lastOutput}` : ""}`,
          metadata: status,
        }
      }

      if (params.action === "steer" || params.action === "revive") {
        if (!params.session_id) throw new Error(`Parameter 'session_id' is required for action='${params.action}'`)
        await ownedChildSession(params.session_id)
        const status = SubAgent.status(params.session_id)
        if (params.action === "steer" && status.status === "running") {
          throw new Error("The atom-inprocess runtime cannot steer an active turn; wait for it or cancel it first")
        }
      }

      // ─── spawn / idle steer / revive: single blocking task with reviewer QA ───
      if (!params.subagent_type || !params.prompt || !params.description) {
        throw new Error("subagent_type, prompt, and description are required when starting a task")
      }
      if (params.session_id) await ownedChildSession(params.session_id)

      // Delegate to a single-task blocking workflow: OrchestrateTool plan + execute.
      // This gives spawn the orchestrator behavior: optional reviewer QA, retries, Chain UI
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
              owns: params.owns,
              outputSchema: params.outputSchema,
              validationMode: params.validationMode,
              isolation: params.isolation,
              executionTimeoutSeconds: params.executionTimeoutSeconds,
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
