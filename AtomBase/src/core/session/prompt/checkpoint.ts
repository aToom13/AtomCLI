import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import type { ExecutionRuntime } from "@/core/execution/runtime"
import type { MessageV2 } from "@/core/session/message-v2"
import type { SessionProcessor } from "@/core/session/processor"
import type { PromptContext } from "./context"
import { PromptFinalization } from "./finalization"
import { VerificationEvidence } from "@/core/execution/verification-evidence"

export async function handleCheckpoint(input: {
  result: SessionProcessor.Result
  sessionID: string
  lastUser: MessageV2.User
  executionContext: ExecutionRuntime.Context
  processor: SessionProcessor.Info
  eventCheckpoint: boolean
  RouteRuntime: typeof ExecutionRuntime
  parseCheckpointJsonCandidates: typeof PromptContext.parseCheckpointJsonCandidates
  checkpointFinalParts: typeof PromptContext.checkpointFinalParts
}) {
  const {
    result,
    sessionID,
    lastUser,
    executionContext,
    processor,
    eventCheckpoint,
    RouteRuntime,
    parseCheckpointJsonCandidates,
    checkpointFinalParts,
  } = input

  const candidateTexts = [
    (result.deferredTextParts ?? [])
      .map((part) => part.text)
      .join("\n")
      .trim(),
    ...(result.checkpointReasoningCandidates ?? []),
  ].filter(Boolean)

  let parsedCheckpoint: ExecutionCheckpoint.Result | undefined
  let checkpointSource: string | undefined
  for (const candidateText of candidateTexts) {
    for (const checkpointInput of parseCheckpointJsonCandidates(candidateText)) {
      const normalized = ExecutionCheckpoint.normalizeCandidate(checkpointInput)
      const candidate = ExecutionCheckpoint.Result.safeParse(normalized)
      if (
        candidate.success &&
        (candidate.data.decision !== "finish" ||
          PromptFinalization.isUserFacingReport(candidate.data.finalResponse ?? ""))
      ) {
        parsedCheckpoint = candidate.data
        checkpointSource = candidateText
        break
      }
    }
    if (parsedCheckpoint) break
  }

  if (!parsedCheckpoint) {
    const terminalFinish = result.terminalFinish ?? processor.message.finish
    const failures = RouteRuntime.recordCheckpointFailure(executionContext.executionID)
    if (failures >= ExecutionCheckpoint.MAX_INVALID_RESPONSES) {
      return {
        action: "continue" as const,
        finalResponseOnly: { reasons: [`Invalid checkpoint response after ${failures} attempts.`] },
      }
    }
    if (!parsedCheckpoint) {
      // Persist the retry count, not an empty assistant turn.
      if (terminalFinish === "tool-calls") await Session.updateMessage({ ...processor.message, finish: undefined })
      else await Session.removeMessage({ sessionID, messageID: processor.message.id })
      return { action: "continue" as const }
    }
  }
  // Keep provider reasoning visible when it is ordinary reasoning, while
  // withholding a checkpoint payload carried in the reasoning channel.
  for (const part of result.checkpointReasoningParts ?? []) {
    if (part.text !== checkpointSource) await Session.updatePart(part)
  }
  const checkpointRuntime = {
    executionID: executionContext.executionID,
    allowance: RouteRuntime.allowance(executionContext.executionID),
    model: `${processor.message.providerID}/${processor.message.modelID}`,
    reason: eventCheckpoint
      ? "final_gate"
      : (RouteRuntime.checkpointReason(executionContext.executionID) ?? "requested"),
  }
  if (parsedCheckpoint.checks?.length) {
    const acceptedUser = RouteRuntime.view(executionContext.executionID)?.userMessageID
    const accepted = (await Session.messages({ sessionID })).find((message) => message.info.id === acceptedUser)
    const checks = await VerificationEvidence.resolve(
      sessionID,
      parsedCheckpoint.checks,
      accepted?.info.time.created ?? lastUser.time.created,
    )
    const failed = checks
      .filter((check) => check.status !== "PASS")
      .map((check) => `${check.name}: ${check.status} (${check.reason})`)
    if (checks.length) parsedCheckpoint.progressSummary = `Verified checks: ${JSON.stringify(checks)}`.slice(0, 2000)
    if (failed.length) {
      parsedCheckpoint.failures = [...parsedCheckpoint.failures, ...failed]
      parsedCheckpoint.remainingWork = [...parsedCheckpoint.remainingWork, ...failed]
      if (parsedCheckpoint.decision === "finish") {
        parsedCheckpoint.decision = "continue"
        parsedCheckpoint.requestedCalls = ExecutionCheckpoint.MIN_CHECKPOINT_CALLS
        parsedCheckpoint.finalResponse = undefined
      }
    }
  }
  // Reconcile durable taskflow *bookkeeping* steps against a verified
  // completion before the finalization gate. When the model has finished the
  // work and reported evidence, leftover "work" checklist steps must not force
  // an endless continue loop. Independent-review / workflow steps and Atomic
  // roots are deliberately left to their own gates.
  if (parsedCheckpoint.decision === "finish") {
    const { TaskflowReconciliation } = await import("@/core/execution/runtime/taskflow-reconciliation")
    await TaskflowReconciliation.reconcile(sessionID, executionContext, parsedCheckpoint).catch(() => {
      // Reconciliation is best-effort; on failure the gate stays closed.
    })
  }
  const effectiveCheckpoint = RouteRuntime.reconcileCheckpoint(
    executionContext.executionID,
    parsedCheckpoint,
    sessionID,
    executionContext.invocationID,
  )
  const applied = RouteRuntime.applyCheckpoint(
    executionContext.executionID,
    processor.message.id,
    effectiveCheckpoint,
    RouteRuntime.getExecutionEvidence(executionContext.executionID),
    {
      triggerMessageID: lastUser.id,
      invocationID: executionContext.invocationID,
      sessionID,
      telemetry: checkpointRuntime,
    },
  )
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: processor.message.id,
    sessionID,
    type: "checkpoint",
    runtime: checkpointRuntime,
    sequence: applied.sequence,
    decision: effectiveCheckpoint.decision,
    requestedCalls: effectiveCheckpoint.requestedCalls,
    grantedCalls: applied.grantedCalls,
    objectiveAssessment: effectiveCheckpoint.objectiveAssessment,
    progressSummary: effectiveCheckpoint.progressSummary,
    discoveries: effectiveCheckpoint.discoveries,
    completedWork: effectiveCheckpoint.completedWork,
    remainingWork: effectiveCheckpoint.remainingWork,
    failures: effectiveCheckpoint.failures,
    blockers: effectiveCheckpoint.blockers,
    routeAssessment: effectiveCheckpoint.routeAssessment,
    nextActions: effectiveCheckpoint.nextActions,
  })
  if (effectiveCheckpoint.decision === "finish") {
    result.deferredTextParts = checkpointFinalParts(result.deferredTextParts, {
      sessionID,
      messageID: processor.message.id,
      finalResponse: effectiveCheckpoint.finalResponse!,
    })
    const session = await Session.get(sessionID)
    if (session.parentID) {
      // Child checkpoints must publish their deferred final text and close the
      // child invocation. The root gate intentionally does not run for children,
      // but that cannot leave the assistant message unfinished.
      await RouteRuntime.assertActive({ sessionID, execution: executionContext })
      for (const part of result.deferredTextParts) await Session.updatePart(part)
      await RouteRuntime.assertActive({ sessionID, execution: executionContext })
      processor.message.finish = "stop"
      processor.message.time.completed = Date.now()
      await Session.updateMessage(processor.message)
      return { action: "break" as const, waitingForInput: false }
    }
  }
  if (effectiveCheckpoint.decision === "continue" && applied.grantedCalls) return { action: "continue" as const }
  if (effectiveCheckpoint.decision === "continue" && applied.extensionLimitReached) {
    return { action: "continue" as const, finalResponseOnly: { reasons: ["Execution extension limit reached."] } }
  }
  if (effectiveCheckpoint.decision === "blocked") {
    const constraints = RouteRuntime.finalizationConstraints(
      executionContext.executionID,
      undefined,
      executionContext.invocationID,
    )
    const reconciliation = effectiveCheckpoint.blockers.filter((blocker) =>
      blocker.includes("durable taskflow contains stale unresolved state"),
    )
    const durableFailures = await (
      await import("./finalization")
    ).PromptFinalization.durableFailureReasons(executionContext.executionID)
    const session = await Session.get(sessionID)
    if (session.parentID || constraints.length || reconciliation.length || durableFailures.length) {
      const report = parsedCheckpoint.finalResponse?.trim()
      if (!session.parentID && durableFailures.length && report) {
        result.deferredTextParts = checkpointFinalParts(result.deferredTextParts, {
          sessionID,
          messageID: processor.message.id,
          finalResponse: report,
        })
        return {
          action: "proceed" as const,
          finalResponseOnly: { reasons: [...effectiveCheckpoint.blockers, ...durableFailures] },
        }
      }
      return {
        action: "continue" as const,
        finalResponseOnly: {
          reasons: [...effectiveCheckpoint.blockers, ...constraints, ...reconciliation, ...durableFailures],
        },
      }
    }
    await RouteRuntime.waitForInput({
      sessionID,
      execution: executionContext,
      reason: effectiveCheckpoint.blockers.join("; ") || effectiveCheckpoint.progressSummary,
    })
    return { action: "break" as const, waitingForInput: true }
  }
  return { action: "proceed" as const }
}
