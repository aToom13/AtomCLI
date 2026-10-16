import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): ExecutionLedger.ExecutionRow | undefined
  invocation(invocationID: string): ExecutionLedger.Invocation | undefined
  ownershipValid(
    current: ExecutionLedger.ExecutionRow,
    ownerID: string | undefined,
    fence: number,
    now: number,
  ): boolean
  cancellationOutbox(current: ExecutionLedger.ExecutionRow, now: number): void
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties?: Record<string, unknown>,
  ): void
  executionView(executionID: string): ExecutionLedger.ExecutionView | undefined
  maxEvidenceBytes: number
}

export function createCancellationModule(ctx: Context) {
  const { db } = ctx
  const {
    transaction,
    execution,
    invocation,
    ownershipValid,
    cancellationOutbox,
    appendExecutionEvent,
    executionView,
    maxEvidenceBytes,
  } = ctx
  const MAX_BLOCKER_EVIDENCE_BYTES = maxEvidenceBytes
  type WorkState = ExecutionLedger.WorkState
  return {
    finishInvocation(input: {
      invocationID: string
      executionID: string
      ownerID: string
      fence: number
      state: "completed" | "failed" | "cancelled" | "unknown"
      reasonCode?: string
      now?: number
    }) {
      return transaction(() => {
        const current = execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !ownershipValid(current, input.ownerID, input.fence, now)) {
          return { finished: false as const, reason: current ? ("stale_fence" as const) : ("not_found" as const) }
        }
        const record = invocation(input.invocationID)
        if (!record) return { finished: false as const, reason: "not_found" as const }
        if (record.executionID !== input.executionID) throw new Error("invocation ID belongs to another execution")
        if (["completed", "failed", "cancelled"].includes(record.state)) {
          return record.state === input.state
            ? { finished: true as const, idempotent: true, invocation: record }
            : { finished: false as const, reason: "terminal" as const }
        }
        const state =
          record.cancellationRequestedAt !== undefined &&
          ["completed", "failed"].includes(input.state) &&
          input.reasonCode !== "deadline"
            ? "cancelled"
            : input.state
        db.query(
          `UPDATE execution_invocation
           SET state = ?, revision = revision + 1, finished_at = ?
           WHERE id = ? AND revision = ?`,
        ).run(state, now, input.invocationID, record.revision)
        const blockerState =
          state === "completed"
            ? "resolved"
            : state === "failed"
              ? "failed"
              : state === "cancelled"
                ? "cancelled"
                : "unknown"
        db.query(
          `UPDATE execution_blocker SET state = ?, version = version + 1,
             evidence = ?, resolution_code = ?, updated_at = ?, finished_at = ?
           WHERE execution_id = ? AND kind = 'child' AND producer_id = ?
             AND state NOT IN ('resolved', 'waived')`,
        ).run(
          blockerState,
          `Child invocation finished with state ${state}`,
          input.reasonCode ?? `invocation_${state}`,
          now,
          ["resolved", "failed", "cancelled"].includes(blockerState) ? now : null,
          input.executionID,
          input.invocationID,
        )
        return { finished: true as const, idempotent: false, invocation: invocation(input.invocationID)! }
      })
    },

    cancelInvocation(input: {
      invocationID: string
      executionID: string
      ownerID: string
      fence: number
      now?: number
    }) {
      return transaction(() => {
        const current = execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { cancelled: false as const, reason: "not_active" as const }
        }
        if (!ownershipValid(current, input.ownerID, input.fence, now)) {
          return { cancelled: false as const, reason: "stale_fence" as const }
        }
        const record = invocation(input.invocationID)
        if (!record) return { cancelled: false as const, reason: "not_found" as const }
        if (record.executionID !== input.executionID) throw new Error("invocation ID belongs to another execution")
        if (["completed", "failed", "cancelled"].includes(record.state)) {
          return record.state === "cancelled"
            ? { cancelled: true as const, idempotent: true, invocation: record }
            : { cancelled: false as const, reason: "terminal" as const }
        }
        const descendants = db
          .query<{ id: string }, [string, string]>(
            `WITH RECURSIVE descendants(id) AS (
               SELECT id FROM execution_invocation WHERE id = ?
               UNION
               SELECT child.id FROM execution_invocation child
               JOIN descendants parent ON child.parent_invocation_id = parent.id
               WHERE child.execution_id = ?
             ) SELECT id FROM descendants`,
          )
          .all(input.invocationID, input.executionID)
        for (const descendant of descendants) {
          db.query(
            `UPDATE execution_invocation SET
               cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
               state = CASE WHEN state IN ('accepted', 'running', 'waiting') THEN 'draining' ELSE state END,
               revision = revision + 1
             WHERE id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
          ).run(now, descendant.id)
        }
        const descendantIDs = descendants.map((item) => item.id)
        for (const descendantID of descendantIDs) {
          db.query(
            `UPDATE execution_work SET
               state = CASE WHEN state = 'prepared' THEN 'cancelled' ELSE 'draining' END,
               version = version + 1,
               evidence = CASE WHEN state = 'prepared' THEN 'No effect began before invocation cancellation' ELSE evidence END,
               resolution_code = CASE WHEN state = 'prepared' THEN 'not_begun' ELSE resolution_code END,
               finished_at = CASE WHEN state = 'prepared' THEN ? ELSE finished_at END
             WHERE execution_id = ? AND invocation_id = ? AND state IN ('prepared', 'running')`,
          ).run(now, input.executionID, descendantID)
          db.query(
            `UPDATE execution_blocker SET state = 'draining', version = version + 1, updated_at = ?
             WHERE execution_id = ? AND invocation_id = ? AND state IN ('pending', 'running', 'resumable')`,
          ).run(now, input.executionID, descendantID)
        }
        return { cancelled: true as const, idempotent: false, invocation: invocation(input.invocationID)! }
      })
    },

    requestCancel(input: {
      requestID: string
      executionID: string
      sessionID: string
      projectID: string
      expectedVersion: number
      invocationID?: string
      now?: number
    }) {
      return transaction(() => {
        const payload = JSON.stringify({ invocationID: input.invocationID ?? null })
        const previous = db
          .query<
            { execution_id: string; kind: string; payload_digest: string; resulting_version: number },
            [string]
          >("SELECT execution_id, kind, payload_digest, resulting_version FROM execution_request WHERE request_id = ?")
          .get(input.requestID)
        if (previous) {
          if (
            previous.execution_id !== input.executionID ||
            previous.kind !== "cancel" ||
            previous.payload_digest !== payload
          ) {
            return { accepted: false as const, reason: "request_conflict" as const }
          }
          return {
            accepted: true as const,
            idempotent: true,
            version: previous.resulting_version,
            execution: executionView(input.executionID)!,
          }
        }
        const current = execution(input.executionID)
        if (
          !current ||
          current.root_session_id !== input.sessionID ||
          current.project_id !== input.projectID ||
          current.deleted_at !== null
        ) {
          return { accepted: false as const, reason: "not_found" as const }
        }
        if (current.version !== input.expectedVersion) {
          return { accepted: false as const, reason: "stale_version" as const, version: current.version }
        }
        if (current.outcome !== null || current.lifecycle === "terminal") {
          return { accepted: false as const, reason: "not_active" as const, version: current.version }
        }
        const now = input.now ?? Date.now()
        if (input.invocationID) {
          const target = invocation(input.invocationID)
          if (!target || target.executionID !== input.executionID) {
            return { accepted: false as const, reason: "invocation_not_found" as const }
          }
          if (!["completed", "failed", "cancelled"].includes(target.state)) {
            db.query(
              `UPDATE execution_invocation SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
                 state = CASE WHEN state IN ('accepted', 'running', 'waiting') THEN 'draining' ELSE state END,
                 revision = revision + 1 WHERE id = ?`,
            ).run(now, input.invocationID)
            db.query(
              `UPDATE execution_work SET
                 state = CASE WHEN state = 'prepared' THEN 'cancelled' ELSE 'draining' END,
                 version = version + 1,
                 evidence = CASE WHEN state = 'prepared' THEN 'No effect began before invocation cancellation' ELSE evidence END,
                 resolution_code = CASE WHEN state = 'prepared' THEN 'not_begun' ELSE resolution_code END,
                 finished_at = CASE WHEN state = 'prepared' THEN ? ELSE finished_at END
               WHERE execution_id = ? AND invocation_id = ? AND state IN ('prepared', 'running')`,
            ).run(now, input.executionID, input.invocationID)
            db.query(
              `UPDATE execution_blocker SET state = 'draining', version = version + 1, updated_at = ?
               WHERE execution_id = ? AND invocation_id = ? AND state IN ('pending', 'running', 'resumable')`,
            ).run(now, input.executionID, input.invocationID)
          }
          db.query(
            `UPDATE execution SET reason_code = 'invocation_cancelled',
               reason_message = 'A child invocation was cancelled by the user.', reason_retryable = 0,
               version = version + 1, updated_at = ? WHERE id = ?`,
          ).run(now, input.executionID)
        } else {
          cancellationOutbox(current, now)
          db.query(
            `UPDATE execution SET status = 'cancelled', lifecycle = 'terminal', phase = 'idle',
               outcome = 'cancelled', reason_code = 'user_cancelled',
               reason_message = 'The execution was cancelled by the user.', reason_retryable = 0,
               version = version + 1, updated_at = ?, terminal_at = ?
             WHERE id = ? AND outcome IS NULL`,
          ).run(now, now, input.executionID)
          db.query(
            `UPDATE execution_invocation SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
               state = CASE WHEN state IN ('accepted', 'running', 'waiting') THEN 'draining' ELSE state END,
               revision = revision + 1
             WHERE execution_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
          ).run(now, input.executionID)
          db.query(
            `UPDATE execution_work SET
               state = CASE WHEN state = 'prepared' THEN 'cancelled' ELSE 'draining' END,
               version = version + 1,
               evidence = CASE WHEN state = 'prepared' THEN 'No effect began before execution cancellation' ELSE evidence END,
               resolution_code = CASE WHEN state = 'prepared' THEN 'not_begun' ELSE resolution_code END,
               finished_at = CASE WHEN state = 'prepared' THEN ? ELSE finished_at END
             WHERE execution_id = ? AND state IN ('prepared', 'running')`,
          ).run(now, input.executionID)
          db.query(
            `UPDATE execution_blocker SET state = 'draining', version = version + 1, updated_at = ?
             WHERE execution_id = ? AND state IN ('pending', 'running', 'resumable')`,
          ).run(now, input.executionID)
        }
        appendExecutionEvent(input.executionID, "execution.updated", now)
        const updated = execution(input.executionID)!
        db.query(
          `INSERT INTO execution_request
            (request_id, execution_id, kind, payload_digest, resulting_version, created_at)
           VALUES (?, ?, 'cancel', ?, ?, ?)`,
        ).run(input.requestID, input.executionID, payload, updated.version, now)
        return {
          accepted: true as const,
          idempotent: false,
          version: updated.version,
          execution: executionView(input.executionID)!,
        }
      })
    },

    requestReconcile(input: {
      requestID: string
      executionID: string
      sessionID: string
      projectID: string
      operationID: string
      state: "completed" | "failed" | "cancelled"
      expectedVersion: number
      expectedWorkVersion: number
      evidence: string
      resolutionCode: string
      now?: number
    }) {
      return transaction(() => {
        if (
          !input.evidence ||
          !input.resolutionCode ||
          new TextEncoder().encode(input.evidence).byteLength > MAX_BLOCKER_EVIDENCE_BYTES
        ) {
          return { reconciled: false as const, reason: "evidence_required" as const }
        }
        const payload = JSON.stringify({
          operationID: input.operationID,
          state: input.state,
          expectedWorkVersion: input.expectedWorkVersion,
          evidence: input.evidence,
          resolutionCode: input.resolutionCode,
        })
        const previous = db
          .query<
            { execution_id: string; kind: string; payload_digest: string; resulting_version: number },
            [string]
          >("SELECT execution_id, kind, payload_digest, resulting_version FROM execution_request WHERE request_id = ?")
          .get(input.requestID)
        if (previous) {
          if (
            previous.execution_id !== input.executionID ||
            previous.kind !== "reconcile" ||
            previous.payload_digest !== payload
          ) {
            return { reconciled: false as const, reason: "request_conflict" as const }
          }
          return {
            reconciled: true as const,
            idempotent: true,
            version: previous.resulting_version,
            execution: executionView(input.executionID)!,
          }
        }
        const current = execution(input.executionID)
        if (
          !current ||
          current.root_session_id !== input.sessionID ||
          current.project_id !== input.projectID ||
          current.deleted_at !== null
        ) {
          return { reconciled: false as const, reason: "not_found" as const }
        }
        if (current.version !== input.expectedVersion) {
          return { reconciled: false as const, reason: "stale_version" as const, version: current.version }
        }
        const work = db
          .query<
            { execution_id: string; state: WorkState; version: number },
            [string]
          >("SELECT execution_id, state, version FROM execution_work WHERE id = ?")
          .get(input.operationID)
        if (!work || work.execution_id !== input.executionID) {
          return { reconciled: false as const, reason: "work_not_found" as const }
        }
        if (work.version !== input.expectedWorkVersion) {
          return { reconciled: false as const, reason: "stale_work_version" as const, version: work.version }
        }
        if (work.state !== "unknown") {
          return { reconciled: false as const, reason: "not_unknown" as const }
        }
        const now = input.now ?? Date.now()
        db.query(
          `UPDATE execution_work SET state = ?, version = version + 1, evidence = ?, resolution_code = ?, finished_at = ?
           WHERE id = ? AND version = ?`,
        ).run(input.state, input.evidence, input.resolutionCode, now, input.operationID, input.expectedWorkVersion)
        const remainingUnknown =
          db
            .query<
              { count: number },
              [string]
            >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND mutating = 1 AND state = 'unknown'")
            .get(input.executionID)?.count ?? 0
        if (remainingUnknown === 0 && current.reason_code === "recovery_required") {
          // Recovery terminalizes execution to prevent replay. Once every
          // uncertain mutation has an explicit resolution, reopen this same
          // execution so a queued user prompt can continue instead of failing
          // with `not_active` or requiring a second session.
          db.query(
            `UPDATE execution SET status = 'active', lifecycle = 'active', phase = 'running',
               outcome = NULL, reason_code = NULL, reason_message = NULL, reason_retryable = NULL,
               terminal_at = NULL, updated_at = ?, version = version + 1
             WHERE id = ?`,
          ).run(now, input.executionID)
        } else {
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
        }
        appendExecutionEvent(input.executionID, "execution.updated", now)
        const updated = execution(input.executionID)!
        db.query(
          `INSERT INTO execution_request
            (request_id, execution_id, kind, payload_digest, resulting_version, created_at)
           VALUES (?, ?, 'reconcile', ?, ?, ?)`,
        ).run(input.requestID, input.executionID, payload, updated.version, now)
        return {
          reconciled: true as const,
          idempotent: false,
          version: updated.version,
          execution: executionView(input.executionID)!,
        }
      })
    },

    cancel(input: { executionID: string; ownerID: string; fence: number; now?: number; allowExpiredOwner?: boolean }) {
      return transaction(() => {
        const current = execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { cancelled: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        // Shutdown may cancel an idle lease after expiry, never a replacement owner/fence.
        const expiredOwner =
          input.allowExpiredOwner && current.owner_id === input.ownerID && current.fence === input.fence
        if (!ownershipValid(current, input.ownerID, input.fence, now) && !expiredOwner) {
          return { cancelled: false as const, reason: "stale_fence" as const }
        }
        cancellationOutbox(current, now)
        db.query(
          `UPDATE execution SET status = 'cancelled', lifecycle = 'terminal', phase = 'idle',
             outcome = 'cancelled', reason_code = 'user_cancelled',
             reason_message = 'The execution was cancelled by the user.', reason_retryable = 0,
             version = version + 1, updated_at = ?, terminal_at = ?
           WHERE id = ? AND outcome IS NULL`,
        ).run(now, now, input.executionID)
        appendExecutionEvent(input.executionID, "execution.updated", now)
        db.query(
          `UPDATE execution_invocation SET
             cancellation_requested_at = COALESCE(cancellation_requested_at, ?),
             state = CASE WHEN state IN ('accepted', 'running', 'waiting') THEN 'draining' ELSE state END,
             revision = revision + 1
           WHERE execution_id = ? AND state NOT IN ('completed', 'failed', 'cancelled')`,
        ).run(now, input.executionID)
        db.query(
          `UPDATE execution_work SET
             state = CASE WHEN state = 'prepared' THEN 'cancelled' ELSE 'draining' END,
             version = version + 1,
             evidence = CASE WHEN state = 'prepared' THEN 'No effect began before execution cancellation' ELSE evidence END,
             resolution_code = CASE WHEN state = 'prepared' THEN 'not_begun' ELSE resolution_code END,
             finished_at = CASE WHEN state = 'prepared' THEN ? ELSE finished_at END
           WHERE execution_id = ? AND state IN ('prepared', 'running')`,
        ).run(now, input.executionID)
        db.query(
          `UPDATE execution_blocker SET state = 'draining', version = version + 1, updated_at = ?
           WHERE execution_id = ? AND state IN ('pending', 'running', 'resumable')`,
        ).run(now, input.executionID)
        return { cancelled: true as const }
      })
    },

    recordMutation(input: { executionID: string; ownerID: string; fence: number; now?: number }) {
      return transaction(() => {
        const current = execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { recorded: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ownershipValid(current, input.ownerID, input.fence, now)) {
          return { recorded: false as const, reason: "stale_fence" as const }
        }
        const revision = current.mutation_revision + 1
        db.query("UPDATE execution SET mutation_revision = ? WHERE id = ?").run(revision, input.executionID)
        return { recorded: true as const, revision }
      })
    },
  }
}
