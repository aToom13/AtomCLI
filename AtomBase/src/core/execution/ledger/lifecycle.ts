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
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties?: Record<string, unknown>,
  ): void
  cancellationOutbox(current: ExecutionLedger.ExecutionRow, now: number): void
  tighten(current: number | null, incoming: number | undefined): number | null
  tightenScopePolicy(scopeID: string, maxCost: number | undefined): void
  executionBudgetScope(current: ExecutionLedger.ExecutionRow): string
  policy: { parse(value: unknown): ExecutionLedger.Policy }
  log: { warn(message: string, data?: unknown): void }
}

export function createLifecycleModule(ctx: Context) {
  const { db } = ctx
  const {
    transaction,
    execution,
    invocation,
    ownershipValid,
    appendExecutionEvent,
    tighten,
    tightenScopePolicy,
    executionBudgetScope,
    policy: Policy,
    log,
  } = ctx
  type Context = ExecutionLedger.Context
  type InvocationKind = ExecutionLedger.InvocationKind
  type InvocationState = ExecutionLedger.InvocationState
  type Policy = ExecutionLedger.Policy
  return {
    bind(
      input: Context & {
        sessionID: string
        parentInvocationID?: string
        kind?: InvocationKind
        acceptedMessageID?: string
        replacesInvocationID?: string
        now?: number
      },
    ) {
      return transaction(() => {
        const existing = db
          .query<
            { session_id: string; execution_id: string },
            [string]
          >("SELECT session_id, execution_id FROM execution_binding WHERE invocation_id = ?")
          .get(input.invocationID)
        if (existing && (existing.session_id !== input.sessionID || existing.execution_id !== input.executionID)) {
          throw new Error("invocation ID belongs to another execution")
        }
        const now = input.now ?? Date.now()
        const sessionLink = db
          .query<
            { parent_invocation_id: string | null },
            [string]
          >("SELECT parent_invocation_id FROM session_execution WHERE session_id = ?")
          .get(input.sessionID)
        const parentInvocationID = input.parentInvocationID ?? sessionLink?.parent_invocation_id ?? null
        const invocationKind = input.kind ?? (parentInvocationID ? "child" : "root")
        if (invocationKind === "root") {
          const unknownMutatingRows = db
            .query<{ id: string; kind: string; execution_id: string }, [string]>(
              `SELECT w.id, w.kind, w.execution_id FROM execution_work w
               JOIN execution e ON e.id = w.execution_id
               WHERE e.root_session_id = ? AND w.mutating = 1 AND w.state = 'unknown'
               ORDER BY w.created_at, w.id`,
            )
            .all(input.sessionID)
          if (unknownMutatingRows.length > 0) {
            const details = unknownMutatingRows.map((row) => `${row.kind}:${row.id}`).join(", ")
            const reasonMessage = `Session has unknown mutating work that must be reconciled (${details}).`
            log.warn("session root invocation blocked by unknown mutating work", {
              sessionID: input.sessionID,
              executionID: input.executionID,
              unknownWork: unknownMutatingRows,
            })
            db.query(
              `UPDATE execution SET status = 'terminal', lifecycle = 'terminal', phase = 'idle',
                 outcome = 'failed', reason_code = 'recovery_required',
                 reason_message = ?,
                 reason_retryable = 0, version = version + 1, updated_at = ?, terminal_at = ?
               WHERE id = ? AND outcome IS NULL`,
            ).run(reasonMessage, now, now, input.executionID)
            appendExecutionEvent(input.executionID, "execution.updated", now)
            return undefined
          }
        }
        if (input.replacesInvocationID && input.replacesInvocationID !== input.invocationID) {
          const replaced = invocation(input.replacesInvocationID)
          if (!replaced || replaced.executionID !== input.executionID || replaced.sessionID !== input.sessionID) {
            throw new Error("replaced invocation does not belong to this session execution")
          }
          if (!["completed", "failed", "cancelled"].includes(replaced.state)) {
            db.query(
              `UPDATE execution_invocation SET state = 'completed', revision = revision + 1, finished_at = ?
               WHERE id = ?`,
            ).run(now, input.replacesInvocationID)
          }
        }
        if (parentInvocationID) {
          const parentInvocation = invocation(parentInvocationID)
          if (!parentInvocation || parentInvocation.executionID !== input.executionID) {
            throw new Error("parent invocation does not belong to this execution")
          }
        }
        const existingInvocation = invocation(input.invocationID)
        if (
          existingInvocation &&
          (existingInvocation.executionID !== input.executionID || existingInvocation.sessionID !== input.sessionID)
        ) {
          throw new Error("invocation ID belongs to another execution")
        }
        if (!existingInvocation) {
          const competing = db
            .query<{ id: string; kind: InvocationKind; state: InvocationState }, [string, string]>(
              `SELECT id, kind, state FROM execution_invocation
               WHERE session_id = ? AND id <> ?
                 AND state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
               LIMIT 1`,
            )
            .get(input.sessionID, input.invocationID)
          if (competing) {
            if (
              invocationKind === "root" &&
              competing.kind === "root" &&
              ["accepted", "running", "waiting", "draining"].includes(competing.state)
            ) {
              db.query(
                `UPDATE execution_invocation SET state = 'completed', revision = revision + 1, finished_at = ?
                 WHERE id = ?`,
              ).run(now, competing.id)
            } else if (invocationKind === "root" && competing.kind === "root" && competing.state === "unknown") {
              const unknownWorkCount =
                db
                  .query<
                    { count: number },
                    [string]
                  >(`SELECT COUNT(*) AS count FROM execution_work WHERE invocation_id = ? AND state = 'unknown'`)
                  .get(competing.id)?.count ?? 0
              if (unknownWorkCount === 0) {
                db.query(
                  `UPDATE execution_invocation SET state = 'completed', revision = revision + 1, finished_at = ?
                   WHERE id = ?`,
                ).run(now, competing.id)
              } else {
                throw new Error(`session already has active invocation ${competing.id}`)
              }
            } else {
              throw new Error(`session already has active invocation ${competing.id}`)
            }
          }
          db.query(
            `INSERT INTO execution_invocation
              (id, execution_id, session_id, parent_invocation_id, kind, accepted_message_id,
               state, revision, owner_id, fence, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'running', 1, ?, ?, ?)`,
          ).run(
            input.invocationID,
            input.executionID,
            input.sessionID,
            parentInvocationID,
            invocationKind,
            input.acceptedMessageID ?? null,
            input.ownerID,
            input.fence,
            now,
          )
        } else if (!["completed", "failed", "cancelled"].includes(existingInvocation.state)) {
          db.query(
            `UPDATE execution_invocation SET owner_id = ?, fence = ?,
              state = CASE WHEN state = 'unknown' THEN 'running' ELSE state END,
              revision = revision + 1 WHERE id = ?`,
          ).run(input.ownerID, input.fence, input.invocationID)
        }
        if (invocationKind === "child" && parentInvocationID) {
          db.query(
            `INSERT INTO execution_blocker
              (id, execution_id, invocation_id, kind, producer_id, resource_scope,
               state, version, owner_id, fence, created_at, updated_at)
             VALUES (?, ?, ?, 'child', ?, ?, 'running', 1, ?, ?, ?, ?)
             ON CONFLICT(execution_id, kind, producer_id) DO NOTHING`,
          ).run(
            `child:${input.invocationID}`,
            input.executionID,
            input.invocationID,
            input.invocationID,
            `root-session:${input.rootSessionID}`,
            input.ownerID,
            input.fence,
            now,
            now,
          )
        }
        db.query(
          `INSERT INTO execution_binding
            (invocation_id, session_id, execution_id, root_session_id, owner_id, fence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(invocation_id) DO UPDATE SET
            owner_id = excluded.owner_id,
            fence = excluded.fence`,
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
            (session_id, execution_id, root_session_id, owner_id, fence, updated_at, parent_invocation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
            execution_id = excluded.execution_id,
            root_session_id = excluded.root_session_id,
            owner_id = excluded.owner_id,
            fence = excluded.fence,
            updated_at = excluded.updated_at,
            parent_invocation_id = excluded.parent_invocation_id`,
        ).run(
          input.sessionID,
          input.executionID,
          input.rootSessionID,
          input.ownerID,
          input.fence,
          now,
          parentInvocationID,
        )
        if (invocationKind === "root") {
          db.query("UPDATE execution SET phase = 'model', version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
        }
        return this.binding(input.invocationID)!
      })
    },

    waitForInput(input: {
      executionID: string
      invocationID: string
      ownerID: string
      fence: number
      reason: string
      now?: number
    }) {
      return transaction(() => {
        const current = execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || current.status !== "active") return { waiting: false as const, reason: "not_active" as const }
        if (!ownershipValid(current, input.ownerID, input.fence, now)) {
          return { waiting: false as const, reason: "stale_fence" as const }
        }
        const active = invocation(input.invocationID)
        if (!active || active.executionID !== input.executionID) {
          return { waiting: false as const, reason: "invalid_invocation" as const }
        }
        db.query("UPDATE execution_invocation SET state = 'waiting', revision = revision + 1 WHERE id = ?").run(
          input.invocationID,
        )
        db.query(
          "UPDATE execution SET phase = 'waiting_input', reason_message = ?, version = version + 1, updated_at = ? WHERE id = ?",
        ).run(input.reason, now, input.executionID)
        appendExecutionEvent(input.executionID, "execution.updated", now)
        return { waiting: true as const }
      })
    },

    inherit(input: { parentSessionID: string; childSessionID: string; now?: number }) {
      return transaction(() => {
        const parent = this.active(input.parentSessionID)
        if (!parent) return false
        const parentInvocation = db
          .query<{ id: string }, [string, string]>(
            `SELECT id FROM execution_invocation
             WHERE session_id = ? AND execution_id = ?
               AND state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
             ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(input.parentSessionID, parent.executionID)?.id
        db.query(
          `INSERT INTO session_execution
            (session_id, execution_id, root_session_id, owner_id, fence, updated_at, parent_invocation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
            execution_id = excluded.execution_id,
            root_session_id = excluded.root_session_id,
            owner_id = excluded.owner_id,
            fence = excluded.fence,
            updated_at = excluded.updated_at,
            parent_invocation_id = excluded.parent_invocation_id`,
        ).run(
          input.childSessionID,
          parent.executionID,
          parent.rootSessionID,
          parent.ownerID,
          parent.fence,
          input.now ?? Date.now(),
          parentInvocation ?? null,
        )
        return true
      })
    },

    start(input: {
      id: string
      projectID: string
      rootSessionID: string
      fence: number
      sessionGeneration?: number
      resumesExecutionID?: string
      policy?: Policy
      now?: number
    }) {
      const policy = Policy.parse(input.policy ?? {})
      const now = input.now ?? Date.now()
      transaction(() => {
        const resumed = input.resumesExecutionID ? execution(input.resumesExecutionID) : undefined
        if (input.resumesExecutionID && !resumed) throw new Error("resumed execution does not exist")
        if (resumed && (resumed.project_id !== input.projectID || resumed.root_session_id !== input.rootSessionID)) {
          throw new Error("resumed execution belongs to another scope")
        }
        if (resumed && resumed.lifecycle !== "terminal") throw new Error("only a terminal execution can be resumed")
        const budgetScopeID = resumed?.budget_scope_id ?? input.id
        const inheritedDeadline = resumed?.deadline_at ?? null
        const inheritedMaxCalls = resumed?.max_calls ?? null
        const inheritedMaxSteps = resumed?.max_steps ?? null
        const inheritedMaxCost = resumed?.max_cost ?? null
        const inserted = db
          .query(
            `INSERT OR IGNORE INTO execution
            (id, project_id, root_session_id, resumes_execution_id, budget_scope_id,
             session_generation, status, fence, created_at, deadline_at, max_calls, max_steps,
             max_cost, project_max_cost, unknown_price_blocked, lifecycle, phase, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'preparing', 1, ?)`,
          )
          .run(
            input.id,
            input.projectID,
            input.rootSessionID,
            input.resumesExecutionID ?? null,
            budgetScopeID,
            input.sessionGeneration ?? 1,
            input.fence,
            now,
            inheritedDeadline ?? (policy.maxDurationMs === undefined ? null : now + policy.maxDurationMs),
            inheritedMaxCalls ?? policy.maxCalls ?? null,
            inheritedMaxSteps ?? policy.maxSteps ?? null,
            inheritedMaxCost ?? policy.maxCostMicrousd ?? null,
            policy.projectMaxCostMicrousd ?? null,
            resumed?.unknown_price_blocked === 1 || policy.unknownPriceBlocked ? 1 : 0,
            now,
          )
        const current = execution(input.id)!
        if (current.project_id !== input.projectID || current.root_session_id !== input.rootSessionID) {
          throw new Error("execution ID belongs to another scope")
        }
        if (
          current.budget_scope_id !== budgetScopeID ||
          current.resumes_execution_id !== (input.resumesExecutionID ?? null)
        ) {
          throw new Error("execution resume binding does not match")
        }
        const deadline = policy.maxDurationMs === undefined ? current.deadline_at : now + policy.maxDurationMs
        db.query(
          `UPDATE execution SET
            deadline_at = CASE
              WHEN deadline_at IS NULL THEN ?
              WHEN ? IS NULL THEN deadline_at
              ELSE MIN(deadline_at, ?)
            END,
            max_calls = ?, max_steps = ?, max_cost = ?,
            unknown_price_blocked = MAX(unknown_price_blocked, ?)
           WHERE id = ?`,
        ).run(
          deadline,
          deadline,
          deadline,
          tighten(current.max_calls, policy.maxCalls),
          tighten(current.max_steps, policy.maxSteps),
          tighten(current.max_cost, policy.maxCostMicrousd),
          policy.unknownPriceBlocked ? 1 : 0,
          input.id,
        )
        const scopes = [
          executionBudgetScope(current),
          `root-session:${input.rootSessionID}`,
          `project:${input.projectID}`,
        ]
        for (const scopeID of scopes) db.query("INSERT OR IGNORE INTO scope_total (scope_id) VALUES (?)").run(scopeID)
        tightenScopePolicy(`root-session:${input.rootSessionID}`, policy.rootMaxCostMicrousd)
        tightenScopePolicy(`project:${input.projectID}`, policy.projectMaxCostMicrousd)
        if (inserted.changes === 1 && resumed) {
          // Atomic Work follows resume lineage; budgets and source snapshots remain intact.
          db.query(
            `INSERT INTO execution_task
            (id, execution_id, parent_task_id, revision, goal, owner, agent, skill, session_id, source,
             depends_on, acceptance, evidence, checks, status, supersedes, version, created_at, updated_at,
             submitted_at, verified_at, definition)
            SELECT id, ?, parent_task_id, revision, goal, owner, agent, skill, session_id, source,
              depends_on, acceptance, evidence, checks,
              CASE WHEN status = 'running' THEN 'blocked' ELSE status END,
              supersedes, version, created_at, ?, submitted_at, verified_at, definition
            FROM execution_task WHERE execution_id = ? AND definition IS NOT NULL`,
          ).run(input.id, now, resumed.id)
          db.query(
            `INSERT INTO execution_task_history (execution_id, task_id, version, snapshot)
            SELECT ?, task_id, version, snapshot FROM execution_task_history WHERE execution_id = ?
            AND task_id IN (SELECT id FROM execution_task WHERE execution_id = ?)`,
          ).run(input.id, resumed.id, input.id)
        }
        if (inserted.changes === 1) appendExecutionEvent(input.id, "execution.updated", now)
      })
      return execution(input.id)!
    },
  }
}
