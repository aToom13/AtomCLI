import z from "zod"
import { Identifier } from "@/core/id/id"
import { MessageV2 } from "@/core/session/message-v2"
import { Config } from "@/core/config/config"
import type { ExecutionLedger } from "../ledger"
import type { RuntimeTypes } from "./types"

type CompletionLifecycleDependencies = {
  ledger: () => ReturnType<typeof ExecutionLedger.open>
  context: (
    sessionID: string,
    execution?: RuntimeTypes.Context,
  ) => Promise<{ store: ReturnType<typeof ExecutionLedger.open>; executionContext: RuntimeTypes.Context } | undefined>
  runID: string
  projectionLeaseMs: number
  maxContinuationPayloadBytes: number
  maxCompletionPayloadBytes: number
  maxCompletionReviewBytes: number
  maxCompletionEditedFiles: number
  parseCompletion: (candidate: ExecutionLedger.Completion) => RuntimeTypes.Completion
  parseClaimOrRecordRecovery: (candidate: ExecutionLedger.CompletionClaim) => RuntimeTypes.CompletionClaim | undefined
  configuredReviewPolicy: typeof import("./policy").configuredReviewPolicy
  contentSnapshotDigest: typeof import("./policy").contentSnapshotDigest
  BudgetExceededError: new (reason: string, executionID?: string, detail?: string) => Error
  stopLease: (executionID: string, reason?: string) => void
}

