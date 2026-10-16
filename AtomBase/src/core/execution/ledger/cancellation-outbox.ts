import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

export function createCancellationOutbox(db: Database) {
  return function cancellationOutbox(current: ExecutionLedger.ExecutionRow, now: number) {
    const rootInvocation = db
      .query<{ id: string; accepted_message_id: string | null }, [string]>(
        `SELECT id, accepted_message_id FROM execution_invocation
           WHERE execution_id = ? AND kind = 'root' ORDER BY created_at, id LIMIT 1`,
      )
      .get(current.id)
    const parentUserID = rootInvocation?.accepted_message_id ?? rootInvocation?.id ?? current.id
    const hash = new Bun.CryptoHasher("sha256").update(current.id).digest("hex").slice(0, 24)
    const messageID = `msg_cancel_${hash}`
    const payload = JSON.stringify([
      {
        id: `prt_cancel_${hash}`,
        messageID,
        sessionID: current.root_session_id,
        type: "text",
        text: "This execution was cancelled.",
        synthetic: true,
        metadata: { executionOutcome: "cancelled" },
      },
    ])
    const digest = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify({ executionID: current.id, outcome: "cancelled", payload }))
      .digest("hex")
    db.query(
      `INSERT INTO execution_completion
          (execution_id, session_id, message_id, parent_user_id, owner_id, fence, finish, payload, review_files,
           digest, requires_review, revision, plan_revision, policy_version, policy_digest, review_requirement,
           review_reason_code, required_reviewers, attempt_limit, content_snapshot_digest, terminal_outcome,
           reason_code, projection_state, state, created_at, committed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'error', ?, '[]', ?, 0, ?, ?, 1, 'terminal-cancel', 'not_required',
           'user_cancelled', 0, 0, 'terminal-cancel', 'cancelled', 'user_cancelled', 'pending', 'committed', ?, ?)
         ON CONFLICT(execution_id) DO UPDATE SET
           session_id = excluded.session_id, message_id = excluded.message_id,
           parent_user_id = excluded.parent_user_id, owner_id = excluded.owner_id, fence = excluded.fence,
           finish = excluded.finish, payload = excluded.payload, review_files = excluded.review_files,
           digest = excluded.digest, requires_review = 0, revision = excluded.revision,
           plan_revision = excluded.plan_revision, policy_version = excluded.policy_version,
           policy_digest = excluded.policy_digest, review_requirement = excluded.review_requirement,
           review_reason_code = excluded.review_reason_code, required_reviewers = 0, attempt_limit = 0,
           content_snapshot_digest = excluded.content_snapshot_digest, delivery_payload = NULL,
           delivery_finish = NULL, terminal_outcome = 'cancelled', reason_code = 'user_cancelled',
           projection_state = 'pending', projected_at = NULL, projection_owner = NULL,
           projection_token = NULL, projection_lease_expires_at = NULL, state = 'committed',
           created_at = excluded.created_at, committed_at = excluded.committed_at`,
    ).run(
      current.id,
      current.root_session_id,
      messageID,
      parentUserID,
      current.owner_id ?? "control-plane",
      current.fence,
      payload,
      digest,
      current.mutation_revision,
      current.plan_revision,
      now,
      now,
    )
  }
}
