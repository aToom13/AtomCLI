import { ExecutionCheckpoint } from "../checkpoint"
import type { ExecutionLedger } from "../ledger"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import type { ExecutionState } from "./state"

type StateInput = Omit<
  ExecutionState,
  "lastTouchedAt" | "extensionCount" | "sliceLimit" | "sliceStartCalls" | "sliceUsedCalls"
> &
  Partial<Pick<ExecutionState, "extensionCount" | "sliceLimit" | "sliceStartCalls" | "sliceUsedCalls">>

type Dependencies = {
  ledger: () => ReturnType<typeof ExecutionLedger.open>
  getState: (executionID: string) => ExecutionState | undefined
  setState: (executionID: string, state: StateInput) => void
  updateState: (executionID: string, state: ExecutionState) => void
  makeBudgetError: (reason: string, executionID: string) => Error
  logPromotion: (kind: "scope" | "risk", data: Record<string, unknown>) => void
  hasRepeatedTail: (values: string[] | undefined, count: number) => boolean
}

function mergeFileWriteCounts(prev?: Record<string, number>, next?: Record<string, number>) {
  if (!prev && !next) return
  const merged: Record<string, number> = { ...(prev ?? {}) }
  for (const [file, count] of Object.entries(next ?? {})) merged[file] = (merged[file] ?? 0) + count
  return merged
}

