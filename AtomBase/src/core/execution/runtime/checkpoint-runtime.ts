import { Bus } from "@/core/bus"
import { ExecutionCheckpoint } from "../checkpoint"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import * as RouteGuidanceStore from "../route-guidance"
import type { ExecutionLedger } from "../ledger"
import type { ExecutionRuntime } from "../runtime"

export function createCheckpointRuntimeModule(input: {
  getExecutionState: (id: string) => ExecutionRuntime.ExecutionState | undefined
  setExecutionState: (id: string, value: ExecutionRuntime.ExecutionState) => void
  deleteExecutionState: (id: string) => void
  ledger: () => ReturnType<typeof ExecutionLedger.open>
  hasNewEvidencePath: (current?: string[], prior?: string[]) => boolean
  hasRepeatedTail: (values: string[] | undefined, count: number) => boolean
  event: typeof ExecutionRuntime.Event
}) {
  const {
    getExecutionState,
    setExecutionState,
    deleteExecutionState,
    ledger,
    hasNewEvidencePath,
    hasRepeatedTail,
    event: Event,
  } = input
  function checkpointRuntimeState(executionID: string, callerInvocationID?: string, sessionID?: string) {
    const existing = getExecutionState(executionID)
    if (!existing) throw new Error("execution policy state not found")
    const view = ledger().view(executionID)
    const caller = callerInvocationID ? ledger().invocation?.(callerInvocationID) : undefined
    // Root repair messages change invocation ID, not the execution's progress history.
    const rootCheckpoint = (sessionID ?? caller?.sessionID) === view?.rootSessionID && !!view?.rootSessionID
    const previous = ledger()
      .checkpoints(executionID)
      .findLast(
        (item) =>
          !callerInvocationID ||
          item.payload?.invocationID === callerInvocationID ||
          item.payload?.triggerMessageID === callerInvocationID ||
          (rootCheckpoint &&
            (item.payload?.sessionID ?? ledger().invocation?.(item.payload?.invocationID)?.sessionID) ===
              view.rootSessionID),
      )?.payload as
      | {
          evidence?: ExecutionPolicy.RuntimeEvidence
          routeRevision?: number
          planRevision?: number
          mutationRevision?: number
        }
      | undefined
    const routeChanged = Boolean(
      previous && view && view.routeRevision > (previous.routeRevision ?? view.routeRevision),
    )
    const planRevision = ledger().planRevision(executionID) ?? 0
    const mutationRevision = ledger().revision(executionID) ?? 0
    const planChanged = Boolean(previous && planRevision > (previous.planRevision ?? planRevision))
    const planStateMismatch = Boolean(previous && (previous.planRevision ?? 0) > planRevision)
    const priorEvidence = previous?.evidence ?? {}
    const failedWorkflow =
      (!caller || caller.sessionID === view?.rootSessionID) &&
      !ledger().hasRunningChild(executionID, callerInvocationID) &&
      (ledger().blockers?.(executionID) ?? []).some((item) => item.kind === "workflow" && item.state === "failed")
    const hasNewFiles =
      (!failedWorkflow &&
        !(existing.evidence.mutatingCalls ?? 0) &&
        hasNewEvidencePath(existing.evidence.filesRead, priorEvidence.filesRead)) ||
      hasNewEvidencePath(existing.evidence.filesChanged, priorEvidence.filesChanged)
    // CP-02: a second successful write to the same file is real progress even
    // when the cumulative path list does not grow. Exact repeated calls remain
    // non-progress so the anti-loop watchdog keeps its boundary.
    const priorWriteCounts = priorEvidence.fileWriteCounts ?? {}
    const hasNewRevisions =
      !hasRepeatedTail(existing.evidence.recentToolCallSignatures, 3) &&
      Object.entries(existing.evidence.fileWriteCounts ?? {}).some(
        ([file, count]) => Number(count) > (priorWriteCounts[file] ?? 0),
      )
    const priorSemanticResults = new Set(priorEvidence.recentSemanticActionResults ?? [])
    // More observations cannot repair a terminal failed workflow. Actual file
    // revisions, plan changes and verification still count; query variation
    // must not buy endless report-only slices.
    const hasNewSemanticResults =
      !failedWorkflow &&
      !(
        (existing.evidence.mutatingCalls ?? 0) > 0 &&
        existing.evidence.recentToolFamilies?.length &&
        existing.evidence.recentToolFamilies.every((family) =>
          ["read", "skill", "grep", "glob", "list"].includes(family),
        )
      ) &&
      (existing.evidence.recentSemanticActionResults ?? []).some((result) => !priorSemanticResults.has(result))
    const semanticTail = (existing.evidence.recentSemanticActionResults ?? []).slice(-3)
    const hasDistinctSemanticResults = semanticTail.length === 3 && new Set(semanticTail).size > 1
    const hasBrowserVerification =
      !hasRepeatedTail(existing.evidence.recentToolCallSignatures, 3) &&
      ((existing.evidence.browserNavigations ?? 0) > (priorEvidence.browserNavigations ?? 0) ||
        (existing.evidence.browserVerificationCalls ?? 0) > (priorEvidence.browserVerificationCalls ?? 0))
    const progressed =
      !previous || hasNewFiles || hasNewRevisions || hasNewSemanticResults || hasBrowserVerification || planChanged
    // A blocking child can finish after several parent checkpoints. Its work
    // has not returned to parent evidence yet, so do not count those waits as stalls.
    const waitingForWork = ledger().hasRunningChild(executionID, callerInvocationID)
    return {
      routeChanged,
      planChanged,
      planStateMismatch,
      mutationRevision,
      hasNewRevisions,
      deliveryProgress:
        existing.contract?.needsMutation === false ||
        hasNewRevisions ||
        hasNewEvidencePath(existing.evidence.filesChanged, priorEvidence.filesChanged) ||
        hasBrowserVerification,
      hasDistinctSemanticResults,
      progressed,
      noProgressSlices: progressed
        ? 0
        : waitingForWork
          ? (priorEvidence.noProgressSlices ?? 0)
          : (priorEvidence.noProgressSlices ?? 0) + 1,
    }
  }

  function reconcileCheckpoint(
    executionID: string,
    checkpoint: import("../checkpoint").ExecutionCheckpoint.Result,
    sessionID?: string,
    callerInvocationID?: string,
  ): import("../checkpoint").ExecutionCheckpoint.Result {
    const existing = getExecutionState(executionID)
    if (!existing) throw new Error("execution policy state not found")
    const runtime = checkpointRuntimeState(executionID, callerInvocationID, sessionID)
    let result = { ...checkpoint, planChanged: runtime.planChanged, routeChanged: runtime.routeChanged }
    const unsupportedFileCheck =
      /(?:verif(?:y|ied|ication)|check|test).*?(?:file:\/\/|direct[- ]file|file url)|(?:file:\/\/|direct[- ]file|file url).*?(?:verif(?:y|ied|ication)|check|test|behavior)/i
    if (result.remainingWork.some((item) => unsupportedFileCheck.test(item))) {
      result = {
        ...result,
        discoveries: [
          ...new Set([
            ...result.discoveries,
            "Browser navigation supports HTTP/HTTPS only; direct-file behavior is unverified.",
          ]),
        ],
        remainingWork: [
          ...new Set(
            result.remainingWork.map((item) =>
              unsupportedFileCheck.test(item)
                ? "Verify the deliverable over local HTTP; report unsupported direct-file verification as a limitation."
                : item,
            ),
          ),
        ],
      }
    }
    const rootSessionID = ledger().view(executionID)?.rootSessionID
    const rootCheckpoint = !sessionID || sessionID === rootSessionID
    const durableItems = rootCheckpoint
      ? (ledger().blockers?.(executionID) ?? []).filter(
          (item) =>
            ["plan_item", "workflow"].includes(item.kind) && !["resolved", "waived", "cancelled"].includes(item.state),
        )
      : []
    const openReason =
      "Durable taskflow still has open steps: " +
      durableItems.map((item) => `${item.producerID} (${item.state})`).join(", ") +
      ". Verify required results using agent workflow status and artifact/test checks. Report an expected failure with a terminal non-success outcome; recovery requires authorization and verification evidence."

    if (runtime.planStateMismatch) {
      const reason = "Durable plan state moved backwards; reconcile the checkpoint before continuing."
      result = {
        ...result,
        decision: "blocked",
        requestedCalls: undefined,
        finalResponse: undefined,
        remainingWork: [...new Set([...result.remainingWork, reason])],
        blockers: [...new Set([...result.blockers, reason])],
        estimatedRemainingCalls: 0,
        nextActions: [...new Set([...result.nextActions, "Reconcile durable plan state before resuming work."])],
      }
    }

    if (
      rootCheckpoint &&
      (result.decision === "finish" ||
        (result.decision === "continue" && durableItems.some((item) => item.state === "failed"))) &&
      ledger().hasUnresolvedExecutionTaskflow(executionID)
    ) {
      const reason = openReason
      const failed = durableItems.some((item) => ["failed", "cancelled"].includes(item.state))
      result = {
        ...result,
        decision: failed ? "blocked" : "continue",
        requestedCalls: failed ? undefined : Math.max(4, result.estimatedRemainingCalls),
        finalResponse: undefined,
        remainingWork: [...new Set([...result.remainingWork, reason])],
        blockers: failed ? [...new Set([...result.blockers, reason])] : result.blockers,
        estimatedRemainingCalls: failed ? 0 : Math.max(4, result.estimatedRemainingCalls),
        nextActions: [
          ...new Set([
            ...result.nextActions,
            failed
              ? "Report the failed obligation without changing its outcome."
              : "Complete open taskflow steps with verification evidence.",
          ]),
        ],
      }
    }

    if (rootCheckpoint && result.decision === "continue" && ledger().hasUnresolvedExecutionTaskflow(executionID)) {
      const reason = openReason
      result = {
        ...result,
        requestedCalls: Math.max(4, result.requestedCalls ?? 0),
        remainingWork: [...new Set([...result.remainingWork, reason])],
      }
    }

    const stallReasons = finalizationConstraints(executionID, runtime, callerInvocationID)
    // Consecutive route revisions without progress signal a strategy that keeps
    // changing but never works — treat 4+ consecutive revisions as stall evidence.
    const prevGuidance = RouteGuidanceStore.restore(executionID, ledger().checkpoints(executionID))
    if (
      result.decision === "continue" &&
      result.routeDecision === "revise" &&
      !runtime.progressed &&
      (prevGuidance?.consecutiveRevisions ?? 0) >= 3
    ) {
      stallReasons.push(
        "Multiple consecutive route revisions without progress. Strategy changes are not producing results.",
      )
    }
    if (
      (result.decision === "continue" && stallReasons.length) ||
      (result.decision === "finish" && runtime.noProgressSlices >= ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES)
    ) {
      result = {
        ...result,
        decision: "blocked",
        requestedCalls: undefined,
        finalResponse: undefined,
        blockers: [...new Set([...result.blockers, ...stallReasons])],
        nextActions: [...new Set([...result.nextActions, "Provide new evidence or revise the execution route."])],
      }
    }
    if (result.decision === "continue") {
      const cap = runtime.deliveryProgress
        ? ExecutionCheckpoint.MAX_SLICE_CALLS
        : ExecutionCheckpoint.MIN_CHECKPOINT_CALLS
      result.requestedCalls = Math.min(
        cap,
        Math.max(ExecutionCheckpoint.MIN_CHECKPOINT_CALLS, result.requestedCalls ?? 0),
      )
    }
    return result
  }

  function finalizationConstraints(
    executionID: string,
    runtime?: ReturnType<typeof checkpointRuntimeState>,
    callerInvocationID?: string,
  ): string[] {
    const existing = getExecutionState(executionID)
    if (!existing) return []
    const currentRuntime = runtime ?? checkpointRuntimeState(executionID, callerInvocationID)
    return [
      existing.extensionCount >= ExecutionCheckpoint.MAX_EXTENSIONS ? "Execution extension limit reached." : undefined,
      currentRuntime.noProgressSlices >= ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES
        ? "No verifiable progress was recorded across consecutive execution slices."
        : undefined,
      hasRepeatedTail(existing.evidence.recentToolCallSignatures, 3) && !currentRuntime.hasDistinctSemanticResults
        ? "The same tool call was repeated without new evidence."
        : undefined,
      hasRepeatedTail(existing.evidence.recentSemanticActionResults, 3)
        ? "The same semantic action was repeated without new evidence."
        : undefined,
      hasRepeatedTail(existing.evidence.recentToolTargets, 3) &&
      !currentRuntime.hasNewRevisions &&
      !currentRuntime.hasDistinctSemanticResults &&
      !currentRuntime.routeChanged &&
      !currentRuntime.planChanged
        ? "The same tool target was revisited without new evidence."
        : undefined,
      currentRuntime.planStateMismatch
        ? "Durable plan state moved backwards; reconcile the checkpoint before continuing."
        : undefined,
      hasRepeatedTail(existing.evidence.recentErrorFingerprints, 3)
        ? "The same tool error repeated without recovery."
        : undefined,
    ].filter((reason): reason is string => Boolean(reason))
  }

  function applyCheckpoint(
    executionID: string,
    checkpointID: string,
    checkpoint: import("../checkpoint").ExecutionCheckpoint.Result,
    evidence?: ExecutionPolicy.RuntimeEvidence,
    context?: {
      triggerMessageID?: string
      telemetry?: Record<string, unknown>
      invocationID?: string
      sessionID?: string
    },
  ) {
    const existing = getExecutionState(executionID)
    if (!existing) throw new Error("execution policy state not found")
    const runtime = checkpointRuntimeState(executionID, context?.invocationID, context?.sessionID)
    const runtimeEvidence = { ...(evidence ?? existing.evidence), noProgressSlices: runtime.noProgressSlices }
    setExecutionState(executionID, { ...existing, evidence: runtimeEvidence })
    const view = ledger().view(executionID)
    const result = ledger().applyCheckpoint({
      executionID,
      checkpointID,
      decision: checkpoint.decision,
      requestedCalls: checkpoint.requestedCalls,
      payload: {
        checkpoint,
        evidence: runtimeEvidence,
        triggerMessageID: context?.triggerMessageID,
        invocationID: context?.invocationID,
        sessionID: context?.sessionID,
        telemetry: context?.telemetry,
        routeRevision: view?.routeRevision,
        planRevision: ledger().planRevision(executionID),
        mutationRevision: ledger().revision(executionID),
      },
    })
    // The ledger commits the grant and budget together; never write a stale
    // cached policy back over that transaction (including idempotent retries).
    deleteExecutionState(executionID)
    // Accumulate route guidance from checkpoint self-critique so the next
    // work slice prompt can steer the model away from repeated failures.
    RouteGuidanceStore.restore(executionID, ledger().checkpoints(executionID))
    RouteGuidanceStore.prune(Date.now(), (id) => ledger().view(id)?.lifecycle === "terminal")
    if (view) {
      Bus.publish(Event.Checkpoint, {
        sessionID: view.rootSessionID,
        executionID,
        messageID: checkpointID,
        triggerMessageID: context?.triggerMessageID,
        sequence: result.sequence,
        checkpoint,
      })
    }
    return result
  }

  return { reconcileCheckpoint, finalizationConstraints, applyCheckpoint, checkpointRuntimeState }
}
