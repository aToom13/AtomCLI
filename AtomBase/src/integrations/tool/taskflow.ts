import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { parseJsonIfString } from "@/util/util/zod"
import { Session } from "@/core/session"
import { HarnessState } from "@/core/session/harness-state"
import { Log } from "@/util/util/log"
import type { ExecutionRuntime } from "@/core/execution/runtime"
import { Lock } from "@/util/util/lock"

const log = Log.create({ service: "taskflow" })

const TaskFlowTodoSchema = z.object({
  id: z.string().max(100).optional(),
  content: z.string().min(1).max(1000),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
})

const TaskFlowStepSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  type: z.enum(["work", "independent_review"]).optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  todos: z
    .array(z.union([z.string().max(1000), TaskFlowTodoSchema]))
    .max(100)
    .optional(),
})

const parameters = z.object({
  action: z
    .enum(["start", "revise", "checkpoint", "update", "complete", "fail", "clear"])
    .describe(
      "Taskflow action: start, append a revision, request an execution checkpoint, update, complete, fail, or clear",
    ),
  plan: parseJsonIfString(z.array(TaskFlowStepSchema).max(100))
    .optional()
    .describe("List of steps with optional todos for action='start'"),
  step_id: z.string().max(100).optional().describe("Step ID or index (0-based) for update/complete/fail"),
  todo_id: z.string().max(100).optional().describe("Optional Todo ID or index (0-based) for update"),
  status: z
    .enum(["pending", "running", "completed", "failed", "blocked", "reopened"])
    .optional()
    .describe("Step status for update"),
  todo_status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .optional()
    .describe("Todo status for update"),
  output: z.string().max(50_000).optional().describe("Output or completion message"),
  force: z
    .boolean()
    .optional()
    .describe(
      "User-approved force clear: bypass the review gate when action='clear'. Only use when the user explicitly instructed you to force-clear despite a blocked review.",
    ),
  waive_reason: z
    .string()
    .min(3)
    .max(1000)
    .optional()
    .describe("Required justification when force-clearing unfinished or failed plan items"),
})

function executionContext(ctx: Tool.Context) {
  return ctx.extra?.execution as ExecutionRuntime.Context | undefined
}

async function restoreDurablePlan(sessionID: string, executionID: string) {
  const binding = HarnessState.getPlanBinding(sessionID)
  if (binding && binding.executionID !== executionID) return
  if (!binding && HarnessState.getSteps(sessionID).length) return
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const items = ExecutionRuntime.taskflowPlan(executionID, sessionID)
  if (!items.length) return
  const steps = items.map((item) => {
    const encodedID = item.producerID.slice(item.producerID.indexOf(":") + 1)
    const type = encodedID.endsWith(":independent_review") ? "independent_review" : "work"
    const id = encodedID.endsWith(`:${type}`) ? encodedID.slice(0, -type.length - 1) : encodedID
    const prefix = `plan-item:${id}:`
    return {
      id,
      name: item.resourceScope.startsWith(prefix) ? item.resourceScope.slice(prefix.length) : item.resourceScope,
      type,
      status: (["resolved", "waived", "cancelled"].includes(item.state)
        ? "completed"
        : item.state === "running"
          ? "running"
          : ["failed", "blocked", "unknown"].includes(item.state)
            ? "failed"
            : "pending") as "pending" | "running" | "completed" | "failed",
    }
  })
  HarnessState.restorePlan(sessionID, steps, {
    executionID,
    revision: Math.max(...items.map((item) => item.planRevision ?? 0)),
    items: Object.fromEntries(
      items.map((item, index) => [
        steps[index].id,
        {
          blockerID: item.id,
          version: item.version,
          state: item.state,
          planRevision: item.planRevision,
        },
      ]),
    ),
  })
}

export namespace TaskFlow {
  export async function restore(sessionID: string, executionID: string) {
    using lock = await Lock.write(`taskflow:${sessionID}`)
    await restoreDurablePlan(sessionID, executionID)
  }

