import { Database } from "bun:sqlite"
import { ExecutionCheckpoint } from "../checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"

type PolicyState = {
  contract?: ExecutionContract.Info
  policy?: {
    budget?: {
      maxToolCalls: number
      maxSteps: number
    }
    budgetExtension?: {
      count: number
      progress: number
      failures: number
      reasons: string[]
    }
  }
  evidence?: {
    toolCalls?: number
    successfulToolCalls?: number
    failureCount?: number
  }
  extensionCount: number
}

type PolicyPayload = {
  budget?: {
    maxSteps: number
    maxToolCalls: number
  }
  budgetExtension?: ExecutionPolicy.PolicyInfo["budgetExtension"]
  [key: string]: unknown
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): { id: string; root_session_id: string } | undefined
  getPolicyState(executionID: string): PolicyState | undefined
  appendExecutionEvent(executionID: string, type: string, now: number, properties?: unknown): void
}

export function createCheckpointModule(ctx: Context) {
  const { db, transaction } = ctx

  return {
    scopeEscalationStatus(sessionID: string) {
      return (
        db
          .query<
            { count: number; last_at: number },
            [string]
          >("SELECT count, last_at FROM execution_scope_escalation WHERE session_id = ?")
          .get(sessionID) ?? { count: 0, last_at: 0 }
      )
    },

    scopeFloor(sessionID: string): ExecutionContract.Scope | undefined {
      const row = db
        .query<
          { floor_scope: string },
          [string]
        >("SELECT floor_scope FROM execution_scope_escalation WHERE session_id = ?")
        .get(sessionID)
      return ExecutionContract.Scope.safeParse(row?.floor_scope).data
    },

    raiseScopeFloor(sessionID: string, scope: ExecutionContract.Scope): ExecutionContract.Scope {
      return transaction(() => {
        const prior = db
          .query<
            { floor_scope: string },
            [string]
          >("SELECT floor_scope FROM execution_scope_escalation WHERE session_id = ?")
          .get(sessionID)
        const current = ExecutionContract.Scope.safeParse(prior?.floor_scope).data ?? "direct"
        const next = ExecutionContract.SCOPE_RANK[scope] > ExecutionContract.SCOPE_RANK[current] ? scope : current
        db.query(
          `INSERT INTO execution_scope_escalation (session_id, count, last_at, floor_scope) VALUES (?, 0, 0, ?)
           ON CONFLICT(session_id) DO UPDATE SET floor_scope = excluded.floor_scope`,
        ).run(sessionID, next)
        return next
      })
    },

    resetScopeFloor(sessionID: string): void {
      transaction(() => {
        db.query(
          `INSERT INTO execution_scope_escalation (session_id, count, last_at, floor_scope) VALUES (?, 0, 0, 'direct')
           ON CONFLICT(session_id) DO UPDATE SET floor_scope = 'direct'`,
        ).run(sessionID)
      })
    },

    applyScopeEscalation(input: {
      executionID: string
      scope: ExecutionContract.Scope
      contract: unknown
      policy: unknown
      promotionReasons: string[]
      reason: string
      actorID: string
      grantedCalls: number
      grantedSteps: number
      maxPerSession: number
      cooldownMs: number
      now?: number
    }) {
      return transaction(() => {
        const execution = ctx.execution(input.executionID)
        if (!execution) throw new Error("execution not found")
        const sessionID = execution.root_session_id
        const state = ctx.getPolicyState(input.executionID)
        if (!state) throw new Error("execution policy state not found")
        const now = input.now ?? Date.now()
        const prior = db
          .query<
            { count: number; last_at: number; floor_scope: string },
            [string]
          >("SELECT count, last_at, floor_scope FROM execution_scope_escalation WHERE session_id = ?")
          .get(sessionID)
        if ((prior?.count ?? 0) >= input.maxPerSession)
          return { allowed: false as const, reason: "scope_escalation_limit" as const }
        if (prior && now - prior.last_at < input.cooldownMs)
          return { allowed: false as const, reason: "scope_escalation_cooldown" as const }
        const changed = db
          .query(
            `UPDATE execution_policy_state
             SET contract_json = ?, policy_json = ?, promotion_reasons_json = ?, updated_at = ?
             WHERE execution_id = ?`,
          )
          .run(
            JSON.stringify(input.contract),
            JSON.stringify(input.policy),
            JSON.stringify(input.promotionReasons),
            now,
            input.executionID,
          )
        if (changed.changes !== 1) throw new Error("execution policy state not found")
        if (input.grantedCalls > 0 || input.grantedSteps > 0) {
          db.query(
            "UPDATE execution SET granted_calls = granted_calls + ?, granted_steps = granted_steps + ? WHERE id = ?",
          ).run(input.grantedCalls, input.grantedSteps, input.executionID)
        }
        const previousFloor = ExecutionContract.Scope.safeParse(prior?.floor_scope).data ?? "direct"
        const floor =
          ExecutionContract.SCOPE_RANK[input.scope] > ExecutionContract.SCOPE_RANK[previousFloor]
            ? input.scope
            : previousFloor
        db.query(
          `INSERT INTO execution_scope_escalation (session_id, count, last_at, floor_scope) VALUES (?, 1, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET count = count + 1, last_at = excluded.last_at,
             floor_scope = excluded.floor_scope`,
        ).run(sessionID, now, floor)
        db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, input.executionID)
        ctx.appendExecutionEvent(input.executionID, "execution.scope.escalated", now, {
          actorID: input.actorID,
          reason: input.reason,
          grantedCalls: input.grantedCalls,
          grantedSteps: input.grantedSteps,
          scope: input.scope,
        })
        return { allowed: true as const, grantedCalls: input.grantedCalls, grantedSteps: input.grantedSteps }
      })
    },

    applyCheckpoint(input: {
      executionID: string
      checkpointID: string
      decision: "continue" | "finish" | "blocked"
      requestedCalls?: number
      payload: unknown
      now?: number
    }) {
      return transaction(() => {
        const prior = db
          .query<
            { sequence: number; granted_calls: number | null },
            [string, string]
          >("SELECT sequence, granted_calls FROM execution_checkpoint WHERE execution_id = ? AND checkpoint_id = ?")
          .get(input.executionID, input.checkpointID)
        if (prior) {
          return { sequence: prior.sequence, grantedCalls: prior.granted_calls ?? undefined, idempotent: true }
        }
        const sequence =
          (db
            .query<
              { sequence: number },
              [string]
            >("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM execution_checkpoint WHERE execution_id = ?")
            .get(input.executionID)?.sequence ?? 0) + 1
        const policyState = ctx.getPolicyState(input.executionID)
        const extensionLimitReached =
          input.decision === "continue" && (policyState?.extensionCount ?? 0) >= ExecutionCheckpoint.MAX_EXTENSIONS
        const grantedCalls =
          input.decision === "continue" && !extensionLimitReached
            ? Math.min(ExecutionCheckpoint.MAX_SLICE_CALLS, Math.max(1, Math.trunc(input.requestedCalls ?? 30)))
            : undefined
        if (grantedCalls !== undefined) {
          if (!ctx.execution(input.executionID)) throw new Error("execution not found")
          const used = policyState?.evidence?.toolCalls ?? 0
          const changed = db
            .query(
              "UPDATE execution_policy_state SET slice_limit = ?, slice_start_calls = ?, slice_used_calls = 0, checkpoint_requested = 0, checkpoint_failures = 0, extension_count = extension_count + 1, updated_at = ? WHERE execution_id = ?",
            )
            .run(grantedCalls, used, input.now ?? Date.now(), input.executionID)
          if (changed.changes !== 1) throw new Error("execution policy state not found")
          const grantedSteps = grantedCalls
          db.query(
            "UPDATE execution SET granted_calls = granted_calls + ?, granted_steps = granted_steps + ? WHERE id = ?",
          ).run(grantedCalls, grantedSteps, input.executionID)
          const policy = policyState?.policy
          if (policy?.budget) {
            policy.budget.maxToolCalls += grantedCalls
            policy.budget.maxSteps += grantedSteps
            policy.budgetExtension = {
              count: (policy.budgetExtension?.count ?? 0) + 1,
              progress: policyState?.evidence?.successfulToolCalls ?? 0,
              failures: policyState?.evidence?.failureCount ?? 0,
              reasons: [
                ...(policy.budgetExtension?.reasons ?? []),
                `Checkpoint requested next execution slice (${grantedCalls} tool calls)`,
              ],
            }
            db.query("UPDATE execution_policy_state SET policy_json = ? WHERE execution_id = ?").run(
              JSON.stringify(policy),
              input.executionID,
            )
          }
        } else {
          db.query(
            "UPDATE execution_policy_state SET slice_limit = slice_used_calls, checkpoint_requested = 0, checkpoint_failures = 0, updated_at = ? WHERE execution_id = ?",
          ).run(input.now ?? Date.now(), input.executionID)
        }
        db.query(
          "INSERT INTO execution_checkpoint (execution_id, sequence, checkpoint_id, decision, requested_calls, granted_calls, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          input.executionID,
          sequence,
          input.checkpointID,
          input.decision,
          input.requestedCalls ?? null,
          grantedCalls ?? null,
          JSON.stringify(input.payload),
          input.now ?? Date.now(),
        )
        return {
          sequence,
          grantedCalls,
          ...(extensionLimitReached ? { extensionLimitReached: true as const } : {}),
          idempotent: false,
        }
      })
    },

    requestCheckpoint(executionID: string): boolean {
      return (
        db
          .query("UPDATE execution_policy_state SET checkpoint_requested = 1, updated_at = ? WHERE execution_id = ?")
          .run(Date.now(), executionID).changes === 1
      )
    },

    checkpointFailures(executionID: string): number {
      return (
        db
          .query<
            { checkpoint_failures: number },
            [string]
          >("SELECT checkpoint_failures FROM execution_policy_state WHERE execution_id = ?")
          .get(executionID)?.checkpoint_failures ?? 0
      )
    },

    recordCheckpointFailure(executionID: string): number {
      return transaction(() => {
        const changed = db
          .query(
            "UPDATE execution_policy_state SET checkpoint_failures = checkpoint_failures + 1, checkpoint_requested = 1 WHERE execution_id = ?",
          )
          .run(executionID)
        if (changed.changes !== 1) throw new Error("execution policy state not found")
        return (
          db
            .query<
              { checkpoint_failures: number },
              [string]
            >("SELECT checkpoint_failures FROM execution_policy_state WHERE execution_id = ?")
            .get(executionID)?.checkpoint_failures ?? 0
        )
      })
    },

    checkpoints(executionID: string) {
      return db
        .query<
          {
            sequence: number
            checkpoint_id: string | null
            decision: string
            requested_calls: number | null
            granted_calls: number | null
            payload: string
            created_at: number
          },
          [string]
        >(
          "SELECT sequence, checkpoint_id, decision, requested_calls, granted_calls, payload, created_at FROM execution_checkpoint WHERE execution_id = ? ORDER BY sequence",
        )
        .all(executionID)
        .map((row) => ({
          sequence: row.sequence,
          checkpointID: row.checkpoint_id ?? undefined,
          decision: row.decision,
          requestedCalls: row.requested_calls ?? undefined,
          grantedCalls: row.granted_calls ?? undefined,
          payload: JSON.parse(row.payload),
          createdAt: row.created_at,
        }))
    },

    sliceCheckpointRequired(executionID: string): boolean {
      return this.sliceCheckpointReason(executionID) !== undefined
    },

    sliceCheckpointReason(executionID: string): string | undefined {
      const row = db
        .query<
          { slice_limit: number | null; slice_used_calls: number; checkpoint_requested: number },
          [string]
        >("SELECT slice_limit, slice_used_calls, checkpoint_requested FROM execution_policy_state WHERE execution_id = ?")
        .get(executionID)
      if (row?.checkpoint_requested === 1) return "requested"
      const limit = row?.slice_limit ?? 30
      const used = row?.slice_used_calls ?? 0
      if (used >= limit) return "slice_exhausted"
      if (limit > 3 && used >= Math.ceil(limit * 0.8)) return "slice_threshold"
      return undefined
    },

    sliceUsedCalls(executionID: string): number {
      return (
        db
          .query<
            { slice_used_calls: number },
            [string]
          >("SELECT slice_used_calls FROM execution_policy_state WHERE execution_id = ?")
          .get(executionID)?.slice_used_calls ?? 0
      )
    },

    recordObjective(input: { executionID: string; messageID: string; objective: string; now?: number }) {
      return transaction(() => {
        const previous = db
          .query<
            { message_id: string; objective: string },
            [string]
          >("SELECT message_id, objective FROM execution_objective WHERE execution_id = ?")
          .get(input.executionID)
        if (previous) {
          if (previous.message_id !== input.messageID || previous.objective !== input.objective) {
            throw new Error("execution root objective is immutable")
          }
          return false
        }
        db.query(
          "INSERT INTO execution_objective (execution_id, message_id, objective, created_at) VALUES (?, ?, ?, ?)",
        ).run(input.executionID, input.messageID, input.objective, input.now ?? Date.now())
        return true
      })
    },

    objective(executionID: string) {
      return db
        .query<
          { message_id: string; objective: string; created_at: number },
          [string]
        >("SELECT message_id, objective, created_at FROM execution_objective WHERE execution_id = ?")
        .get(executionID)
    },

    savePolicyState(input: {
      executionID: string
      contract: unknown
      policy: unknown
      evidence: unknown
      promotionReasons: string[]
      classifierFallback: boolean
      extensionCount: number
      sliceLimit?: number
      sliceStartCalls?: number
      sliceUsedCalls?: number
    }) {
      return transaction(() => {
        const previous = ctx.getPolicyState(input.executionID)
        const contract = input.contract as Partial<ExecutionContract.Info>
        if (contract.acceptance?.length && !Bun.deepEquals(contract.acceptance, previous?.contract?.acceptance)) {
          const now = Date.now()
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
          ctx.appendExecutionEvent(input.executionID, "execution.updated", now, {
            kind: "acceptance_revision",
            revision: contract.acceptanceRevision,
            criteria: contract.acceptance,
            ...contract.acceptanceChange,
          })
        }
        const policyInput =
          input.policy && typeof input.policy === "object" ? (input.policy as PolicyPayload) : undefined
        const policy =
          policyInput?.budget && previous?.policy?.budget
            ? {
                ...policyInput,
                budget: {
                  ...policyInput.budget,
                  maxSteps: Math.max(policyInput.budget.maxSteps, previous.policy.budget.maxSteps),
                  maxToolCalls: Math.max(policyInput.budget.maxToolCalls, previous.policy.budget.maxToolCalls),
                },
                budgetExtension:
                  previous.extensionCount > input.extensionCount
                    ? previous.policy.budgetExtension
                    : policyInput.budgetExtension,
              }
            : input.policy
        db.query(
          `
          INSERT INTO execution_policy_state
            (execution_id, contract_json, policy_json, evidence_json, promotion_reasons_json, classifier_fallback, extension_count, slice_limit, slice_start_calls, slice_used_calls, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(execution_id) DO UPDATE SET
            contract_json = excluded.contract_json,
            policy_json = excluded.policy_json,
            evidence_json = excluded.evidence_json,
            promotion_reasons_json = excluded.promotion_reasons_json,
            classifier_fallback = excluded.classifier_fallback,
            -- Slice counters belong exclusively to reservation/checkpoint transactions.
            -- Evidence saves may contain stale values, including during an awaited tool registration.
            updated_at = excluded.updated_at
        `,
        ).run(
          input.executionID,
          JSON.stringify(input.contract),
          JSON.stringify(policy),
          JSON.stringify(input.evidence),
          JSON.stringify(input.promotionReasons),
          input.classifierFallback ? 1 : 0,
          input.extensionCount,
          input.sliceLimit ?? null,
          input.sliceStartCalls ?? null,
          input.sliceUsedCalls ?? 0,
          Date.now(),
        )
      })
    },
  }
}
