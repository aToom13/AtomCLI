import type { ExecutionRuntime } from "../runtime"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "execution.taskflow.reconciliation" })

export interface CompletionEvidence {
  decision: string
  completedWork: string[]
  failures: string[]
  finalResponse?: string
}

export interface ReconcileOutcome {
  reconciled: number
  stepIDs: string[]
  skipped:
    | "none"
    | "atomic"
    | "not_finish"
    | "no_evidence"
    | "independent_review"
    | "workflow"
    | "no_open_steps"
    | "transition_error"
}

/**
 * Reconcile durable taskflow *bookkeeping* steps against a verified completion.
 *
 * This is deliberately conservative: it only ever resolves `plan_item` blockers
 * of the plain `work` type, and only when the completion decision is backed by
 * real evidence (non-empty completedWork, no reported failures, a substantive
 * final response). It NEVER auto-completes independent-review or workflow
 * blockers, and it refuses to run on Atomic Work roots (which have their own
 * ledger semantics). When it cannot attribute evidence to specific steps, it
 * reconciles nothing and lets the completion gate stay closed.
 */
export namespace TaskflowReconciliation {
  export function completionEvidenceVerified(evidence: CompletionEvidence): boolean {
    if (evidence.decision !== "finish") return false
    if (evidence.failures.length > 0) return false
    if (evidence.completedWork.length === 0) return false
    const text = evidence.finalResponse?.trim() ?? ""
    return text.length >= 20
  }

  export function isIndependentReviewStep(producerID: string): boolean {
    return producerID.endsWith(":independent_review")
  }

  export async function reconcile(
    sessionID: string,
    execution: ExecutionRuntime.Context,
    evidence: CompletionEvidence,
  ): Promise<ReconcileOutcome> {
    const { ExecutionRuntime } = await import("../runtime")
    if (ExecutionRuntime.atomicRoot(execution.executionID)) {
      return { reconciled: 0, stepIDs: [], skipped: "atomic" }
    }
    if (evidence.decision !== "finish") return { reconciled: 0, stepIDs: [], skipped: "not_finish" }
    if (!completionEvidenceVerified(evidence)) return { reconciled: 0, stepIDs: [], skipped: "no_evidence" }

    const items = ExecutionRuntime.taskflowPlan(execution.executionID, sessionID)
    const open = items.filter((item) => !["resolved", "waived", "cancelled"].includes(item.state))
    if (open.length === 0) return { reconciled: 0, stepIDs: [], skipped: "no_open_steps" }

    const nonWorkPlanItems = open.filter((item) => item.kind !== "plan_item")
    if (nonWorkPlanItems.length > 0) return { reconciled: 0, stepIDs: [], skipped: "workflow" }
    const independentReview = open.filter((item) => isIndependentReviewStep(item.producerID))
    if (independentReview.length > 0) return { reconciled: 0, stepIDs: [], skipped: "independent_review" }

    // Respect the durable state machine: only a step that can move directly to
    // `resolved` (it was actually being worked) is reconciled. Steps still
    // pending, or that failed, represent work we cannot attribute to this
    // completion, so they stay open and the completion gate remains closed.
    const directlyResolvable = new Set<string>(["running", "draining", "unknown"])
    let reconciled = 0
    const stepIDs: string[] = []
    let skippedRemaining = false
    for (const item of open) {
      if (!directlyResolvable.has(item.state)) {
        skippedRemaining = true
        continue
      }
      try {
        await ExecutionRuntime.transitionBlocker({
          sessionID,
          execution,
          blockerID: item.id,
          expectedVersion: item.version,
          state: "resolved",
          evidence: "Reconciled by verified completion; checklist bookkeeping, not independent verification.",
          resolutionCode: "completion_reconciled",
        })
        reconciled++
        stepIDs.push(item.id)
      } catch (error) {
        log.info("taskflow completion reconciliation stopped", {
          executionID: execution.executionID,
          reconciled,
          error: error instanceof Error ? error.message : String(error),
        })
        return { reconciled, stepIDs, skipped: "transition_error" }
      }
    }
    if (reconciled === 0) {
      return { reconciled: 0, stepIDs: [], skipped: skippedRemaining ? "no_evidence" : "no_open_steps" }
    }
    log.info("reconciled taskflow completion bookkeeping", {
      executionID: execution.executionID,
      reconciled,
      stepIDs,
    })
    return { reconciled, stepIDs, skipped: "none" }
  }
}