export function createCompletionLifecycle(input: CompletionLifecycleDependencies) {
  const {
    ledger,
    context,
    runID,
    projectionLeaseMs,
    maxContinuationPayloadBytes,
    maxCompletionPayloadBytes,
    maxCompletionReviewBytes,
    maxCompletionEditedFiles,
    parseCompletion,
    parseClaimOrRecordRecovery,
    configuredReviewPolicy,
    contentSnapshotDigest,
    BudgetExceededError,
    stopLease,
  } = input
  const PROJECTION_LEASE_MS = projectionLeaseMs
  const MAX_CONTINUATION_PAYLOAD_BYTES = maxContinuationPayloadBytes
  const MAX_COMPLETION_PAYLOAD_BYTES = maxCompletionPayloadBytes
  const MAX_COMPLETION_REVIEW_BYTES = maxCompletionReviewBytes
  const MAX_COMPLETION_EDITED_FILES = maxCompletionEditedFiles
  function pendingCompletions(sessionID: string) {
    return ledger().pendingCompletions(sessionID).map(parseCompletion)
  }

  function claimCompletions(sessionID: string) {
    return ledger()
      .claimCompletions({ sessionID, projectorID: runID, leaseMs: PROJECTION_LEASE_MS })
      .flatMap((candidate) => {
        const parsed = parseClaimOrRecordRecovery(candidate)
        return parsed ? [parsed] : []
      })
  }

  function claimCompletion(sessionID: string, executionID: string) {
    const candidate = ledger()
      .claimCompletions({ sessionID, executionID, projectorID: runID, leaseMs: PROJECTION_LEASE_MS })
      .at(0)
    return candidate ? parseClaimOrRecordRecovery(candidate) : undefined
  }

  function ackCompletion(claim: RuntimeTypes.CompletionClaim) {
    return ledger().ackCompletion({
      executionID: claim.executionID,
      digest: claim.digest,
      projectorID: claim.projectorID,
      projectionToken: claim.projectionToken,
      sessionGeneration: claim.sessionGeneration,
    })
  }

  function markProjectionRecovery(
    claim: RuntimeTypes.CompletionClaim,
    reasonCode: "invalid_payload" | "missing_message",
  ) {
    return ledger().markProjectionRecovery({
      executionID: claim.executionID,
      digest: claim.digest,
      projectorID: claim.projectorID,
      projectionToken: claim.projectionToken,
      sessionGeneration: claim.sessionGeneration,
      reasonCode,
    })
  }

  function deleteSessions(sessionIDs: string[], sessionGenerations?: Record<string, number>) {
    return ledger().deleteSessions({ sessionIDs, sessionGenerations })
  }

  function pendingContinuations(sessionID: string) {
    return ledger()
      .pendingContinuations(sessionID)
      .map((item) => ({
        ...item,
        payload: z.object({ message: MessageV2.User, part: MessageV2.TextPart }).parse(JSON.parse(item.payload)),
      }))
  }

  function projectContinuation(id: string) {
    return ledger().projectContinuation({ id })
  }

  async function retryCompletion(input: {
    sessionID: string
    execution: RuntimeTypes.Context
    digest: string
    message: MessageV2.User
    part: MessageV2.TextPart
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const payload = JSON.stringify({ message: input.message, part: input.part })
    if (new TextEncoder().encode(payload).byteLength > MAX_CONTINUATION_PAYLOAD_BYTES) {
      throw new Error(`Continuation payload exceeds ${MAX_CONTINUATION_PAYLOAD_BYTES} bytes`)
    }
    const id = `review-retry:${input.execution.executionID}:${input.digest}`
    const accepted = resolved.store.retryCompletion({
      id,
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      invocationID: input.message.id,
      rootSessionID: input.execution.rootSessionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      payload,
    })
    if (!accepted.accepted) throw new BudgetExceededError(accepted.reason, input.execution.executionID)
    return { id, message: input.message, part: input.part }
  }

  async function stageCompletion(input: {
    sessionID: string
    messageID: string
    finish: string
    parts: MessageV2.TextPart[]
    editedFiles: string[]
    requiresReview: boolean
    reviewDecision?: RuntimeTypes.ReviewDecision
    execution: RuntimeTypes.Context
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const parts = MessageV2.TextPart.array().parse(input.parts)
    // `reviewFiles()` unions every session in the completion tree and each session may
    // already track up to MAX_EDITED_FILES_TRACKED, so the union can cross this cap
    // without any single session doing so. Reject it as a classified budget
    // condition; letting Zod throw here escapes the session loop as a raw ZodError.
    if (input.editedFiles.length > MAX_COMPLETION_EDITED_FILES) {
      throw new BudgetExceededError(
        "review_scope_exceeded",
        input.execution.executionID,
        `Completion covers ${input.editedFiles.length} edited files, above the ${MAX_COMPLETION_EDITED_FILES} limit`,
      )
    }
    const editedFiles = z.string().array().max(MAX_COMPLETION_EDITED_FILES).parse(input.editedFiles)
    const reviewFiles = JSON.stringify(editedFiles)
    if (new TextEncoder().encode(reviewFiles).byteLength > MAX_COMPLETION_REVIEW_BYTES) {
      throw new Error(`Completion review evidence exceeds ${MAX_COMPLETION_REVIEW_BYTES} bytes`)
    }
    const revision = resolved.store.revision(input.execution.executionID)
    if (revision === undefined) throw new BudgetExceededError("not_active", input.execution.executionID)
    const planRevision = resolved.store.planRevision(input.execution.executionID)
    if (planRevision === undefined) throw new BudgetExceededError("not_active", input.execution.executionID)
    const config = await Config.get()
    const configuredPolicy = configuredReviewPolicy(config, input.sessionID)
    const reviewDecision: RuntimeTypes.ReviewDecision = input.reviewDecision ?? {
      policyVersion: configuredPolicy.policyVersion,
      policyDigest: configuredPolicy.policyDigest,
      requirement: input.requiresReview ? "required" : "not_required",
      reasonCode: "legacy_callsite",
      requiredReviewers: input.requiresReview ? configuredPolicy.reviewerCount : 0,
      attemptLimit: configuredPolicy.attemptLimit,
    }
    if (reviewDecision.policyDigest !== configuredPolicy.policyDigest) {
      throw new BudgetExceededError("stale_policy", input.execution.executionID)
    }
    if (input.requiresReview !== (reviewDecision.requirement === "required")) {
      throw new BudgetExceededError("invalid_review_policy", input.execution.executionID)
    }
    const lastPart = parts.at(-1)
    if (reviewDecision.reasonCode === "review_advised" && lastPart) {
      lastPart.text +=
        "\n\nIndependent review recommended for these changes. Automatic review did not run; request /review for an independent assessment."
      lastPart.metadata = { ...lastPart.metadata, reviewAdvisory: true }
    }
    const payload = JSON.stringify(parts)
    if (new TextEncoder().encode(payload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const snapshotDigest = await contentSnapshotDigest(editedFiles)
    const digestInput = JSON.stringify({
      sessionID: input.sessionID,
      messageID: input.messageID,
      finish: input.finish,
      parts,
      editedFiles,
      requiresReview: input.requiresReview,
      revision,
      planRevision,
      reviewDecision,
      contentSnapshotDigest: snapshotDigest,
    })
    const digest = new Bun.CryptoHasher("sha256").update(digestInput).digest("hex")
    const staged = resolved.store.stageCompletion({
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      finish: input.finish,
      payload,
      reviewFiles,
      digest,
      requiresReview: input.requiresReview,
      revision,
      planRevision,
      policyVersion: reviewDecision.policyVersion,
      policyDigest: reviewDecision.policyDigest,
      reviewRequirement: reviewDecision.requirement,
      reviewReasonCode: reviewDecision.reasonCode,
      requiredReviewers: reviewDecision.requiredReviewers,
      attemptLimit: reviewDecision.attemptLimit,
      contentSnapshotDigest: snapshotDigest,
    })
    if (!staged.staged) throw new BudgetExceededError(staged.reason, input.execution.executionID)
    return parseCompletion(staged.completion)
  }

  async function claimReview(input: {
    sessionID: string
    execution: RuntimeTypes.Context
    digest: string
    revision: number
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const claimed = resolved.store.claimReview({
      id: crypto.randomUUID(),
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      revision: input.revision,
    })
    if (!claimed.claimed) throw new BudgetExceededError(claimed.reason, input.execution.executionID)
    return claimed.claim
  }

  /**
   * REV-03: persist an orchestrator QA PASS for a workspace revision so every
   * later review layer for the same revision reuses this single durable
   * decision instead of spawning a second reviewer set.
   */
  function recordQAReview(input: {
    executionID: string
    revision: number
    reviewedFiles?: string[]
    acceptanceVerified?: boolean
    acceptanceRequestHash?: string
  }) {
    return ledger().recordQAReview({ ...input, verdict: "passed" })
  }

  function qaReviewPassed(
    executionID: string,
    revision: number,
    requireAcceptance = false,
    acceptanceRequestHash?: string,
  ) {
    return ledger().qaReviewPassed({ executionID, revision, requireAcceptance, acceptanceRequestHash })
  }

  async function authorizeReviewSession(input: {
    sessionID: string
    reviewerSessionID: string
    execution: RuntimeTypes.Context
    reviewID: string
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const authorized = resolved.store.authorizeReviewSession({
      executionID: input.execution.executionID,
      reviewID: input.reviewID,
      sessionID: input.reviewerSessionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
    })
    if (!authorized.authorized) throw new BudgetExceededError(authorized.reason, input.execution.executionID)
  }

  async function recordReview(input: {
    sessionID: string
    execution: RuntimeTypes.Context
    reviewID: string
    state: "passed" | "rejected" | "inconclusive"
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const recorded = resolved.store.recordReview({
      executionID: input.execution.executionID,
      reviewID: input.reviewID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      state: input.state,
    })
    if (!recorded.recorded) throw new BudgetExceededError(recorded.reason, input.execution.executionID)
    return recorded.claim
  }

  async function commitCompletion(input: { sessionID: string; execution: RuntimeTypes.Context; digest: string }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const candidate = resolved.store.completion(input.execution.executionID)
    if (!candidate) throw new BudgetExceededError("not_staged", input.execution.executionID)
    const config = await Config.get()
    const currentPolicy = configuredReviewPolicy(config, input.sessionID)
    if (candidate.policyDigest !== currentPolicy.policyDigest) {
      throw new BudgetExceededError("stale_policy", input.execution.executionID)
    }
    const snapshotDigest = await contentSnapshotDigest(z.string().array().parse(JSON.parse(candidate.reviewFiles)))
    const committed = resolved.store.commitCompletion({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      policyDigest: currentPolicy.policyDigest,
      contentSnapshotDigest: snapshotDigest,
    })
    if (!committed.committed) throw new BudgetExceededError(committed.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(committed.completion)
  }

  async function finalizeBlocked(input: {
    sessionID: string
    execution: RuntimeTypes.Context
    digest: string
    parts: MessageV2.TextPart[]
    reasonCode: "review_rejected" | "review_unavailable"
    reasonMessage: string
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const parts = MessageV2.TextPart.array().parse(input.parts)
    const deliveryPayload = JSON.stringify(parts)
    if (new TextEncoder().encode(deliveryPayload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const finalized = resolved.store.finalizeBlocked({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      deliveryPayload,
      deliveryFinish: "error",
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
    })
    if (!finalized.finalized) throw new BudgetExceededError(finalized.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(finalized.completion)
  }

  function finalizeOutcome(input: {
    sessionID: string
    messageID: string
    parts?: MessageV2.TextPart[]
    execution: RuntimeTypes.Context
    failure: RuntimeTypes.TerminalFailure
  }) {
    if (input.execution.ownerID !== runID) {
      throw new BudgetExceededError("stale_fence", input.execution.executionID)
    }
    const parts = input.parts ?? []
    const payload = JSON.stringify(parts)
    if (new TextEncoder().encode(payload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(
      JSON.stringify({
        executionID: input.execution.executionID,
        sessionID: input.sessionID,
        messageID: input.messageID,
        outcome: input.failure.outcome,
        reasonCode: input.failure.reasonCode,
        payload,
      }),
    )
    const digest = hasher.digest("hex")
    const finalized = ledger().finalizeOutcome({
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      finish: "error",
      payload,
      digest,
      ...input.failure,
    })
    if (!finalized.finalized) throw new BudgetExceededError(finalized.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(finalized.completion)
  }

  async function discardCompletion(input: { sessionID: string; execution: RuntimeTypes.Context; digest: string }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const discarded = resolved.store.discardCompletion({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
    })
    if (!discarded.discarded) throw new BudgetExceededError(discarded.reason, input.execution.executionID)
  }

  return {
    pendingCompletions,
    claimCompletions,
    claimCompletion,
    ackCompletion,
    markProjectionRecovery,
    deleteSessions,
    pendingContinuations,
    projectContinuation,
    retryCompletion,
    stageCompletion,
    claimReview,
    recordQAReview,
    qaReviewPassed,
    authorizeReviewSession,
    recordReview,
    commitCompletion,
    finalizeBlocked,
    finalizeOutcome,
    discardCompletion,
  }
}