export function createEvidenceRuntime(input: Dependencies) {
  function hasNewEvidencePath(current?: string[], prior?: string[]) {
    if (!current?.length) return false
    const seen = new Set(prior ?? [])
    return current.some((item) => !seen.has(item))
  }

  function resolveExecutionPolicy(executionID: string, evidence?: ExecutionPolicy.RuntimeEvidence) {
    const existing = input.getState(executionID)
    const contract = existing?.contract ?? ExecutionContract.fallback("default_runtime_policy")
    const prev = existing?.evidence ?? {}
    const next = evidence ?? {}
    const mergedEvidence: ExecutionPolicy.RuntimeEvidence = {
      ...prev,
      ...next,
      filesRead: [...new Set([...(prev.filesRead ?? []), ...(next.filesRead ?? [])])],
      filesChanged: [...new Set([...(prev.filesChanged ?? []), ...(next.filesChanged ?? [])])],
      fileWriteCounts: mergeFileWriteCounts(prev.fileWriteCounts, next.fileWriteCounts),
      packagesTouched: [...new Set([...(prev.packagesTouched ?? []), ...(next.packagesTouched ?? [])])],
      mutatingCalls: (prev.mutatingCalls ?? 0) + (next.mutatingCalls ?? 0),
      externalCalls: (prev.externalCalls ?? 0) + (next.externalCalls ?? 0),
      toolCalls: (prev.toolCalls ?? 0) + (next.toolCalls ?? 0),
      successfulToolCalls: (prev.successfulToolCalls ?? 0) + (next.successfulToolCalls ?? 0),
      browserNavigations:
        (next.mutatingCalls ?? 0) > 0 ? 0 : (prev.browserNavigations ?? 0) + (next.browserNavigations ?? 0),
      browserVerificationCalls:
        (next.mutatingCalls ?? 0) > 0 ? 0 : (prev.browserVerificationCalls ?? 0) + (next.browserVerificationCalls ?? 0),
      recentToolCallSignatures: [
        ...(prev.recentToolCallSignatures ?? []),
        ...(next.recentToolCallSignatures ?? []),
      ].slice(-6),
      recentToolFamilies: [...(prev.recentToolFamilies ?? []), ...(next.recentToolFamilies ?? [])].slice(-6),
      recentToolTargets: [...(prev.recentToolTargets ?? []), ...(next.recentToolTargets ?? [])].slice(-6),
      recentSemanticActionResults: [
        ...(next.filesChanged?.length ? [] : (prev.recentSemanticActionResults ?? [])),
        ...(next.recentSemanticActionResults ?? []),
      ].slice(-24),
      recentErrorFingerprints:
        (next.successfulToolCalls ?? 0) > 0 && (next.failureCount ?? 0) === 0
          ? []
          : [...(prev.recentErrorFingerprints ?? []), ...(next.recentErrorFingerprints ?? [])].slice(-6),
      failureCount: (prev.failureCount ?? 0) + (next.failureCount ?? 0),
      subtasksSpawned: (prev.subtasksSpawned ?? 0) + (next.subtasksSpawned ?? 0),
      hasAuthOrSecurityEffect: Boolean(prev.hasAuthOrSecurityEffect || next.hasAuthOrSecurityEffect),
      hasSchemaOrMigrationEffect: Boolean(prev.hasSchemaOrMigrationEffect || next.hasSchemaOrMigrationEffect),
      hasPublicApiEffect: Boolean(prev.hasPublicApiEffect || next.hasPublicApiEffect),
      hasDestructiveAction: Boolean(prev.hasDestructiveAction || next.hasDestructiveAction),
      uncertainOutcome: Boolean(prev.uncertainOutcome || next.uncertainOutcome),
    }
    const policy = ExecutionPolicy.resolvePolicy(
      contract,
      mergedEvidence,
      existing?.promotionReasons ?? [],
      existing?.policy,
    )
    input.setState(executionID, {
      contract,
      policy,
      evidence: mergedEvidence,
      promotionReasons: policy.promotionReasons,
      classifierFallback: existing?.classifierFallback ?? false,
    })
    return policy
  }

  function promoteScope(executionID: string, targetScope: ExecutionContract.Scope, reason: string) {
    const existing = input.getState(executionID)
    if (!existing || !ExecutionPolicy.canPromoteScope(existing.policy.scope, targetScope)) return false
    const contract: ExecutionContract.Info = { ...existing.contract, scope: targetScope }
    const policy = ExecutionPolicy.resolvePolicy(
      contract,
      existing.evidence,
      [...existing.promotionReasons, reason],
      existing.policy,
    )
    input.setState(executionID, {
      contract,
      policy,
      evidence: existing.evidence,
      promotionReasons: policy.promotionReasons,
      classifierFallback: existing.classifierFallback,
    })
    input.logPromotion("scope", { executionID, from: existing.policy.scope, to: targetScope, reason })
    return true
  }

  function promoteRisk(executionID: string, targetRisk: ExecutionContract.Risk, reason: string) {
    const existing = input.getState(executionID)
    if (!existing || !ExecutionPolicy.canPromoteRisk(existing.policy.risk, targetRisk)) return false
    const contract: ExecutionContract.Info = { ...existing.contract, risk: targetRisk }
    const policy = ExecutionPolicy.resolvePolicy(
      contract,
      existing.evidence,
      [...existing.promotionReasons, reason],
      existing.policy,
    )
    input.setState(executionID, {
      contract,
      policy,
      evidence: existing.evidence,
      promotionReasons: policy.promotionReasons,
      classifierFallback: existing.classifierFallback,
    })
    input.logPromotion("risk", { executionID, from: existing.policy.risk, to: targetRisk, reason })
    return true
  }

  function recordRuntimeEvidence(executionID: string, evidence: ExecutionPolicy.RuntimeEvidence) {
    if (!input.getState(executionID)) return
    return resolveExecutionPolicy(executionID, evidence)
  }

  function checkpointReason(executionID: string) {
    const sliceReason = input.ledger().sliceCheckpointReason(executionID)
    if (sliceReason) return sliceReason
    const existing = input.getState(executionID)
    if (!existing) return
    const maxSteps = existing.policy?.budget?.maxSteps
    const stepThresholdHandled = input
      .ledger()
      .checkpoints(executionID)
      .some((item) => item.payload?.telemetry?.reason === "step_threshold")
    if (
      maxSteps &&
      maxSteps > 2 &&
      !stepThresholdHandled &&
      input.ledger().stepCount(executionID) >= Math.ceil(maxSteps * 0.8)
    ) {
      return "step_threshold"
    }
    const previous = input.ledger().checkpoints(executionID).at(-1)?.payload as
      | {
          evidence?: ExecutionPolicy.RuntimeEvidence
          routeRevision?: number
          planRevision?: number
          mutationRevision?: number
          checkpoint?: { decision: string }
        }
      | undefined
    const currentPlanRevision = input.ledger().planRevision(executionID) ?? 0
    if (previous && (previous.planRevision ?? 0) > currentPlanRevision) return "plan_state_mismatch"
    const priorWriteCounts = previous?.evidence?.fileWriteCounts ?? {}
    const hasNewWriteRevision = Object.entries(existing.evidence.fileWriteCounts ?? {}).some(
      ([file, count]) => count > (priorWriteCounts[file] ?? 0),
    )
    const semanticTail = (existing.evidence.recentSemanticActionResults ?? []).slice(-3)
    const hasDistinctSemanticResults = semanticTail.length === 3 && new Set(semanticTail).size > 1
    const view = input.ledger().view(executionID)
    if (
      previous?.checkpoint?.decision === "continue" &&
      Bun.deepEquals(existing.evidence, previous.evidence) &&
      currentPlanRevision === (previous.planRevision ?? currentPlanRevision) &&
      (!view || view.routeRevision === (previous.routeRevision ?? view.routeRevision))
    )
      return
    if ((existing.evidence.failureCount ?? 0) >= (previous?.evidence?.failureCount ?? 0) + 3) return "repeated_failures"
    if ((existing.evidence.noProgressSlices ?? 0) >= ExecutionCheckpoint.MAX_NO_PROGRESS_SLICES) return "no_progress"
    if (input.hasRepeatedTail(existing.evidence.recentToolCallSignatures, 3) && !hasDistinctSemanticResults)
      return "repeated_tool_call"
    if (input.hasRepeatedTail(existing.evidence.recentSemanticActionResults, 3)) return "repeated_semantic_action"
    if (
      input.hasRepeatedTail(existing.evidence.recentToolTargets, 3) &&
      !hasNewWriteRevision &&
      !hasDistinctSemanticResults
    ) {
      return "repeated_tool_target"
    }
    if (input.hasRepeatedTail(existing.evidence.recentErrorFingerprints, 3)) return "repeated_error"
    if (!previous) return
    const changed = Boolean(
      view &&
        (view.routeRevision > (previous.routeRevision ?? view.routeRevision) ||
          (input.ledger().planRevision(executionID) ?? 0) >
            (previous.planRevision ?? input.ledger().planRevision(executionID) ?? 0)),
    )
    return changed ? "route_or_plan_changed" : undefined
  }

  function reserveToolCall(executionID: string) {
    if (!input.getState(executionID)) return
    if (!input.ledger().reserveToolAllowance(executionID))
      throw input.makeBudgetError("checkpoint_required", executionID)
  }

  function recordToolCall(
    executionID: string,
    evidence?: ExecutionPolicy.RuntimeEvidence,
    options?: { signature?: string; family?: string; target?: string },
  ) {
    const existing = input.getState(executionID)
    if (!existing) return
    existing.sliceUsedCalls = input.ledger().sliceUsedCalls(executionID)
    input.updateState(executionID, existing)
    return resolveExecutionPolicy(executionID, {
      ...(evidence ?? {}),
      toolCalls: 1,
      recentToolCallSignatures: options?.signature ? [options.signature] : [],
      recentToolFamilies: options?.family ? [options.family] : [],
      recentToolTargets: [options?.target ?? ""],
    })
  }

  function admitToolCall(
    executionID: string,
    evidence?: ExecutionPolicy.RuntimeEvidence,
    options?: { signature?: string; family?: string; target?: string },
  ) {
    if (!input.getState(executionID)) return
    reserveToolCall(executionID)
    return recordToolCall(executionID, evidence, options)
  }

  return {
    hasNewEvidencePath,
    resolveExecutionPolicy,
    promoteScope,
    promoteRisk,
    recordRuntimeEvidence,
    isCheckpointRequired: (executionID: string) => checkpointReason(executionID) !== undefined,
    checkpointReason,
    requestCheckpoint: (executionID: string) => input.ledger().requestCheckpoint(executionID),
    admitToolCall,
    reserveToolCall,
    releaseToolCall: (executionID: string) => input.ledger().releaseToolAllowance(executionID),
    recordToolCall,
    recordSemanticActionResult: (executionID: string, signature: string, resultFingerprint: string) =>
      resolveExecutionPolicy(executionID, {
        recentSemanticActionResults: [`${signature}:${resultFingerprint}`],
      }),
  }
}
