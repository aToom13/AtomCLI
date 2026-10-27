import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "@/core/session"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { MessageV2 } from "@/core/session/message-v2"
import { Agent } from "../agent/agent"
import { resolvePromptParts } from "@/core/session/prompt/parts"
import { iife } from "@/util/util/iife"
import { SubAgent } from "./subagent"
import { SessionReuse } from "./session-reuse"
import { WorkflowFS } from "./workflow-fs"
import { SubAgentIsolation } from "./subagent-isolation"
import { HarnessState } from "@/core/session/harness-state"

import { Config } from "@/core/config/config"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { runAutomaticTaskChecks } from "@/core/execution/task-verification"
import { AtomicWork } from "./atomic-work"
import { TaskDispatch } from "./task-dispatch"
import { Lock } from "@/util/util/lock"
import type { ExecutionLedger } from "@/core/execution/ledger"
import { ReviewV2 } from "@/core/verification/review-v2"
import { AtomicPlan } from "@/core/execution/atomic-plan"

const fields = z.object({
  action: z
    .enum(["run", "abort", "verify", "revise", "plan", "execute", "status"])
    .optional()
    .describe("Defaults to run. Set to abort, verify, or revise a tracked task"),
  description: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("A short (3-5 words) description of the task. Required for run."),
  prompt: z.string().min(1).max(100_000).optional().describe("The task for the agent to perform. Required for run."),
  subagent_type: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("The type of specialized agent to use for this task. Required for run."),
  session_id: z.string().max(200).describe("Existing Task session to continue, or to abort").optional(),
  command: z.string().max(10_000).describe("The command that triggered this task").optional(),
  task_id: z.string().min(1).max(200).optional().describe("Stable task ID for durable execution tracking"),
  tasks: AtomicWork.Tasks.optional(),
  expectedVersion: z.number().int().positive().optional().describe("Expected ledger version for revision"),
  amendment: AtomicWork.Amendment.optional(),
  definition: AtomicWork.DefinitionChange.optional(),
  skill: z.string().min(1).max(200).optional().describe("Skill assigned to this task"),
  depends_on: z.array(z.string().min(1).max(200)).max(100).optional().describe("Task IDs that must finish first"),
  acceptance: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        description: z.string().min(1).max(2_000),
        verification: z.enum(["automatic", "reviewer", "parent"]).optional(),
        command: z.string().min(1).max(10_000).optional(),
      }),
    )
    .max(100)
    .optional()
    .describe("Acceptance criteria checked after the agent submits"),
  checks: z
    .array(
      z.object({
        criterionID: z.string().min(1).max(100),
        verifier: z.enum(["automatic", "reviewer", "parent"]),
        passed: z.boolean(),
        evidence: z.string().min(1).max(10_000),
        runtime: ReviewV2.AcceptanceCheck.optional().describe(
          "For Atomic Work parent checks: exact criterion, setup/action/expected/observed, and successful tool calls from this revision",
        ),
      }),
    )
    .max(100)
    .optional()
    .describe("Verification results for action='verify'"),
})

// Each action exposes only its own fields; planning cannot carry revision placeholders.
const parameters = z.discriminatedUnion("action", [
  fields
    .pick({
      description: true,
      prompt: true,
      subagent_type: true,
      session_id: true,
      command: true,
      task_id: true,
      skill: true,
      depends_on: true,
      acceptance: true,
    })
    .extend({ action: z.literal("run").optional().default("run") })
    .strict(),
  z
    .object({
      action: z.literal("plan"),
      tasks: AtomicWork.Tasks.min(1),
      acceptance: z.array(AtomicPlan.Acceptance).min(1).max(100),
    })
    .strict(),
  z.object({ action: z.literal("execute") }).strict(),
  z.object({ action: z.literal("status") }).strict(),
  fields
    .pick({ task_id: true, checks: true, expectedVersion: true })
    .extend({ action: z.literal("verify"), task_id: fields.shape.task_id.unwrap() })
    .strict(),
  fields
    .pick({
      task_id: true,
      tasks: true,
      expectedVersion: true,
      amendment: true,
      definition: true,
      acceptance: true,
      prompt: true,
      description: true,
    })
    .extend({ action: z.literal("revise") })
    .strict(),
  fields
    .pick({ task_id: true })
    .extend({ action: z.literal("abort"), session_id: fields.shape.session_id })
    .strict(),
])

