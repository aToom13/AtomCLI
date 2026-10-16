import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  completion(executionID: string): ExecutionLedger.Completion | undefined
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties?: Record<string, unknown>,
  ): void
  touchExecution(
    executionID: string,
    now: number,
    type?: ExecutionLedger.EventType,
    properties?: Record<string, unknown>,
  ): void
  completionProjectionPageSize: number
  maxPendingContinuations: number
}

export function createProjectionModule(ctx: Context) {
  const { db } = ctx
  const {
    transaction,
    completion,
    appendExecutionEvent,
    touchExecution,
    completionProjectionPageSize,
    maxPendingContinuations,
  } = ctx
  const COMPLETION_PROJECTION_PAGE_SIZE = completionProjectionPageSize
  const MAX_PENDING_CONTINUATIONS = maxPendingContinuations
  type Completion = ExecutionLedger.Completion
  type CompletionClaim = ExecutionLedger.CompletionClaim
  type Continuation = ExecutionLedger.Continuation
  type ExecutionOutcome = ExecutionLedger.ExecutionOutcome
  return {
    completion(executionID: string) {
      return completion(executionID)
    },

    pendingCompletions(sessionID: string): Completion[] {
      const rows = db
        .query<{ execution_id: string }, [string, number]>(
          `SELECT execution_id FROM execution_completion
           WHERE session_id = ? AND state = 'committed' AND projection_state = 'pending'
           ORDER BY committed_at, execution_id
           LIMIT ?`,
        )
        .all(sessionID, COMPLETION_PROJECTION_PAGE_SIZE)
      return rows.map((row) => completion(row.execution_id)!)
    },

    claimCompletions(input: {
      sessionID: string
      projectorID: string
      leaseMs: number
      executionID?: string
      now?: number
    }) {
      if (!input.projectorID) throw new Error("projectorID is required")
      if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) throw new Error("leaseMs must be positive")
      return transaction(() => {
        const now = input.now ?? Date.now()
        const candidates = db
          .query<
            { execution_id: string; session_generation: number },
            [string, string | null, string | null, number, string, number]
          >(
            `SELECT candidate.execution_id, owner.session_generation
             FROM execution_completion candidate
             JOIN execution owner ON owner.id = candidate.execution_id
             WHERE candidate.session_id = ? AND candidate.state = 'committed'
               AND (? IS NULL OR candidate.execution_id = ?)
               AND candidate.projection_state = 'pending' AND owner.deleted_at IS NULL
               AND (candidate.projection_lease_expires_at IS NULL
                 OR candidate.projection_lease_expires_at <= ?
                 OR candidate.projection_owner = ?)
             ORDER BY candidate.committed_at, candidate.execution_id
             LIMIT ?`,
          )
          .all(
            input.sessionID,
            input.executionID ?? null,
            input.executionID ?? null,
            now,
            input.projectorID,
            COMPLETION_PROJECTION_PAGE_SIZE,
          )
        const claims: CompletionClaim[] = []
        for (const candidate of candidates) {
          const projectionToken = crypto.randomUUID()
          const projectionLeaseExpiresAt = now + input.leaseMs
          const claimed = db
            .query(
              `UPDATE execution_completion
               SET projection_owner = ?, projection_token = ?, projection_lease_expires_at = ?
               WHERE execution_id = ? AND projection_state = 'pending'
                 AND (projection_lease_expires_at IS NULL OR projection_lease_expires_at <= ? OR projection_owner = ?)`,
            )
            .run(
              input.projectorID,
              projectionToken,
              projectionLeaseExpiresAt,
              candidate.execution_id,
              now,
              input.projectorID,
            )
          if (claimed.changes !== 1) continue
          claims.push({
            ...completion(candidate.execution_id)!,
            projectorID: input.projectorID,
            projectionToken,
            projectionLeaseExpiresAt,
            sessionGeneration: candidate.session_generation,
          })
        }
        return claims
      })
    },

    ackCompletion(input: {
      executionID: string
      digest: string
      projectorID: string
      projectionToken: string
      sessionGeneration: number
      now?: number
    }) {
      return transaction(() => {
        const candidate = completion(input.executionID)
        if (!candidate || candidate.state !== "committed" || candidate.digest !== input.digest) {
          return { projected: false as const, reason: "not_committed" as const }
        }
        if (candidate.projection === "abandoned") {
          return { projected: false as const, reason: "abandoned" as const }
        }
        const record = db
          .query<
            {
              projection_owner: string | null
              projection_token: string | null
              projection_lease_expires_at: number | null
              session_generation: number
              deleted_at: number | null
            },
            [string]
          >(
            `SELECT candidate.projection_owner, candidate.projection_token,
               candidate.projection_lease_expires_at, owner.session_generation, owner.deleted_at
             FROM execution_completion candidate JOIN execution owner ON owner.id = candidate.execution_id
             WHERE candidate.execution_id = ?`,
          )
          .get(input.executionID)
        const now = input.now ?? Date.now()
        if (!record || record.deleted_at !== null) return { projected: false as const, reason: "abandoned" as const }
        if (record.session_generation !== input.sessionGeneration) {
          return { projected: false as const, reason: "stale_generation" as const }
        }
        if (candidate.projection === "projected") {
          return record.projection_owner === input.projectorID && record.projection_token === input.projectionToken
            ? { projected: true as const, idempotent: true }
            : { projected: false as const, reason: "stale_projection" as const }
        }
        if (
          record.projection_owner !== input.projectorID ||
          record.projection_token !== input.projectionToken ||
          record.projection_lease_expires_at === null ||
          now >= record.projection_lease_expires_at
        ) {
          return { projected: false as const, reason: "stale_projection" as const }
        }
        const acknowledged = db
          .query(
            `UPDATE execution_completion SET projection_state = 'projected', projected_at = ?,
               projection_lease_expires_at = NULL
             WHERE execution_id = ? AND projection_state = 'pending'
               AND projection_owner = ? AND projection_token = ?`,
          )
          .run(now, input.executionID, input.projectorID, input.projectionToken)
        if (acknowledged.changes !== 1) return { projected: false as const, reason: "stale_projection" as const }
        db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, input.executionID)
        appendExecutionEvent(input.executionID, "execution.updated", now)
        return { projected: true as const, idempotent: false }
      })
    },

    markProjectionRecovery(input: {
      executionID: string
      digest: string
      projectorID: string
      projectionToken: string
      sessionGeneration: number
      reasonCode: "invalid_payload" | "missing_message"
      now?: number
    }) {
      return transaction(() => {
        const now = input.now ?? Date.now()
        const record = db
          .query<
            {
              digest: string
              state: string
              projection_state: Completion["projection"]
              projection_owner: string | null
              projection_token: string | null
              projection_lease_expires_at: number | null
              session_generation: number
              deleted_at: number | null
            },
            [string]
          >(
            `SELECT candidate.digest, candidate.state, candidate.projection_state, candidate.projection_owner,
               candidate.projection_token, candidate.projection_lease_expires_at,
               owner.session_generation, owner.deleted_at
             FROM execution_completion candidate JOIN execution owner ON owner.id = candidate.execution_id
             WHERE candidate.execution_id = ?`,
          )
          .get(input.executionID)
        if (!record || record.state !== "committed" || record.digest !== input.digest) {
          return { recorded: false as const, reason: "not_committed" as const }
        }
        if (record.projection_state === "recovery_required") {
          return { recorded: true as const, idempotent: true }
        }
        if (record.projection_state !== "pending" || record.deleted_at !== null) {
          return { recorded: false as const, reason: "not_pending" as const }
        }
        if (record.session_generation !== input.sessionGeneration) {
          return { recorded: false as const, reason: "stale_generation" as const }
        }
        if (
          record.projection_owner !== input.projectorID ||
          record.projection_token !== input.projectionToken ||
          record.projection_lease_expires_at === null ||
          now >= record.projection_lease_expires_at
        ) {
          return { recorded: false as const, reason: "stale_projection" as const }
        }
        const updated = db
          .query(
            `UPDATE execution_completion
             SET projection_state = 'recovery_required', projection_owner = NULL,
               projection_token = NULL, projection_lease_expires_at = NULL
             WHERE execution_id = ? AND projection_state = 'pending'
               AND projection_owner = ? AND projection_token = ?`,
          )
          .run(input.executionID, input.projectorID, input.projectionToken)
        if (updated.changes !== 1) return { recorded: false as const, reason: "stale_projection" as const }
        touchExecution(input.executionID, now, "execution.updated", {
          recoveryRequired: true,
          recoveryReasonCode: input.reasonCode,
        })
        return { recorded: true as const, idempotent: false }
      })
    },

    deleteSessions(input: { sessionIDs: string[]; sessionGenerations?: Record<string, number>; now?: number }) {
      return transaction(() => {
        const now = input.now ?? Date.now()
        let abandoned = 0
        let terminalized = 0
        const changed = new Set<string>()
        const rootDeleted = new Set<string>()
        for (const sessionID of new Set(input.sessionIDs)) {
          const pendingCompletions = db
            .query<{ execution_id: string }, [string]>(
              `SELECT execution_id FROM execution_completion
               WHERE session_id = ? AND projection_state = 'pending'`,
            )
            .all(sessionID)
          for (const row of pendingCompletions) changed.add(row.execution_id)
          const activeInvocations = db
            .query<{ execution_id: string }, [string]>(
              `SELECT DISTINCT execution_id FROM execution_invocation
               WHERE session_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
            )
            .all(sessionID)
          for (const row of activeInvocations) changed.add(row.execution_id)
          abandoned += db
            .query(
              `UPDATE execution_completion SET projection_state = 'abandoned', projected_at = ?
             WHERE session_id = ? AND projection_state = 'pending'`,
            )
            .run(now, sessionID).changes
          db.query(
            `UPDATE execution_invocation SET
               cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
               state = CASE WHEN state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
                            THEN 'cancelled' ELSE state END,
               revision = revision + 1,
               finished_at = COALESCE(finished_at, ?)
             WHERE session_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
          ).run(now, now, sessionID)
          db.query(
            `UPDATE execution_work SET state = 'cancelled', version = version + 1,
               evidence = COALESCE(evidence, 'Session deleted'), resolution_code = 'deleted',
               finished_at = COALESCE(finished_at, ?)
             WHERE invocation_id IN (SELECT id FROM execution_invocation WHERE session_id = ?)
               AND state NOT IN ('completed', 'failed', 'cancelled')`,
          ).run(now, sessionID)
          db.query(
            `UPDATE execution_blocker SET state = 'cancelled', version = version + 1,
               evidence = COALESCE(evidence, 'Session deleted'), resolution_code = 'deleted',
               updated_at = ?, finished_at = COALESCE(finished_at, ?)
             WHERE invocation_id IN (SELECT id FROM execution_invocation WHERE session_id = ?)
               AND state NOT IN ('resolved', 'waived', 'cancelled')`,
          ).run(now, now, sessionID)
          const roots = db
            .query<
              { id: string; outcome: ExecutionOutcome | null },
              [string]
            >("SELECT id, outcome FROM execution WHERE root_session_id = ? AND deleted_at IS NULL")
            .all(sessionID)
          terminalized += roots.filter((root) => root.outcome === null).length
          for (const root of roots) {
            changed.add(root.id)
            rootDeleted.add(root.id)
          }
          db.query(
            `UPDATE execution SET
               status = CASE WHEN outcome IS NULL THEN 'cancelled' ELSE status END,
               lifecycle = 'terminal', phase = 'idle',
               outcome = COALESCE(outcome, 'cancelled'),
               reason_code = CASE WHEN outcome IS NULL THEN 'deleted' ELSE reason_code END,
               reason_message = CASE WHEN outcome IS NULL THEN 'The session was deleted.' ELSE reason_message END,
               reason_retryable = CASE WHEN outcome IS NULL THEN 0 ELSE reason_retryable END,
               session_generation = MAX(session_generation, ?),
               version = version + 1, updated_at = ?, terminal_at = COALESCE(terminal_at, ?), deleted_at = ?
             WHERE root_session_id = ? AND deleted_at IS NULL`,
          ).run(input.sessionGenerations?.[sessionID] ?? 1, now, now, now, sessionID)
          db.query("DELETE FROM session_execution WHERE session_id = ?").run(sessionID)
        }
        for (const executionID of changed) {
          if (!rootDeleted.has(executionID)) {
            db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, executionID)
          }
          appendExecutionEvent(
            executionID,
            rootDeleted.has(executionID) ? "execution.deleted" : "execution.updated",
            now,
          )
        }
        return { deleted: true as const, abandoned, terminalized }
      })
    },

    pendingContinuations(sessionID: string): Continuation[] {
      const rows = db
        .query<
          {
            id: string
            execution_id: string
            session_id: string
            invocation_id: string
            kind: Continuation["kind"]
            payload: string
            state: Continuation["state"]
          },
          [string, number]
        >(
          `SELECT id, execution_id, session_id, invocation_id, kind, payload, state
           FROM execution_continuation
           WHERE session_id = ? AND state = 'pending'
           ORDER BY created_at, id
           LIMIT ?`,
        )
        .all(sessionID, MAX_PENDING_CONTINUATIONS + 1)
      if (rows.length > MAX_PENDING_CONTINUATIONS) {
        throw new Error("pending continuation limit exceeded")
      }
      return rows.map((row) => ({
        id: row.id,
        executionID: row.execution_id,
        sessionID: row.session_id,
        invocationID: row.invocation_id,
        kind: row.kind,
        payload: row.payload,
        state: row.state,
      }))
    },

    projectContinuation(input: { id: string; now?: number }) {
      return transaction(() => {
        const current = db
          .query<{ state: Continuation["state"] }, [string]>("SELECT state FROM execution_continuation WHERE id = ?")
          .get(input.id)
        if (!current) return { projected: false as const, reason: "not_found" as const }
        if (current.state === "projected") return { projected: true as const, idempotent: true }
        db.query("UPDATE execution_continuation SET state = 'projected', projected_at = ? WHERE id = ?").run(
          input.now ?? Date.now(),
          input.id,
        )
        return { projected: true as const, idempotent: false }
      })
    },
  }
}