  export async function activateForWork(ctx: Tool.Context, work?: { tool: string; args: any }) {
    using lock = await Lock.write(`taskflow:${ctx.sessionID}`)
    const steps = HarnessState.getSteps(ctx.sessionID)
    if (!steps.length || steps.some((step) => step.status === "running")) return
    const pendingSteps = steps.filter((step) => step.status === "pending")
    if (!pendingSteps.length) return

    let matched: (typeof pendingSteps)[0] | undefined
    if (work) {
      const tool = work.tool
      const args = work.args
      const targetPath =
        typeof args?.filePath === "string" ? args.filePath : typeof args?.path === "string" ? args.path : ""
      const command = typeof args?.command === "string" ? args.command : ""
      if (tool === "bash" && /test|vitest|jest|check|tsc|lint|verify/i.test(command)) {
        matched = pendingSteps.find((step) => /test|check|lint|verif|qa/i.test(step.name))
      }
      if (!matched && targetPath) {
        const base = path.basename(targetPath, path.extname(targetPath)).toLowerCase()
        const segments = targetPath.toLowerCase().split(/[/\\]/).filter(Boolean)
        matched = pendingSteps.find((step) => {
          const lower = step.name.toLowerCase()
          return (base.length > 2 && lower.includes(base)) || segments.some((s) => s.length > 3 && lower.includes(s))
        })
      }
    }

    const next = matched ?? pendingSteps[0]
    await transitionTaskflowStep(ctx, next.id, "running")
    const stepIndex = steps.findIndex((step) => step.id === next.id)
    await Bus.publish(TuiEvent.ChainParallelUpdate, { stepIndex, status: "running", sessionID: ctx.sessionID })
  }
}

async function createDurablePlan(
  ctx: Tool.Context,
  steps: Array<{ id: string; name: string; type?: "work" | "independent_review" }>,
) {
  const execution = executionContext(ctx)
  if (!execution) return undefined
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const plan = await ExecutionRuntime.createPlan({
    sessionID: ctx.sessionID,
    execution,
    items: steps.map((step) => ({
      id: `${step.id}:${step.type ?? "work"}`,
      resourceScope: `plan-item:${step.id}:${step.name}`,
    })),
  })
  return {
    executionID: execution.executionID,
    revision: plan.revision,
    items: Object.fromEntries(
      steps.map((step, index) => {
        const blocker = plan.blockers[index]
        return [
          step.id,
          { blockerID: blocker.id, version: blocker.version, state: blocker.state, planRevision: blocker.planRevision },
        ]
      }),
    ),
  }
}

async function transitionDurablePlanItem(
  ctx: Tool.Context,
  stepID: string,
  state: "running" | "resolved" | "failed" | "waived" | "reopened" | "blocked",
  evidence?: string,
  resolutionCode?: string,
) {
  let binding = HarnessState.getPlanBinding(ctx.sessionID)
  if (!binding) return
  const execution = executionContext(ctx)
  if (!execution) {
    throw new Error("The active taskflow requires an execution context before it can change")
  }
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  if (execution.executionID !== binding.executionID) {
    const previous = ExecutionRuntime.view(binding.executionID)
    const previousInvocationActive = ExecutionRuntime.snapshot(execution.rootSessionID).activeInvocations.some(
      (invocation) => invocation.executionID === binding.executionID,
    )
    if (previous?.lifecycle !== "terminal" && (previousInvocationActive || previous?.recoveryRequired)) {
      throw new Error("The active taskflow belongs to another execution and must be reconciled before it can change")
    }
    // Adopt the visible plan rather than silently turning durable work into
    // memory-only state after a provider failure/new explicit user turn.
    const previousExecutionID = binding.executionID
    const steps = HarnessState.getSteps(ctx.sessionID)
    const adopted = await createDurablePlan(
      ctx,
      steps.map((step) => ({ id: step.id, name: step.name, type: step.type })),
    )
    if (!adopted) throw new Error("Taskflow adoption requires an execution context")
    for (const step of steps) {
      if (step.status === "pending") continue
      const item = adopted.items[step.id]
      const running = await ExecutionRuntime.transitionBlocker({
        sessionID: ctx.sessionID,
        execution,
        blockerID: item.blockerID,
        expectedVersion: item.version,
        state: "running",
      })
      item.version = running.version
      item.state = running.state
      if (step.status === "running") continue
      const restored = await ExecutionRuntime.transitionBlocker({
        sessionID: ctx.sessionID,
        execution,
        blockerID: item.blockerID,
        expectedVersion: item.version,
        state: step.status === "completed" ? "resolved" : "failed",
        evidence: `Inherited recorded plan status from execution ${previousExecutionID}; not new verification`,
        resolutionCode: "plan_adopted",
      })
      item.version = restored.version
      item.state = restored.state
    }
    HarnessState.restorePlan(ctx.sessionID, [...steps], adopted)
    binding = adopted
    log.info("adopted taskflow execution binding", {
      sessionID: ctx.sessionID,
      previousExecutionID,
      executionID: execution.executionID,
    })
  }
  const item = binding.items[stepID]
  if (!item) throw new Error(`Taskflow step "${stepID}" has no durable plan item`)
  const blocker = await ExecutionRuntime.transitionBlocker({
    sessionID: ctx.sessionID,
    execution,
    blockerID: item.blockerID,
    expectedVersion: item.version,
    state,
    evidence,
    resolutionCode,
    authority: state === "waived" ? "user" : undefined,
    planRevision: state === "waived" ? (item.planRevision ?? binding.revision) : undefined,
  })
  HarnessState.updatePlanItemBinding(ctx.sessionID, stepID, {
    version: blocker.version,
    state: blocker.state,
  })
}