export namespace TaskActions {
  export const Atomic = z.discriminatedUnion("action", [
    parameters.options[1],
    parameters.options[2],
    parameters.options[4],
    parameters.options[5],
  ])
}

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
    mutating: (params: z.output<typeof parameters>) => params.action !== "status",
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "plan" || params.action === "execute" || params.action === "status")
        return AtomicWork.action(params, ctx)
      if (params.action === "revise" && ctx.extra?.execution) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const target = params.task_id
          ? await ExecutionRuntime.getTask({
              sessionID: ctx.sessionID,
              execution: ctx.extra.execution,
              taskID: params.task_id,
            })
          : undefined
        if (
          (target && AtomicWork.isTask(target, ctx.extra.execution.executionID)) ||
          (!params.task_id && ExecutionRuntime.atomicRoot(ctx.extra.execution.executionID))
        )
          return AtomicWork.action(params, ctx)
      }
      if (params.action === "abort") {
        if (!params.session_id) throw new Error("session_id is required to abort a task")
        const child = await Session.get(params.session_id).catch(() => undefined)
        if (!SessionReuse.isAllowed(child, ctx.sessionID))
          throw new Error(`Session "${params.session_id}" is not a child of the current session`)
        await SubAgent.cancel(params.session_id)
        const execution = ctx.extra?.execution
        if (execution) {
          try {
            const { ExecutionRuntime } = await import("@/core/execution/runtime")
            const taskID = params.task_id ?? `task_${params.session_id}`
            const task = await ExecutionRuntime.getTask({ sessionID: ctx.sessionID, execution, taskID })
            if (task && !["accepted", "failed", "cancelled"].includes(task.status)) {
              await ExecutionRuntime.transitionTask({
                sessionID: ctx.sessionID,
                execution,
                taskID,
                expectedVersion: task.version,
                status: "cancelled",
                evidence: "Task aborted by parent",
              })
            }
          } catch {
            /* preserve abort behavior when no active execution is available */
          }
        }
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

      if (params.action === "verify") {
        if (!params.task_id) throw new Error("task_id is required to verify a task")
        const execution = ctx.extra?.execution
        if (!execution) throw new Error("Task verification requires an active execution")
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const task = await ExecutionRuntime.getTask({ sessionID: ctx.sessionID, execution, taskID: params.task_id })
        if (!task) throw new Error(`Task "${params.task_id}" was not found`)
        const atomic = AtomicWork.isTask(task, execution.executionID)
        if (atomic && params.expectedVersion !== undefined && params.expectedVersion !== task.version)
          throw new Error("STALE_TASK: stale_version")
        const automatic = task.acceptance.filter((criterion) => criterion.verification === "automatic")
        const suppliedChecks = params.checks ?? []
        if (automatic.some((criterion) => !criterion.command)) {
          throw new Error("Automatic acceptance criterion is missing a command")
        }
        for (const criterion of automatic) {
          await ctx.ask({
            permission: "bash",
            patterns: [criterion.command ?? ""],
            always: ["*"],
            metadata: { description: `Verify task ${params.task_id}`, command: criterion.command },
          })
        }
        if (suppliedChecks.some((check) => automatic.some((criterion) => criterion.id === check.criterionID))) {
          throw new Error("Automatic acceptance checks are produced by the harness")
        }
        if (suppliedChecks.some((check) => !task.acceptance.some((criterion) => criterion.id === check.criterionID))) {
          throw new Error("Verification references an unknown acceptance criterion")
        }
        if (atomic && suppliedChecks.some((check) => check.verifier !== "parent"))
          throw new Error("Atomic Work reviewer and automatic checks are produced by the harness")
        const supplied = suppliedChecks.filter(
          (check): check is ExecutionLedger.TaskCheckInput => check.verifier !== "automatic",
        )
        if (atomic && supplied.length) {
          const messages = await Session.messages({ sessionID: ctx.sessionID, excludePatches: true })
          for (const check of suppliedChecks) {
            const criterion = task.acceptance.find((item) => item.id === check.criterionID)!
            if (check.passed) {
              if (!check.runtime || check.runtime.criterion !== criterion.description)
                throw new Error("Atomic Work parent acceptance requires runtime evidence for the exact criterion")
              const error = ReviewV2.validateAcceptanceCheck(
                check.runtime,
                messages,
                task.submittedAt ?? task.updatedAt,
              )
              if (error) throw new Error(`Atomic Work parent acceptance: ${error}`)
              check.evidence = JSON.stringify(check.runtime)
            }
          }
        }
        const automaticChecks = await runAutomaticTaskChecks(
          task.acceptance,
          atomic ? Instance.directory : Instance.worktree,
          atomic ? { sessionID: ctx.sessionID, execution, taskID: task.id, expectedVersion: task.version } : undefined,
        )
        const parentMessage = atomic
          ? await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
          : undefined
        const reviewed =
          atomic && parentMessage?.info.role === "assistant"
            ? await AtomicWork.reviewerChecks(task, ctx, {
                providerID: parentMessage.info.providerID,
                modelID: parentMessage.info.modelID,
              })
            : { checks: [] as ExecutionLedger.TaskCheckInput[], reviewerID: undefined }
        if (!supplied.length && !automaticChecks.length && !reviewed.checks.length)
          throw new Error("checks are required to verify a task")
        using _verificationLock = atomic ? await Lock.write(`execution-tasks:${execution.executionID}`) : undefined
        if (atomic)
          await ExecutionRuntime.assertAtomicReady({
            sessionID: ctx.sessionID,
            execution,
            taskID: task.id,
            expectedVersion: task.version,
          })
        let current = task
        if (current.status === "submitted") {
          current = await ExecutionRuntime.transitionTask({
            sessionID: ctx.sessionID,
            execution,
            taskID: params.task_id,
            expectedVersion: current.version,
            status: "verifying",
          })
        }
        const verified = await ExecutionRuntime.recordTaskVerification({
          sessionID: ctx.sessionID,
          execution,
          taskID: params.task_id,
          expectedVersion: current.version,
          checks: [...supplied, ...reviewed.checks],
          automaticChecks,
          reviewerID: reviewed.reviewerID,
        })
        return {
          title: `Task ${verified.status}`,
          output: `Task "${params.task_id}" verification result: ${verified.status}.`,
          metadata: {
            summary: [],
            sessionId: ctx.sessionID,
            error: verified.status === "needs_revision",
            aborted: 0,
          },
        }
      }

      if (params.action === "revise") {
        if (!params.task_id) throw new Error("task_id is required to revise a task")
        const execution = ctx.extra?.execution
        if (!execution) throw new Error("Task revision requires an active execution")
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const affected = await ExecutionRuntime.invalidateTaskDependents({
          sessionID: ctx.sessionID,
          execution,
          taskID: params.task_id,
          evidence: params.prompt ?? params.description ?? "Task revised by user",
        })
        return {
          title: "Task revision recorded",
          output: `Task "${params.task_id}" and ${affected} dependent task(s) reopened for revision.`,
          metadata: { summary: [], sessionId: ctx.sessionID, error: false, aborted: 0 },
        }
      }

      if (!params.description || !params.prompt || !params.subagent_type) {
        throw new Error("description, prompt, and subagent_type are required when starting a task")
      }

      const config = await Config.get()
      const execution = ctx.extra?.execution
      if (execution) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (ExecutionRuntime.atomicRoot(execution.executionID))
          throw new Error(
            "ATOMIC_PLAN_REQUIRED: use agent(action='plan'), then agent(action='execute'); generic run is unavailable during Atomic Work",
          )
      }
      if (execution && params.task_id) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const target = await ExecutionRuntime.getTask({ sessionID: ctx.sessionID, execution, taskID: params.task_id })
        if (target && AtomicWork.isTask(target, execution.executionID))
          throw new Error("Atomic Work tasks run through agent(action='execute')")
      }
      if (execution && params.depends_on?.length) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        for (const dependencyID of params.depends_on) {
          const dependency = await ExecutionRuntime.getTask({
            sessionID: ctx.sessionID,
            execution,
            taskID: dependencyID,
          })
          if (!dependency || dependency.status !== "accepted") {
            throw new Error(`Task dependency "${dependencyID}" is not accepted`)
          }
        }
      }

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
          const found = await Session.get(params.session_id).catch(() => undefined)
          if (!SessionReuse.isAllowed(found, ctx.sessionID))
            throw new Error(`Session "${params.session_id}" is not a child of the current session`)
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
        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: permissions,
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const durableTaskID = params.task_id ?? `task_${session.id}`
      let durableTask: { version: number; status: string } | undefined
      if (execution) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        durableTask = await ExecutionRuntime.registerTask({
          sessionID: ctx.sessionID,
          execution,
          taskID: durableTaskID,
          goal: params.prompt,
          owner: ctx.sessionID,
          agent: agent.name,
          skill: params.skill,
          dependsOn: params.depends_on,
          acceptance: params.acceptance?.map((criterion) => ({
            ...criterion,
            verification: criterion.verification ?? "parent",
          })),
        })
        try {
          durableTask = await ExecutionRuntime.transitionTask({
            sessionID: ctx.sessionID,
            execution,
            taskID: durableTaskID,
            expectedVersion: durableTask.version,
            status: "running",
          })
        } catch (error) {
          if (!params.session_id) await SubAgent.cancel(session.id).catch(() => {})
          throw error
        }
      }

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

      const promptParts = await resolvePromptParts(params.prompt, Instance.worktree)

      // ─── NON-BLOCKING: Start sub-agent in background, return immediately ───
      const runInBackground = async () => {
        let isolation: SubAgentIsolation.Workspace | undefined
        const taskRunId = `task_${session.id}`
        try {
          if (Instance.project.vcs === "git") isolation = await SubAgentIsolation.create(params.description!)
          const result = await TaskDispatch.spawn(
            {
              parentSessionID: ctx.sessionID,
              agent,
              model,
              parts: promptParts,
              permissions,
              description: params.description!,
              sessionId: session.id, // Reuse the session we already created
              deniedTools: Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
              workingDirectory: isolation?.directory,
            },
            params.skill ? [params.skill] : [],
          )

          unsub()

          if (isolation) {
            const preview = await isolation.preview()
            if (preview.patch)
              await WorkflowFS.writeArtifact(taskRunId, params.subagent_type!, "isolation.patch", preview.patch)
            const execution = ctx.extra?.execution
            if (execution) {
              const { ExecutionRuntime } = await import("@/core/execution/runtime")
              await ExecutionRuntime.assertActive({ sessionID: ctx.sessionID, execution })
            }
            const applied = await isolation.apply()
            for (const file of applied.changedFiles) HarnessState.addEditedFile(ctx.sessionID, file)
          }

          if (execution && durableTask) {
            const { ExecutionRuntime } = await import("@/core/execution/runtime")
            durableTask = await ExecutionRuntime.transitionTask({
              sessionID: ctx.sessionID,
              execution,
              taskID: durableTaskID,
              expectedVersion: durableTask.version,
              status: "submitted",
              evidence: result.output.slice(0, 16_000),
            })
          }

          // Write results to file — no system_notification, parent LLM stays asleep
          await WorkflowFS.writeSuccess(taskRunId, params.subagent_type!, params.subagent_type!, result.output)
        } catch (e) {
          if (execution && durableTask) {
            try {
              const { ExecutionRuntime } = await import("@/core/execution/runtime")
              durableTask = await ExecutionRuntime.transitionTask({
                sessionID: ctx.sessionID,
                execution,
                taskID: durableTaskID,
                expectedVersion: durableTask.version,
                status: "failed",
                evidence: (e as Error).message,
              })
            } catch {
              /* preserve original task failure */
            }
          }
          unsub()
          // Write failure file — no system_notification
          try {
            await WorkflowFS.writeFailed(taskRunId, params.subagent_type!, params.subagent_type!, (e as Error).message)
          } catch {
            /* file write failure is non-critical */
          }
        } finally {
          await isolation?.dispose()
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
