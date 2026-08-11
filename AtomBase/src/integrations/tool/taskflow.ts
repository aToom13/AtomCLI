import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { parseJsonIfString } from "@/util/util/zod"
import { Session } from "@/core/session"
import { HarnessState } from "@/core/session/harness-state"
import { runBlockingReview } from "./review-gate"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "taskflow" })

const TaskFlowTodoSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
})

const TaskFlowStepSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  todos: z.array(z.union([z.string(), TaskFlowTodoSchema])).optional(),
})

const parameters = z.object({
  action: z
    .enum(["start", "update", "complete", "fail", "clear"])
    .describe("Taskflow action: 'start' plan, 'update' step/todo status, 'complete', 'fail', or 'clear'"),
  plan: parseJsonIfString(z.array(TaskFlowStepSchema))
    .optional()
    .describe("List of steps with optional todos for action='start'"),
  step_id: z.string().optional().describe("Step ID or index (0-based) for update/complete/fail"),
  todo_id: z.string().optional().describe("Optional Todo ID or index (0-based) for update"),
  status: z.enum(["pending", "running", "completed", "failed"]).optional().describe("Step status for update"),
  todo_status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .optional()
    .describe("Todo status for update"),
  output: z.string().optional().describe("Output or completion message"),
  force: z
    .boolean()
    .optional()
    .describe(
      "User-approved force clear: bypass the review gate when action='clear'. Only use when the user explicitly instructed you to force-clear despite a blocked review.",
    ),
})

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
        await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
        await new Promise((resolve) => setTimeout(resolve, 10))

        if (params.plan && params.plan.length > 0) {
          await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID })

          // Register steps in the harness state machine
          const smSteps = params.plan
            .filter((step) => step.name && step.name.length >= 2)
            .map((step, idx) => ({
              id: step.id ?? String(idx),
              name: step.name,
            }))
          HarnessState.startPlan(ctx.sessionID, smSteps)

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
          }
        }

        if (params.status) {
          const mappedStatus =
            params.status === "completed" ? "complete" : params.status === "failed" ? "failed" : "running"

          // Enforce state machine transition when setting to "running"
          if (params.status === "running" && params.step_id !== undefined) {
            try {
              HarnessState.transitionStep(ctx.sessionID, params.step_id, "running")
            } catch (err) {
              return {
                title: "Taskflow state machine violation",
                output: String(err instanceof Error ? err.message : err),
                metadata: { steps: undefined, step_id: params.step_id ?? "", status: "error" },
              }
            }
          }

          if (params.step_id !== undefined) {
            const stepIdx = parseInt(params.step_id, 10)
            if (!isNaN(stepIdx)) {
              await Bus.publish(TuiEvent.ChainParallelUpdate, {
                stepIndex: stepIdx,
                status: mappedStatus as any,
                sessionID: ctx.sessionID,
              })
            }
          } else {
            await Bus.publish(TuiEvent.ChainUpdateStep, {
              status: mappedStatus as any,
              sessionID: ctx.sessionID,
            })
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
            HarnessState.transitionStep(ctx.sessionID, params.step_id, "completed")
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
              HarnessState.transitionStep(ctx.sessionID, runningId, "completed")
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
            HarnessState.transitionStep(ctx.sessionID, params.step_id, "failed")
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
              HarnessState.transitionStep(ctx.sessionID, runningId, "failed")
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
            await ctx.ask({
              permission: "taskflow.force",
              patterns: ["*"],
              always: [],
              metadata: {},
            })
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
