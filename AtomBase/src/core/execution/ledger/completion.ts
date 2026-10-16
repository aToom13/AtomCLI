import { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

const MAX_PENDING_CONTINUATIONS = 100

type CurrentExecution = {
  status: string
  outcome: ExecutionLedger.ExecutionOutcome | null
  mutation_revision: number
  plan_revision: number
  route_revision: number
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): CurrentExecution | undefined
  completion(executionID: string): ExecutionLedger.Completion | undefined
  reviewClaim(executionID: string): ExecutionLedger.ReviewClaim | undefined
  hasUnresolvedTasks(executionID: string): boolean
  ownershipValid(current: CurrentExecution, ownerID: string | undefined, fence: number, now: number): boolean
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties?: Record<string, unknown>,
  ): void
}

export function createCompletionModule(ctx: Context) {
  const { db, transaction } = ctx

  return {
    stageCompletion(
      input: Omit<
        ExecutionLedger.Completion,
        | "state"
        | "projection"
        | "planRevision"
        | "routeRevision"
        | "policyVersion"
        | "policyDigest"
        | "reviewRequirement"
        | "reviewReasonCode"
        | "requiredReviewers"
        | "attemptLimit"
        | "contentSnapshotDigest"
      > &
        Partial<
          Pick<
            ExecutionLedger.Completion,
            | "planRevision"
            | "policyVersion"
            | "policyDigest"
            | "reviewRequirement"
            | "reviewReasonCode"
            | "requiredReviewers"
            | "attemptLimit"
            | "contentSnapshotDigest"
          >
        > & { now?: number },
    ) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { staged: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { staged: false as const, reason: "stale_fence" as const }
        }
        if (current.mutation_revision !== input.revision) {
          return { staged: false as const, reason: "stale_revision" as const }
        }
        const planRevision = input.planRevision ?? current.plan_revision
        const reviewRequirement = input.reviewRequirement ?? (input.requiresReview ? "required" : "not_required")
        if (input.requiresReview !== (reviewRequirement === "required")) {
          return { staged: false as const, reason: "invalid_review_policy" as const }
        }
        if (current.plan_revision !== planRevision) {
          return { staged: false as const, reason: "stale_plan_revision" as const }
        }
        const openWork = db
          .query<
            { count: number },
            [string]
          >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND state IN ('prepared', 'running', 'draining', 'unknown')")
          .get(input.executionID)?.count
        if ((openWork ?? 0) > 0) return { staged: false as const, reason: "active_work" as const }
        const openBlockers = db
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) AS count FROM execution_blocker
             WHERE execution_id = ? AND state NOT IN ('resolved', 'waived', 'cancelled')`,
          )
          .get(input.executionID)?.count
        if ((openBlockers ?? 0) > 0) return { staged: false as const, reason: "active_blocker" as const }
        if (ctx.hasUnresolvedTasks(input.executionID)) return { staged: false as const, reason: "active_task" as const }
        const existing = ctx.completion(input.executionID)
        if (existing?.state === "committed") {
          if (existing.digest !== input.digest) return { staged: false as const, reason: "already_committed" as const }
          return { staged: true as const, idempotent: true, completion: existing }
        }
        if (existing?.state === "staged" && existing.digest === input.digest) {
          return { staged: true as const, idempotent: true, completion: existing }
        }
        if (existing?.state === "staged" && ctx.reviewClaim(input.executionID)?.state === "pending") {
          return { staged: false as const, reason: "review_active" as const }
        }
        if (existing?.state === "staged" && existing.requiresReview && !input.requiresReview) {
          return { staged: false as const, reason: "review_required" as const }
        }
        db.query(
          `INSERT INTO execution_completion
            (execution_id, session_id, message_id, owner_id, fence, finish, payload, review_files, digest,
             requires_review, revision, plan_revision, route_revision, policy_version, policy_digest, review_requirement,
             review_reason_code, required_reviewers, attempt_limit, content_snapshot_digest, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)
           ON CONFLICT(execution_id) DO UPDATE SET
            session_id = excluded.session_id,
            message_id = excluded.message_id,
            owner_id = excluded.owner_id,
            fence = excluded.fence,
            finish = excluded.finish,
            payload = excluded.payload,
            review_files = excluded.review_files,
            digest = excluded.digest,
            requires_review = excluded.requires_review,
            revision = excluded.revision,
            plan_revision = excluded.plan_revision,
            route_revision = excluded.route_revision,
            policy_version = excluded.policy_version,
            policy_digest = excluded.policy_digest,
            review_requirement = excluded.review_requirement,
            review_reason_code = excluded.review_reason_code,
            required_reviewers = excluded.required_reviewers,
            attempt_limit = excluded.attempt_limit,
            content_snapshot_digest = excluded.content_snapshot_digest,
            delivery_payload = NULL,
            delivery_finish = NULL,
            terminal_outcome = NULL,
            reason_code = NULL,
            projection_state = 'pending',
            projection_owner = NULL,
            projection_token = NULL,
            projection_lease_expires_at = NULL,
            state = 'staged',
            created_at = excluded.created_at,
            committed_at = NULL`,
        ).run(
          input.executionID,
          input.sessionID,
          input.messageID,
          input.ownerID,
          input.fence,
          input.finish,
          input.payload,
          input.reviewFiles,
          input.digest,
          input.requiresReview ? 1 : 0,
          input.revision,
          planRevision,
          current.route_revision,
          input.policyVersion ?? 1,
          input.policyDigest ?? "legacy",
          reviewRequirement,
          input.reviewReasonCode ?? "legacy",
          input.requiredReviewers ?? (reviewRequirement === "required" ? 1 : 0),
          input.attemptLimit ?? 0,
          input.contentSnapshotDigest ?? "legacy",
          now,
        )
        db.query(
          `UPDATE execution SET status = 'finalizing', lifecycle = 'active', phase = 'finalizing',
             version = version + 1, updated_at = ? WHERE id = ?`,
        ).run(now, input.executionID)
        return { staged: true as const, idempotent: false, completion: ctx.completion(input.executionID)! }
      })
    },

    claimReview(input: {
      id: string
      executionID: string
      ownerID: string
      fence: number
      digest: string
      revision: number
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || current.status !== "finalizing")
          return { claimed: false as const, reason: "not_active" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { claimed: false as const, reason: "stale_fence" as const }
        }
        const candidate = ctx.completion(input.executionID)
        if (
          !candidate ||
          candidate.state !== "staged" ||
          !candidate.requiresReview ||
          candidate.digest !== input.digest ||
          candidate.revision !== input.revision
        ) {
          return { claimed: false as const, reason: "stale_candidate" as const }
        }
        const existing = ctx.reviewClaim(input.executionID)
        if (existing?.digest === input.digest && existing.revision === input.revision) {
          return { claimed: true as const, idempotent: true, claim: existing }
        }
        db.query(
          `INSERT INTO execution_review
            (execution_id, id, digest, revision, owner_id, fence, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
           ON CONFLICT(execution_id) DO UPDATE SET
            id = excluded.id, digest = excluded.digest, revision = excluded.revision,
            owner_id = excluded.owner_id, fence = excluded.fence, state = 'pending',
            created_at = excluded.created_at, decided_at = NULL`,
        ).run(input.executionID, input.id, input.digest, input.revision, input.ownerID, input.fence, now)
        db.query("DELETE FROM execution_review_session WHERE execution_id = ?").run(input.executionID)
        return { claimed: true as const, idempotent: false, claim: ctx.reviewClaim(input.executionID)! }
      })
    },

    recordQAReview(input: {
      executionID: string
      revision: number
      verdict: "passed"
      reviewedFiles?: string[]
      acceptanceVerified?: boolean
      acceptanceRequestHash?: string
      now?: number
    }) {
      return transaction(() => {
        db.query(
          `INSERT INTO execution_review_qa (execution_id, revision, verdict, reviewed_files, created_at, acceptance_verified, acceptance_request_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(execution_id, revision) DO UPDATE SET
             verdict = excluded.verdict, reviewed_files = excluded.reviewed_files, created_at = excluded.created_at,
             acceptance_verified = excluded.acceptance_verified, acceptance_request_hash = excluded.acceptance_request_hash`,
        ).run(
          input.executionID,
          input.revision,
          input.verdict,
          JSON.stringify(input.reviewedFiles ?? []),
          input.now ?? Date.now(),
          input.acceptanceVerified ? 1 : 0,
          input.acceptanceRequestHash ?? null,
        )
        return { recorded: true as const, idempotent: false }
      })
    },

    qaReviewPassed(input: {
      executionID: string
      revision: number
      requireAcceptance?: boolean
      acceptanceRequestHash?: string
    }) {
      const row = db
        .query<
          { verdict: string; acceptance_verified: number; acceptance_request_hash: string | null },
          [string, number]
        >("SELECT verdict, acceptance_verified, acceptance_request_hash FROM execution_review_qa WHERE execution_id = ? AND revision = ?")
        .get(input.executionID, input.revision)
      return (
        row?.verdict === "passed" &&
        (!input.requireAcceptance || row.acceptance_verified === 1) &&
        (!input.acceptanceRequestHash || row.acceptance_request_hash === input.acceptanceRequestHash)
      )
    },

    authorizeReviewSession(input: {
      executionID: string
      reviewID: string
      sessionID: string
      ownerID: string
      fence: number
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || current.status !== "finalizing")
          return { authorized: false as const, reason: "not_active" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { authorized: false as const, reason: "stale_fence" as const }
        }
        const claim = ctx.reviewClaim(input.executionID)
        if (!claim || claim.id !== input.reviewID || claim.state !== "pending") {
          return { authorized: false as const, reason: "review_required" as const }
        }
        db.query(
          `INSERT INTO execution_review_session (session_id, execution_id, review_id, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
            execution_id = excluded.execution_id, review_id = excluded.review_id, created_at = excluded.created_at`,
        ).run(input.sessionID, input.executionID, input.reviewID, now)
        return { authorized: true as const }
      })
    },

    recordReview(input: {
      executionID: string
      reviewID: string
      ownerID: string
      fence: number
      state: Exclude<ExecutionLedger.ReviewState, "pending">
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || current.status !== "finalizing")
          return { recorded: false as const, reason: "not_active" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { recorded: false as const, reason: "stale_fence" as const }
        }
        const claim = ctx.reviewClaim(input.executionID)
        if (!claim || claim.id !== input.reviewID) {
          return { recorded: false as const, reason: "review_required" as const }
        }
        if (claim.state !== "pending") {
          return claim.state === input.state
            ? { recorded: true as const, idempotent: true, claim }
            : { recorded: false as const, reason: "review_decided" as const }
        }
        db.query("UPDATE execution_review SET state = ?, decided_at = ? WHERE execution_id = ?").run(
          input.state,
          now,
          input.executionID,
        )
        return { recorded: true as const, idempotent: false, claim: ctx.reviewClaim(input.executionID)! }
      })
    },

    commitCompletion(input: {
      executionID: string
      ownerID: string
      fence: number
      digest: string
      policyDigest?: string
      contentSnapshotDigest?: string
      deliveryPayload?: string
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing", "terminal"].includes(current.status)) {
          return { committed: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { committed: false as const, reason: "stale_fence" as const }
        }
        const candidate = ctx.completion(input.executionID)
        if (!candidate || candidate.state === "discarded") {
          return { committed: false as const, reason: "not_staged" as const }
        }
        if (candidate.digest !== input.digest) {
          return { committed: false as const, reason: "stale_candidate" as const }
        }
        if (current.outcome !== null) {
          return current.outcome === "completed" && candidate.state === "committed" && candidate.outcome === "completed"
            ? { committed: true as const, idempotent: true, completion: candidate }
            : { committed: false as const, reason: "terminal_outcome" as const }
        }
        if (candidate.revision !== current.mutation_revision) {
          return { committed: false as const, reason: "stale_revision" as const }
        }
        if (candidate.planRevision !== current.plan_revision) {
          return { committed: false as const, reason: "stale_plan_revision" as const }
        }
        if (candidate.routeRevision !== current.route_revision) {
          return { committed: false as const, reason: "stale_route" as const }
        }
        if (input.policyDigest !== undefined && candidate.policyDigest !== input.policyDigest) {
          return { committed: false as const, reason: "stale_policy" as const }
        }
        if (
          input.contentSnapshotDigest !== undefined &&
          candidate.contentSnapshotDigest !== input.contentSnapshotDigest
        ) {
          return { committed: false as const, reason: "stale_content_snapshot" as const }
        }
        if (candidate.requiresReview) {
          const review = ctx.reviewClaim(input.executionID)
          if (
            !review ||
            review.digest !== candidate.digest ||
            review.revision !== candidate.revision ||
            (review.state !== "passed" && !(review.state === "inconclusive" && input.deliveryPayload))
          ) {
            return { committed: false as const, reason: "review_required" as const }
          }
        }
        const openWork = db
          .query<
            { count: number },
            [string]
          >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND state IN ('prepared', 'running', 'draining', 'unknown')")
          .get(input.executionID)?.count
        if ((openWork ?? 0) > 0) return { committed: false as const, reason: "active_work" as const }
        const openBlockers = db
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) AS count FROM execution_blocker
             WHERE execution_id = ? AND state NOT IN ('resolved', 'waived')`,
          )
          .get(input.executionID)?.count
        if ((openBlockers ?? 0) > 0) return { committed: false as const, reason: "active_blocker" as const }
        if (ctx.hasUnresolvedTasks(input.executionID)) return { committed: false as const, reason: "active_task" as const }
        db.query(
          `UPDATE execution_completion SET state = 'committed', terminal_outcome = 'completed',
             delivery_payload = ?, delivery_finish = NULL, reason_code = NULL,
             projection_state = 'pending', projected_at = NULL, projection_owner = NULL,
             projection_token = NULL, projection_lease_expires_at = NULL, committed_at = ?
           WHERE execution_id = ?`,
        ).run(input.deliveryPayload ?? null, now, input.executionID)
        db.query(
          `UPDATE execution SET status = 'terminal', lifecycle = 'terminal', phase = 'idle',
             outcome = 'completed', reason_code = NULL, reason_message = NULL, reason_retryable = 0,
             version = version + 1, updated_at = ?, terminal_at = ?
           WHERE id = ? AND outcome IS NULL`,
        ).run(now, now, input.executionID)
        ctx.appendExecutionEvent(input.executionID, "execution.updated", now)
        return { committed: true as const, idempotent: false, completion: ctx.completion(input.executionID)! }
      })
    },

    finalizeBlocked(input: {
      executionID: string
      ownerID: string
      fence: number
      digest: string
      deliveryPayload: string
      deliveryFinish: string
      reasonCode: "review_rejected" | "review_unavailable"
      reasonMessage: string
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["finalizing", "terminal"].includes(current.status)) {
          return { finalized: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { finalized: false as const, reason: "stale_fence" as const }
        }
        const candidate = ctx.completion(input.executionID)
        if (!candidate || candidate.digest !== input.digest || candidate.state === "discarded") {
          return { finalized: false as const, reason: "stale_candidate" as const }
        }
        if (current.outcome !== null) {
          return current.outcome === "blocked" && candidate.state === "committed" && candidate.outcome === "blocked"
            ? { finalized: true as const, idempotent: true, completion: candidate }
            : { finalized: false as const, reason: "terminal_outcome" as const }
        }
        if (!candidate.requiresReview || candidate.reviewRequirement !== "required") {
          return { finalized: false as const, reason: "review_not_required" as const }
        }
        const review = ctx.reviewClaim(input.executionID)
        if (
          !review ||
          review.digest !== candidate.digest ||
          review.revision !== candidate.revision ||
          !["rejected", "inconclusive"].includes(review.state)
        ) {
          return { finalized: false as const, reason: "review_decision_required" as const }
        }
        db.query(
          `UPDATE execution_completion SET state = 'committed', terminal_outcome = 'blocked',
             delivery_payload = ?, delivery_finish = ?, reason_code = ?,
             projection_state = 'pending', projected_at = NULL, projection_owner = NULL,
             projection_token = NULL, projection_lease_expires_at = NULL, committed_at = ?
           WHERE execution_id = ?`,
        ).run(input.deliveryPayload, input.deliveryFinish, input.reasonCode, now, input.executionID)
        db.query(
          `UPDATE execution SET status = 'terminal', lifecycle = 'terminal', phase = 'idle',
             outcome = 'blocked', reason_code = ?, reason_message = ?, reason_retryable = 0,
             version = version + 1, updated_at = ?, terminal_at = ?
           WHERE id = ? AND outcome IS NULL`,
        ).run(input.reasonCode, input.reasonMessage, now, now, input.executionID)
        ctx.appendExecutionEvent(input.executionID, "execution.updated", now)
        return { finalized: true as const, idempotent: false, completion: ctx.completion(input.executionID)! }
      })
    },

    finalizeOutcome(input: {
      executionID: string
      sessionID: string
      messageID: string
      ownerID: string
      fence: number
      finish: string
      payload: string
      digest: string
      outcome: Exclude<ExecutionLedger.ExecutionOutcome, "completed">
      reasonCode: ExecutionLedger.ReasonCode
      reasonMessage: string
      retryable: boolean
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing", "terminal", "cancelled"].includes(current.status)) {
          return { finalized: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { finalized: false as const, reason: "stale_fence" as const }
        }
        const previous = ctx.completion(input.executionID)
        if (current.outcome !== null) {
          return current.outcome === input.outcome &&
            previous?.state === "committed" &&
            previous.outcome === input.outcome
            ? { finalized: true as const, idempotent: true, completion: previous }
            : { finalized: false as const, reason: "terminal_outcome" as const }
        }
        if (previous?.state === "committed") {
          return { finalized: false as const, reason: "terminal_outcome" as const }
        }
        if (previous) {
          db.query(
            `UPDATE execution_completion SET state = 'committed', terminal_outcome = ?,
               delivery_payload = ?, delivery_finish = ?, reason_code = ?,
               projection_state = 'pending', projected_at = NULL, projection_owner = NULL,
               projection_token = NULL, projection_lease_expires_at = NULL, committed_at = ?
             WHERE execution_id = ?`,
          ).run(input.outcome, input.payload, input.finish, input.reasonCode, now, input.executionID)
        } else {
          db.query(
            `INSERT INTO execution_completion
              (execution_id, session_id, message_id, owner_id, fence, finish, payload, review_files, digest,
               requires_review, revision, plan_revision, policy_version, policy_digest, review_requirement,
               review_reason_code, required_reviewers, attempt_limit, content_snapshot_digest,
               terminal_outcome, reason_code, projection_state, state, created_at, committed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 0, ?, ?, 1, 'terminal-outcome', 'not_required',
               ?, 0, 0, 'terminal-outcome', ?, ?, 'pending', 'committed', ?, ?)`,
          ).run(
            input.executionID,
            input.sessionID,
            input.messageID,
            input.ownerID,
            input.fence,
            input.finish,
            input.payload,
            input.digest,
            current.mutation_revision,
            current.plan_revision,
            input.reasonCode,
            input.outcome,
            input.reasonCode,
            now,
            now,
          )
        }
        db.query(
          `UPDATE execution SET status = ?, lifecycle = 'terminal', phase = 'idle', outcome = ?,
             reason_code = ?, reason_message = ?, reason_retryable = ?, version = version + 1,
             updated_at = ?, terminal_at = ? WHERE id = ? AND outcome IS NULL`,
        ).run(
          input.outcome === "cancelled" ? "cancelled" : "terminal",
          input.outcome,
          input.reasonCode,
          input.reasonMessage,
          input.retryable ? 1 : 0,
          now,
          now,
          input.executionID,
        )
        ctx.appendExecutionEvent(input.executionID, "execution.updated", now)
        return { finalized: true as const, idempotent: false, completion: ctx.completion(input.executionID)! }
      })
    },

    discardCompletion(input: { executionID: string; ownerID: string; fence: number; digest: string; now?: number }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status))
          return { discarded: false as const, reason: "not_active" as const }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { discarded: false as const, reason: "stale_fence" as const }
        }
        const candidate = ctx.completion(input.executionID)
        if (!candidate || candidate.digest !== input.digest || candidate.state === "committed") {
          return { discarded: false as const, reason: "stale_candidate" as const }
        }
        db.query("UPDATE execution_completion SET state = 'discarded' WHERE execution_id = ?").run(input.executionID)
        db.query(
          `UPDATE execution SET status = 'active', lifecycle = 'active', phase = 'model',
             version = version + 1, updated_at = ? WHERE id = ?`,
        ).run(now, input.executionID)
        return { discarded: true as const }
      })
    },

    retryCompletion(input: {
      id: string
      executionID: string
      sessionID: string
      invocationID: string
      rootSessionID: string
      ownerID: string
      fence: number
      digest: string
      payload: string
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { accepted: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { accepted: false as const, reason: "stale_fence" as const }
        }
        const candidate = ctx.completion(input.executionID)
        if (!candidate || candidate.digest !== input.digest || candidate.state === "committed") {
          return { accepted: false as const, reason: "stale_candidate" as const }
        }
        const binding = db
          .query<
            { session_id: string; execution_id: string },
            [string]
          >("SELECT session_id, execution_id FROM execution_binding WHERE invocation_id = ?")
          .get(input.invocationID)
        if (binding && (binding.session_id !== input.sessionID || binding.execution_id !== input.executionID)) {
          throw new Error("continuation invocation belongs to another execution")
        }
        const pending = db
          .query<
            { count: number },
            [string]
          >("SELECT COUNT(*) AS count FROM execution_continuation WHERE session_id = ? AND state = 'pending'")
          .get(input.sessionID)?.count
        if ((pending ?? 0) >= MAX_PENDING_CONTINUATIONS) {
          return { accepted: false as const, reason: "continuation_limit" as const }
        }
        db.query("UPDATE execution_completion SET state = 'discarded' WHERE execution_id = ?").run(input.executionID)
        db.query(
          `UPDATE execution SET status = 'active', lifecycle = 'active', phase = 'model',
             version = version + 1, updated_at = ? WHERE id = ?`,
        ).run(now, input.executionID)
        db.query(
          `INSERT INTO execution_binding
            (invocation_id, session_id, execution_id, root_session_id, owner_id, fence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(invocation_id) DO UPDATE SET owner_id = excluded.owner_id, fence = excluded.fence`,
        ).run(
          input.invocationID,
          input.sessionID,
          input.executionID,
          input.rootSessionID,
          input.ownerID,
          input.fence,
          now,
        )
        db.query(
          `INSERT INTO session_execution
            (session_id, execution_id, root_session_id, owner_id, fence, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
            execution_id = excluded.execution_id, root_session_id = excluded.root_session_id,
            owner_id = excluded.owner_id, fence = excluded.fence, updated_at = excluded.updated_at`,
        ).run(input.sessionID, input.executionID, input.rootSessionID, input.ownerID, input.fence, now)
        db.query(
          `INSERT INTO execution_continuation
            (id, execution_id, session_id, invocation_id, kind, payload, state, created_at)
           VALUES (?, ?, ?, ?, 'review_retry', ?, 'pending', ?)
           ON CONFLICT(id) DO NOTHING`,
        ).run(input.id, input.executionID, input.sessionID, input.invocationID, input.payload, now)
        return { accepted: true as const }
      })
    },
  }
}
