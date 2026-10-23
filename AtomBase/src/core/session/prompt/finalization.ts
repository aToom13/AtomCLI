import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { HarnessState } from "../harness-state"
import { PromptContext } from "./context"
import { VerificationEvidence } from "@/core/execution/verification-evidence"

export namespace PromptFinalization {
  export async function durableFailureReasons(executionID: string) {
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const view = ExecutionRuntime.view(executionID)
    if (!view) return []
    const snapshot = ExecutionRuntime.snapshot(view.rootSessionID)
    // A sibling still working may provide new evidence; its failed neighbor
    // must not end the parent early.
    if (
      snapshot.activeInvocations.some(
        (item) =>
          item.executionID === executionID &&
          ["child", "reviewer"].includes(item.kind) &&
          ["accepted", "running", "waiting", "draining"].includes(item.state),
      )
    )
      return []
    return [
      ...snapshot.blockers
        .filter(
          (item) =>
            item.executionID === executionID && ["failed", "cancelled", "unknown", "blocked"].includes(item.state),
        )
        .map((item) => `Durable ${item.kind} ${item.id} remains ${item.state}.`),
      ...ExecutionRuntime.tasks(executionID)
        .filter((item) => ["failed", "cancelled", "blocked"].includes(item.status))
        .map((item) => `Durable task ${item.id} remains ${item.status}.`),
      ...view.unknownWork.map(
        (item) =>
          `Uncertain work ${item.kind} (${item.id}) requires explicit reconciliation; success cannot be committed.`,
      ),
    ]
  }

  export function isUserFacingReport(text: string) {
    // Fenced examples are documentation, never executable tool calls.
    const report = text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, "").trim()
    if (!text.trim()) return false
    return !(
      /(?:^|\n)\s*<\s*\/?\s*(?:[｜|]DSML[｜|]|system_dispatch\b|system_privacy\b|invoke\b|function_calls\b|tool_call\b)/iu.test(
        report,
      ) ||
      /^\s*\{\s*"(?:type|id|name)"[\s\S]*"type"\s*:\s*"tool_use"/u.test(report) ||
      /^\s*\{\s*"type"\s*:\s*"tool_use"/u.test(report)
    )
  }

  export function reviewRetryText(reason?: string) {
    return [
      "The final response was withheld because the independent review did not pass.",
      "Address the review findings, verify the current workspace revision, and then produce a new final response.",
      reason ? `Review result:\n${reason}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  export function reviewBlockedText(reason?: string) {
    return [
      "Completion is blocked: the required independent review could not approve the current workspace revision.",
      reason || "Retry the review or ask the user how to proceed.",
    ].join("\n\n")
  }

  export async function buildDeterministicFinalResponse(input: {
    sessionID: string
    executionID: string
    reasons: string[]
  }): Promise<string> {
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const checkpoints = ExecutionRuntime.checkpoints(input.executionID)
    const lastPayload = checkpoints.at(-1)?.payload as { checkpoint?: ExecutionCheckpoint.Result } | undefined
    const cp = lastPayload?.checkpoint
    // The model reports delta-only lists per checkpoint; the accumulated
    // completed/failure history is reconstructed here so the final report does
    // not depend on the model repeating earlier slices.
    const accumulated = PromptContext.accumulateCheckpointFields(checkpoints)

    const lines: string[] = []
    const view = ExecutionRuntime.view(input.executionID)
    const rootObjective = ExecutionRuntime.objective(input.executionID)?.objective

    if (rootObjective) lines.push(`Objective: ${rootObjective}`)
    if (cp?.objectiveAssessment && cp.objectiveAssessment !== "Objective remains unchanged.") {
      lines.push(`\nObjective status: ${cp.objectiveAssessment}`)
    } else if (cp?.progressSummary && cp.progressSummary !== "No summary provided.") {
      lines.push(`\nProgress: ${cp.progressSummary}`)
    }

    const completed = [
      ...accumulated.completedWork,
      ...HarnessState.getSteps(input.sessionID)
        .filter((s) => s.status === "completed")
        .map((s) => s.name),
    ]
    const uniqueCompleted = [...new Set(completed)]
    if (uniqueCompleted.length > 0) {
      lines.push("\nReported work (not independent verification):")
      for (const item of uniqueCompleted) lines.push(`- ${item}`)
    }

    const references = new Map<string, NonNullable<ExecutionCheckpoint.Result["checks"]>[number]>()
    for (const record of checkpoints) {
      for (const check of record.payload?.checkpoint?.checks ?? []) references.set(check.name, check)
    }
    const checks = await VerificationEvidence.resolve(input.sessionID, [...references.values()])
    if (checks.length > 0) {
      lines.push("\nVerification:")
      for (const check of checks) lines.push(`- ${check.name}: ${check.status}; call ${check.callID}; ${check.reason}`)
    } else lines.push("\nVerification: BLOCKED; no structured check evidence was supplied.")

    const tasks = ExecutionRuntime.tasks(input.executionID)
    if (tasks.length) {
      lines.push("\nDurable task outcomes:")
      for (const task of tasks.slice(0, 50)) lines.push(`- ${task.id}: ${task.status}`)
    }
    if (view?.unknownWork.length)
      lines.push("\nUncertain work remains unresolved; no successful completion is claimed.")

    const remaining = [
      ...(cp?.remainingWork ?? []),
      ...(cp?.blockers ?? []),
      ...HarnessState.getSteps(input.sessionID)
        .filter((s) => s.status === "pending" || s.status === "running")
        .map((s) => `durable taskflow step "${s.name}" is ${s.status}`),
    ]
    const uniqueRemaining = [...new Set(remaining)]
    if (uniqueRemaining.length > 0) {
      lines.push("\nRemaining / Blockers:")
      for (const item of uniqueRemaining) lines.push(`- ${item}`)
    }

    lines.push(`\nFinalization reason: ${input.reasons.join("; ")}`)
    return lines.join("\n")
  }
}
