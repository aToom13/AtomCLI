import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { parseJsonIfString } from "@/util/util/zod"
import { Session } from "@/core/session"
import { HarnessState } from "@/core/session/harness-state"
import { Log } from "@/util/util/log"
import type { ExecutionRuntime } from "@/core/execution/runtime"

const log = Log.create({ service: "taskflow" })

const TaskFlowTodoSchema = z.object({
  id: z.string().max(100).optional(),
  content: z.string().min(1).max(1000),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
})

const TaskFlowStepSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  todos: z
    .array(z.union([z.string().max(1000), TaskFlowTodoSchema]))
    .max(100)
    .optional(),
})

const parameters = z.object({
  action: z
    .enum(["start", "update", "complete", "fail", "clear"])
    .describe("Taskflow action: 'start' plan, 'update' step/todo status, 'complete', 'fail', or 'clear'"),
  plan: parseJsonIfString(z.array(TaskFlowStepSchema).max(100))
    .optional()
    .describe("List of steps with optional todos for action='start'"),
  step_id: z.string().max(100).optional().describe("Step ID or index (0-based) for update/complete/fail"),
  todo_id: z.string().max(100).optional().describe("Optional Todo ID or index (0-based) for update"),
  status: z.enum(["pending", "running", "completed", "failed"]).optional().describe("Step status for update"),
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

async function createDurablePlan(ctx: Tool.Context, steps: Array<{ id: string; name: string }>) {
  const execution = executionContext(ctx)
  if (!execution) return undefined
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const plan = await ExecutionRuntime.createPlan({
    sessionID: ctx.sessionID,
    execution,
    items: steps.map((step) => ({ id: step.id, resourceScope: `plan-item:${step.id}:${step.name}` })),
  })
  return {
    executionID: execution.executionID,
    revision: plan.revision,
    items: Object.fromEntries(
      steps.map((step, index) => {
        const blocker = plan.blockers[index]
        return [step.id, { blockerID: blocker.id, version: blocker.version, state: blocker.state }]
      }),
    ),
  }
}

async function transitionDurablePlanItem(
  ctx: Tool.Context,
  stepID: string,
  state: "running" | "resolved" | "failed" | "waived",
  evidence?: string,
  resolutionCode?: string,
) {
  const binding = HarnessState.getPlanBinding(ctx.sessionID)
  if (!binding) return
  const execution = executionContext(ctx)
  if (!execution || execution.executionID !== binding.executionID) {
    throw new Error("The active taskflow belongs to another execution and must be reconciled before it can change")
  }
  const item = binding.items[stepID]
  if (!item) throw new Error(`Taskflow step "${stepID}" has no durable plan item`)
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const blocker = await ExecutionRuntime.transitionBlocker({
    sessionID: ctx.sessionID,
    execution,
    blockerID: item.blockerID,
    expectedVersion: item.version,
    state,
    evidence,
    resolutionCode,
    authority: state === "waived" ? "user" : undefined,
    planRevision: state === "waived" ? binding.revision : undefined,
  })
  HarnessState.updatePlanItemBinding(ctx.sessionID, stepID, {
    version: blocker.version,
    state: blocker.state,
  })
}

async function transitionTaskflowStep(ctx: Tool.Context, stepID: string, state: "running" | "completed" | "failed") {
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
  description: [
    "Unified progress tracking tool combining step planning and todo item management.",
    "Use action='start' with a plan array to initialize your workflow.",
    "Use action='update' to update step or todo status as you execute.",
    "Use action='complete' when a step or the whole flow finishes.",
    "Use action='clear' when done.",
    "",
    "IMPORTANT: Steps must follow the state machine: pending → running → completed/failed.",
    "You CANNOT complete or fail a step that has not been explicitly set to running first.",
    "Only one step can be in 'running' state at a time.",
  ].join("\n"),
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "taskflow",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    switch (params.action) {
      case "start": {
        if (params.plan && params.plan.length > 0) {
          const smSteps = params.plan
            .filter((step) => step.name && step.name.length >= 2)
            .map((step, idx) => ({
              id: step.id ?? String(idx),
              name: step.name,
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

          HarnessState.startPlan(ctx.sessionID, smSteps, binding)
          await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
          await new Promise((resolve) => setTimeout(resolve, 10))
          await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID })

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
          await Bus.publish(TuiEvent.ChainUpdateStep, { status: "running", sessionID: ctx.sessionID })
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
          const review = await runBlockingReview(ctx.sessionID)

          if (!review.passed && !params.force) {
            const verdict = HarnessState.getReviewVerdict(ctx.sessionID)
            const attempts = verdict?.attempts ?? 1

            // Branch on the failure mode so the agent gets accurate guidance:
            // infra errors are NOT code issues to fix — retry or escalate.
            const header = review.error
              ? "⛔ REVIEW ERROR: taskflow clear is blocked — the review could not run"
              : review.exhausted
                ? "⛔ REVIEW EXHAUSTED: taskflow clear is blocked — review attempts exhausted"
                : "⛔ REVIEW FAILED: taskflow clear is blocked"

            const fixInstruction = review.error
              ? "The reviewer could not run due to an infrastructure error. Retry taskflow clear, or escalate to the user."
              : review.exhausted
                ? "Review attempts are exhausted. Escalate to the user for a decision — do not force clear."
                : "Fix the issues reported below, then call taskflow clear again."

            const reason = review.error
              ? "Review infrastructure error — no reviewer verdict was produced. This is not a code issue; retry the review."
              : (review.reason ?? "Reviewer returned no reason.")

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