async function transitionTaskflowStep(ctx: Tool.Context, stepID: string, state: "running" | "completed" | "failed") {
  if (state === "completed") HarnessState.assertRuntimeOwnedStepCompletion(ctx.sessionID, stepID)
  HarnessState.assertStepTransition(ctx.sessionID, stepID, state)
  await transitionDurablePlanItem(
    ctx,
    stepID,
    state === "completed" ? "resolved" : state,
    state === "completed"
      ? `Taskflow step ${stepID} completed`
      : state === "failed"
        ? `Taskflow step ${stepID} failed`
        : undefined,
    state === "completed" ? "plan_item_completed" : state === "failed" ? "plan_item_failed" : undefined,
  )
  HarnessState.transitionStep(ctx.sessionID, stepID, state)
}

export const TaskFlowTool = Tool.define("taskflow", {
  effects: { workspace: "none", external: "none", reversible: true, destructive: false, privileged: false },
  description: [
    "Unified progress tracking tool combining step planning and todo item management.",
    "Use action='start' with a plan array to initialize your workflow.",
    "Use action='revise' to append newly discovered work without overwriting prior revisions.",
    "Use action='update' to update step or todo status as you execute.",
    "Use action='complete' when a step or the whole flow finishes.",
    "Use action='clear' when done.",
    "",
    "IMPORTANT: Steps follow pending → running → completed/blocked/failed; blocked work may resume and completed work may reopen with evidence.",
    "You CANNOT complete or fail a step that has not been explicitly set to running first.",
    "Only one step can be in 'running' state at a time.",
  ].join("\n"),
  parameters,
  async execute(params, ctx) {
    // Parallel model tool calls may depend on an earlier step transition. Keep
    // the ledger, memory projection and TUI event in one ordered session lane.
    using lock = await Lock.write(`taskflow:${ctx.sessionID}`)
    ctx.abort.throwIfAborted()
    const activeExecution = executionContext(ctx)
    if (activeExecution) await restoreDurablePlan(ctx.sessionID, activeExecution.executionID)
    await ctx.ask({
      permission: "taskflow",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    switch (params.action) {
      case "checkpoint": {
        const execution = executionContext(ctx)
        if (!execution) throw new Error("Execution checkpoint requires an active execution")
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        if (!ExecutionRuntime.requestCheckpoint(execution.executionID))
          throw new Error("Execution checkpoint unavailable")
        return {
          title: "Execution checkpoint requested",
          output: "Checkpoint will run on the next model turn.",
          metadata: { steps: undefined, step_id: undefined, status: "checkpoint" },
        }
      }
      case "start":
      case "revise": {
        if (params.plan && params.plan.length > 0) {
          if (params.plan.some((step) => step.status && !["pending", "running"].includes(step.status))) {
            return {
              title: "Invalid taskflow",
              output:
                "New plan items may only start pending or running; record completion with an explicit transition and evidence.",
              metadata: { steps: undefined, step_id: undefined, status: "error" },
            }
          }
          if (
            params.plan.filter((step) => step.status === "running").length > 1 ||
            (params.plan.some((step) => step.status === "running") && HarnessState.getRunningStep(ctx.sessionID))
          ) {
            return {
              title: "Invalid taskflow",
              output: "Only one step can be running at a time",
              metadata: { steps: undefined, step_id: undefined, status: "error" },
            }
          }
          if (params.action === "start" && HarnessState.getSteps(ctx.sessionID).length) {
            return {
              title: "Taskflow start blocked",
              output: "An existing plan must be completed and cleared, or extended with revise.",
              metadata: { steps: undefined, step_id: undefined, status: "blocked" },
            }
          }
          if (
            params.action === "revise" &&
            params.plan.some((step, index) =>
              HarnessState.getSteps(ctx.sessionID).some((existing) => existing.id === (step.id ?? String(index))),
            )
          ) {
            return {
              title: "Invalid taskflow",
              output: "Revisions must use new step IDs",
              metadata: { steps: undefined, step_id: undefined, status: "error" },
            }
          }
          const smSteps = params.plan
            .filter((step) => step.name && step.name.length >= 2)
            .map((step, idx) => ({
              id: step.id ?? String(idx),
              name: step.name,
              type: step.type,
            }))
          if (new Set(smSteps.map((step) => step.id)).size !== smSteps.length) {
            return {
              title: "Invalid taskflow",
              output: "Taskflow step IDs must be unique",
              metadata: { steps: undefined, step_id: undefined, status: "error" },
            }
          }
          let binding: Awaited<ReturnType<typeof createDurablePlan>>
          try {
            binding = await createDurablePlan(ctx, smSteps)
          } catch (error) {
            return {
              title: "Taskflow start blocked",
              output: error instanceof Error ? error.message : String(error),
              metadata: { steps: undefined, step_id: undefined, status: "blocked" },
            }
          }

          if (params.action === "revise") HarnessState.revisePlan(ctx.sessionID, smSteps, binding)
          else {
            HarnessState.startPlan(ctx.sessionID, smSteps, binding)
            await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
            await new Promise((resolve) => setTimeout(resolve, 10))
            await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID })
          }

          for (let idx = 0; idx < params.plan.length; idx++) {
            const step = params.plan[idx]
            if (!step.name || step.name.length < 2) continue

            const todos = step.todos?.map((t, i) => {
              const content = typeof t === "string" ? t : t.content
              const st = typeof t === "string" ? "pending" : t.status
              const mappedStatus = st === "completed" ? "complete" : st === "cancelled" ? "failed" : st || "pending"
              return {
                id: typeof t === "string" ? `todo-${i}` : t.id || `todo-${i}`,
                content,
                status: mappedStatus as "pending" | "in_progress" | "complete" | "failed",
              }
            })

            await Bus.publish(TuiEvent.ChainAddStep, {
              stepId: step.id ?? String(idx),
              name: step.name,
              description: step.name,
              todos,
              sessionID: ctx.sessionID,
            })
          }
          const runningIndex = params.plan.findIndex((step) => step.status === "running")
          if (runningIndex >= 0) {
            await transitionTaskflowStep(ctx, params.plan[runningIndex].id ?? String(runningIndex), "running")
            const stepIndex = HarnessState.getSteps(ctx.sessionID).findIndex(
              (step) => step.id === (params.plan![runningIndex].id ?? String(runningIndex)),
            )
            await Bus.publish(TuiEvent.ChainParallelUpdate, { stepIndex, status: "running", sessionID: ctx.sessionID })
          }
        }

        return {
          title: `Taskflow started with ${params.plan?.length ?? 0} steps`,
          output: `Taskflow initialized with ${params.plan?.length ?? 0} steps. Update step/todo progress as work proceeds.\n\nSTATE MACHINE RULES:\n- You MUST call update(status="running") before complete/fail\n- Only one step can run at a time`,
          metadata: { steps: params.plan?.length ?? 0, step_id: undefined, status: undefined },
        }
      }

      case "update": {
        if (params.todo_id !== undefined || params.todo_status !== undefined) {
          const todoIdx = params.todo_id ? parseInt(params.todo_id, 10) : 0
          if (!isNaN(todoIdx) && (params.todo_status === "completed" || params.todo_status === undefined)) {
            await Bus.publish(TuiEvent.ChainTodoDone, { todoIndex: todoIdx, sessionID: ctx.sessionID })
            HarnessState.recordPlanStatusUpdate(ctx.sessionID)
          }
        }

        if (params.status) {
          const stepID = params.step_id ?? ""
          const durableItem = HarnessState.getPlanBinding(ctx.sessionID)?.items[stepID]
          if (params.status === "blocked") {
            await transitionDurablePlanItem(
              ctx,
              stepID,
              "blocked",
              params.output ?? "Plan item blocked",
              "plan_item_blocked",
            )
            HarnessState.blockStep(ctx.sessionID, stepID)
            await Bus.publish(TuiEvent.ChainFailStep, {
              error: params.output ?? "Taskflow step blocked",
              sessionID: ctx.sessionID,
            })
            return {
              title: "Taskflow item blocked",
              output: params.output ?? `Blocked step ${stepID}`,
              metadata: { steps: undefined, step_id: stepID, status: "blocked" },
            }
          }
          if (params.status === "running" && durableItem?.state === "blocked") {
            await transitionDurablePlanItem(ctx, stepID, "running")
            HarnessState.resumeBlockedStep(ctx.sessionID, stepID)
            return {
              title: "Taskflow item resumed",
              output: `Resumed blocked step ${stepID}`,
              metadata: { steps: undefined, step_id: stepID, status: "running" },
            }
          }
          if (params.status === "reopened") {
            await transitionDurablePlanItem(
              ctx,
              stepID,
              "reopened",
              params.output ?? "New evidence reopened this plan item",
              "new_evidence",
            )
            HarnessState.reopenStep(ctx.sessionID, stepID)
            const stepIndex = HarnessState.getSteps(ctx.sessionID).findIndex((step) => step.id === stepID)
            if (stepIndex >= 0) {
              await Bus.publish(TuiEvent.ChainParallelUpdate, {
                stepIndex,
                status: "pending",
                sessionID: ctx.sessionID,
              })
            }
            return {
              title: "Taskflow item reopened",
              output: params.output ?? `Reopened step ${stepID} because new evidence requires more work`,
              metadata: { steps: undefined, step_id: stepID, status: "reopened" },
            }
          }
          const mappedStatus =
            params.status === "completed"
              ? "complete"
              : params.status === "failed"
                ? "failed"
                : params.status === "pending"
                  ? "pending"
                  : "running"

          // Keep HarnessState and the TUI in lockstep. Previously update with
          // status="completed" only changed the UI and falsely reported
          // success while HarnessState still considered the step running.
          const transitionStepId = params.step_id ?? HarnessState.getRunningStep(ctx.sessionID)
          if (params.status !== "pending" && transitionStepId !== undefined) {
            try {
              await transitionTaskflowStep(
                ctx,
                transitionStepId,
                params.status === "completed" ? "completed" : params.status === "failed" ? "failed" : "running",
              )
            } catch (err) {
              return {
                title: "Taskflow state machine violation",
                output: String(err instanceof Error ? err.message : err),
                metadata: { steps: undefined, step_id: params.step_id ?? "", status: "error" },
              }
            }
          }

          if (params.step_id !== undefined) {
            const trackedIndex = HarnessState.getSteps(ctx.sessionID).findIndex((step) => step.id === params.step_id)
            const parsedIndex = parseInt(params.step_id, 10)
            const stepIdx = trackedIndex >= 0 ? trackedIndex : parsedIndex
            if (!isNaN(stepIdx) && stepIdx >= 0) {
              await Bus.publish(TuiEvent.ChainParallelUpdate, {
                stepIndex: stepIdx,
                status: mappedStatus as any,
                sessionID: ctx.sessionID,
              })
            }
          } else if (params.status === "completed") {
            await Bus.publish(TuiEvent.ChainCompleteStep, { output: params.output, sessionID: ctx.sessionID })
          } else if (params.status === "failed") {
            await Bus.publish(TuiEvent.ChainFailStep, {
              error: params.output ?? "Taskflow step failed",
              sessionID: ctx.sessionID,
            })
          } else {
            await Bus.publish(TuiEvent.ChainUpdateStep, { status: mappedStatus as any, sessionID: ctx.sessionID })
          }
        }

        return {
          title: `Taskflow updated`,
          output: `Updated step ${params.step_id ?? "current"} (status: ${params.status ?? "unchanged"}, todo: ${params.todo_status ?? "unchanged"})`,
          metadata: { steps: undefined, step_id: params.step_id ?? "", status: params.status ?? "" },
        }
      }

      case "complete": {
        // Enforce state machine: step must be in running state
        if (params.step_id !== undefined) {
          try {
            await transitionTaskflowStep(ctx, params.step_id, "completed")
          } catch (err) {
            return {
              title: "Taskflow state machine violation",
              output: String(err instanceof Error ? err.message : err),
              metadata: { steps: undefined, step_id: params.step_id, status: "error" },
            }
          }
        } else {
          // No step_id — completing "current" running step
          const runningId = HarnessState.getRunningStep(ctx.sessionID)
          if (runningId !== undefined) {
            try {
              await transitionTaskflowStep(ctx, runningId, "completed")
            } catch (err) {
              return {
                title: "Taskflow state machine violation",
                output: String(err instanceof Error ? err.message : err),
                metadata: { steps: undefined, step_id: undefined, status: "error" },
              }
            }
          }
        }

        await Bus.publish(TuiEvent.ChainCompleteStep, {
          output: params.output,
          sessionID: ctx.sessionID,
        })
        return {
          title: "Taskflow step completed ✓",
          output: params.output || "Taskflow step completed",
          metadata: { steps: undefined, step_id: undefined, status: "completed" },
        }
      }

      case "fail": {
        // Enforce state machine: step must be in running state
        if (params.step_id !== undefined) {
          try {
            await transitionTaskflowStep(ctx, params.step_id, "failed")
          } catch (err) {
            return {
              title: "Taskflow state machine violation",
              output: String(err instanceof Error ? err.message : err),
              metadata: { steps: undefined, step_id: params.step_id, status: "error" },
            }
          }
        } else {
          // No step_id — failing "current" running step
          const runningId = HarnessState.getRunningStep(ctx.sessionID)
          if (runningId !== undefined) {
            try {
              await transitionTaskflowStep(ctx, runningId, "failed")
            } catch (err) {
              return {
                title: "Taskflow state machine violation",
                output: String(err instanceof Error ? err.message : err),
                metadata: { steps: undefined, step_id: undefined, status: "error" },
              }
            }
          }
        }

        await Bus.publish(TuiEvent.ChainFailStep, {
          error: params.output || "Taskflow step failed",
          sessionID: ctx.sessionID,
        })
        return {
          title: "Taskflow step failed ✗",
          output: params.output || "Taskflow step failed",
          metadata: { steps: undefined, step_id: undefined, status: "failed" },
        }
      }

      case "clear": {
        const unresolved = HarnessState.getSteps(ctx.sessionID).filter((step) => step.status !== "completed")
        let forceApproved = false
        if (unresolved.length > 0) {
          if (!params.force) {
            return {
              title: "Taskflow clear blocked",
              output: `Complete all plan items before clearing. Unresolved: ${unresolved.map((step) => `${step.id} (${step.status})`).join(", ")}`,
              metadata: { steps: undefined, step_id: undefined, status: "blocked" },
            }
          }
          if (!params.waive_reason) {
            return {
              title: "Taskflow clear blocked",
              output: "waive_reason is required to force-clear unfinished or failed plan items",
              metadata: { steps: undefined, step_id: undefined, status: "blocked" },
            }
          }
          await ctx.ask({
            permission: "taskflow.force",
            patterns: ["*"],
            always: [],
            metadata: { reason: params.waive_reason },
          })
          forceApproved = true
          const binding = HarnessState.getPlanBinding(ctx.sessionID)
          for (const step of unresolved) {
            await transitionDurablePlanItem(
              ctx,
              step.id,
              "waived",
              JSON.stringify({
                reason: params.waive_reason,
                authority: "user",
                planRevision: binding?.revision,
              }),
              "plan_item_user_waiver",
            )
          }
        }

        // ── REVIEW GATE (primary) ─────────────────────────────────────────
        // Blocking reviewer sub-agent verifies the main agent's edits before
        // clear is allowed to complete. On FAIL the clear is NOT performed —
        // the main agent wakes in the same turn, fixes the issues, and calls
        // clear again. Sub-agent sessions are exempt (orchestrate already has
        // its own QA loop). The gate is skipped when review.enabled=false or
        // no files were edited (handled inside runBlockingReview).
        // NOTE: Session.get validates the ID synchronously (fn wrapper) and
        // throws for non-session IDs — wrap in try/catch, not .catch().
        let sessionInfo: any = null
        try {
          sessionInfo = await Session.get(ctx.sessionID)
        } catch {
          sessionInfo = null
        }
        const isSubAgent = sessionInfo?.parentID != null
        let reviewBypassed = false

        if (!isSubAgent) {
          const { runBlockingReview } = await import("./review-gate")
          const execution = ctx.extra?.execution as ExecutionRuntime.Context | undefined
          const review = await runBlockingReview(ctx.sessionID, { executionID: execution?.executionID })

          if (!review.passed && !params.force) {
            const verdict = HarnessState.getReviewVerdict(ctx.sessionID)
            const attempts = verdict?.attempts ?? 1

            // Branch on the failure mode so the agent gets accurate guidance:
            // infra errors are NOT code issues to fix — retry or escalate.
            const header = review.exhausted
              ? "⛔ REVIEW EXHAUSTED: taskflow clear is blocked — review attempts exhausted"
              : review.error
                ? "⛔ REVIEW ERROR: taskflow clear is blocked — the review could not run"
                : "⛔ REVIEW FAILED: taskflow clear is blocked"

            const fixInstruction = review.exhausted
              ? "Review attempts are exhausted. Escalate to the user for a decision — do not force clear."
              : review.error
                ? "The reviewer could not run due to an infrastructure error. Retry taskflow clear, or escalate to the user."
                : "Fix the issues reported below, then call taskflow clear again."

            const reason = review.reason ?? "Reviewer returned no reason."

            return {
              title: "Taskflow clear blocked by review",
              output: [header, `Attempt ${attempts}.`, "", fixInstruction, "", reason].join("\n"),
              metadata: { steps: undefined, step_id: undefined, status: "blocked" },
            }
          }

          if (!review.passed && params.force) {
            // Forcing a clear past a blocked review is a privileged action —
            // require a distinct explicit approval ("taskflow.force") instead
            // of reusing the generic taskflow ask, so the bypass cannot happen
            // silently. always: [] makes the approval per-occurrence only — a
            // stored "always" grant would let the agent force-clear silently
            // for the rest of the project session. Throws if the user rejects.
            if (!forceApproved) {
              await ctx.ask({
                permission: "taskflow.force",
                patterns: ["*"],
                always: [],
                metadata: {},
              })
              forceApproved = true
            }
            reviewBypassed = true
            log.warn("taskflow clear: review gate bypassed by explicit force", {
              sessionID: ctx.sessionID,
              exhausted: review.exhausted,
              error: review.error,
            })
          }
        }

        // Option B: warn + force clear
        if (
          activeExecution &&
          HarnessState.getPlanBinding(ctx.sessionID)?.executionID === activeExecution.executionID
        ) {
          const { ExecutionRuntime } = await import("@/core/execution/runtime")
          await ExecutionRuntime.closeTaskflow({ sessionID: ctx.sessionID, execution: activeExecution })
        }
        const { warnings } = HarnessState.clearPlan(ctx.sessionID)
        await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })

        const reviewBypassNote = reviewBypassed
          ? "\n\n⚠️ Review gate bypassed via force — edits were NOT independently verified."
          : ""
        const warningText = warnings.length > 0 ? `\n\n${warnings.join("\n")}` : ""
        return {
          title: "Taskflow cleared",
          output: `Taskflow cleared${reviewBypassNote}${warningText}`,
          metadata: { steps: undefined, step_id: undefined, status: "cleared" },
        }
      }
    }
  },
})
