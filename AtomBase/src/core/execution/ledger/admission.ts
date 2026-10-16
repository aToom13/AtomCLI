import { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

type CurrentExecution = {
  status: string
  fence: number
  deadline_at: number | null
  max_calls: number | null
  max_steps: number | null
  max_cost: number | null
  granted_calls: number
  granted_steps: number
  owner_id: string | null
  lease_expires_at: number | null
  root_session_id: string
  project_id: string
  unknown_price_blocked: number
  mutation_revision: number
  plan_revision: number
}

type AttemptRow = {
  id: string
  execution_id: string
  invocation_id: string | null
  run_id: string
  fence: number
  purpose: string
  state: ExecutionLedger.AttemptState
  estimate: number
  actual: number | null
}

type TotalRow = {
  calls: number
  pending_calls: number
  steps: number
  spent: number
  reserved: number
  uncertain: number
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): CurrentExecution | undefined
  invocationReviewAuthorized(executionID: string, invocationID: string): boolean
  attemptReviewAuthorized(attemptID: string): boolean
  reviewClaim(executionID: string): { id: string } | undefined
  expertLimitReached(current: CurrentExecution, dimension: "calls" | "steps", increment: number): boolean
  total(scopeID: string): TotalRow
  changeTotal(scopeID: string, values: Partial<TotalRow>): void
  emitBudgetWarnings(current: CurrentExecution, now: number): void
  ownershipValid(current: CurrentExecution, ownerID: string | undefined, fence: number, now: number): boolean
  scopeIDs(current: CurrentExecution): string[]
  executionBudgetScope(current: CurrentExecution): string
  scopeMaxCost(scopeID: string): number | undefined
  touchExecution(
    executionID: string,
    now: number,
    type?: ExecutionLedger.EventType,
    properties?: Record<string, unknown>,
  ): void
}

export function createAdmissionModule(ctx: Context) {
  const { db, transaction } = ctx

  return {
    claimOwner(input: { executionID: string; ownerID: string; leaseMs: number; now?: number }) {
      if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) throw new Error("leaseMs must be positive")
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { acquired: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (
          current.owner_id !== null &&
          current.owner_id !== input.ownerID &&
          current.lease_expires_at !== null &&
          now < current.lease_expires_at
        ) {
          return { acquired: false as const, reason: "owned" as const, retryAt: current.lease_expires_at }
        }
        const takeover = current.owner_id !== null && current.owner_id !== input.ownerID
        const fence = takeover ? current.fence + 1 : current.fence
        const leaseExpiresAt = now + input.leaseMs
        if (takeover) {
          const abandoned = db
            .query<
              Pick<AttemptRow, "id" | "estimate">,
              [string, number]
            >("SELECT id, estimate FROM attempt WHERE execution_id = ? AND state = 'reserved' AND fence < ?")
            .all(input.executionID, fence)
          if (abandoned.length) {
            db.query(
              "UPDATE attempt SET state = 'released' WHERE execution_id = ? AND state = 'reserved' AND fence < ?",
            ).run(input.executionID, fence)
            const released = abandoned.reduce((total, attempt) => total + attempt.estimate, 0)
            for (const scopeID of ctx.scopeIDs(current)) {
              ctx.changeTotal(scopeID, { pending_calls: -abandoned.length, reserved: -released })
            }
          }
          db.query(
            `UPDATE execution_work SET state = 'cancelled', version = version + 1,
               evidence = 'Read-only operation cancelled during owner takeover', resolution_code = 'takeover_cancelled', finished_at = ?
             WHERE execution_id = ? AND mutating = 0 AND state IN ('running', 'draining') AND fence < ?`,
          ).run(now, input.executionID, fence)
          db.query(
            `UPDATE execution_work SET state = 'unknown', version = version + 1, finished_at = ?
             WHERE execution_id = ? AND mutating = 1 AND state IN ('running', 'draining') AND fence < ?`,
          ).run(now, input.executionID, fence)
          db.query(
            `UPDATE execution_work SET state = 'cancelled', version = version + 1,
               evidence = 'No effect began before owner takeover', resolution_code = 'not_begun', finished_at = ?
             WHERE execution_id = ? AND state = 'prepared' AND fence < ?`,
          ).run(now, input.executionID, fence)
          db.query(
            `UPDATE execution_invocation SET state = 'unknown', revision = revision + 1, finished_at = ?
             WHERE execution_id = ? AND state IN ('accepted', 'running', 'waiting', 'draining') AND fence < ?`,
          ).run(now, input.executionID, fence)
          db.query(
            `UPDATE execution_blocker SET state = 'unknown', version = version + 1, updated_at = ?, finished_at = NULL
             WHERE execution_id = ? AND state IN ('running', 'draining') AND fence < ?`,
          ).run(now, input.executionID, fence)
        }
        db.query("UPDATE execution SET owner_id = ?, fence = ?, lease_expires_at = ? WHERE id = ?").run(
          input.ownerID,
          fence,
          leaseExpiresAt,
          input.executionID,
        )
        return { acquired: true as const, fence, leaseExpiresAt, takeover }
      })
    },

    renewOwner(input: { executionID: string; ownerID: string; fence: number; leaseMs: number; now?: number }) {
      if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) throw new Error("leaseMs must be positive")
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { renewed: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (current.owner_id !== input.ownerID || current.fence !== input.fence) {
          return { renewed: false as const, reason: "stale_fence" as const }
        }
        const leaseExpiresAt = now + input.leaseMs
        db.query("UPDATE execution SET lease_expires_at = ? WHERE id = ?").run(leaseExpiresAt, input.executionID)
        return { renewed: true as const, leaseExpiresAt }
      })
    },

    claimStep(input: {
      stepID: string
      executionID: string
      invocationID?: string
      ownerID?: string
      fence: number
      maxSteps?: number
      now?: number
    }) {
      return transaction(
        ():
          | { admitted: true; idempotent: boolean }
          | { admitted: false; reason: Extract<ExecutionLedger.Admission, { admitted: false }>["reason"] } => {
          const current = ctx.execution(input.executionID)
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { admitted: false, reason: "not_active" }
          }
          const now = input.now ?? Date.now()
          if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
            return { admitted: false, reason: "stale_fence" }
          }
          if (
            current.status === "finalizing" &&
            (!input.invocationID || !ctx.invocationReviewAuthorized(input.executionID, input.invocationID))
          ) {
            return { admitted: false, reason: "not_active" }
          }
          const previous = db
            .query<{ execution_id: string }, [string]>("SELECT execution_id FROM execution_step WHERE id = ?")
            .get(input.stepID)
          if (previous) {
            if (previous.execution_id !== input.executionID) throw new Error("step ID belongs to another execution")
            return { admitted: true, idempotent: true }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) return { admitted: false, reason: "deadline" }
          const executionScope = ctx.executionBudgetScope(current)
          if (ctx.expertLimitReached(current, "steps", 1)) return { admitted: false, reason: "step_limit" }
          const effectiveMaxSteps = current.max_steps
          const maxSteps =
            effectiveMaxSteps === null
              ? input.maxSteps
              : input.maxSteps === undefined
                ? effectiveMaxSteps
                : Math.min(effectiveMaxSteps, input.maxSteps)
          if (maxSteps !== undefined && ctx.total(executionScope).steps + 1 > maxSteps) {
            return { admitted: false, reason: "step_limit" }
          }
          db.query("INSERT INTO execution_step (id, execution_id, created_at) VALUES (?, ?, ?)").run(
            input.stepID,
            input.executionID,
            now,
          )
          ctx.changeTotal(executionScope, { steps: 1 })
          ctx.touchExecution(input.executionID, now)
          return { admitted: true, idempotent: false }
        },
      )
    },

    reserve(input: {
      attemptID: string
      executionID: string
      invocationID?: string
      runID: string
      fence: number
      purpose: string
      sessionID?: string
      estimateMicrousd: number
      priceKnown?: boolean
      now?: number
    }): ExecutionLedger.Admission {
      if (!Number.isSafeInteger(input.estimateMicrousd) || input.estimateMicrousd < 0) {
        throw new Error("estimateMicrousd must be a non-negative safe integer")
      }
      return transaction(() => {
        const previous = db
          .query<
            AttemptRow,
            [string]
          >("SELECT id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, actual FROM attempt WHERE id = ?")
          .get(input.attemptID)
        if (previous) {
          if (previous.execution_id !== input.executionID) throw new Error("attempt ID belongs to another execution")
          const current = ctx.execution(input.executionID)
          if (
            !current ||
            (current.status !== "active" &&
              !(
                current.status === "finalizing" &&
                input.invocationID &&
                previous.invocation_id === input.invocationID &&
                ctx.invocationReviewAuthorized(input.executionID, input.invocationID)
              ))
          ) {
            return { admitted: false, reason: "not_active" }
          }
          const now = input.now ?? Date.now()
          if (
            !ctx.ownershipValid(current, input.runID, input.fence, now) ||
            previous.fence !== input.fence ||
            previous.run_id !== input.runID
          ) {
            return { admitted: false, reason: "stale_fence" }
          }
          return { admitted: true, attemptID: previous.id, state: previous.state, idempotent: true }
        }
        const current = ctx.execution(input.executionID)
        if (
          !current ||
          (current.status !== "active" &&
            !(
              current.status === "finalizing" &&
              input.invocationID &&
              ctx.invocationReviewAuthorized(input.executionID, input.invocationID)
            ))
        ) {
          return { admitted: false, reason: "not_active" }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.runID, input.fence, now)) {
          return { admitted: false, reason: "stale_fence" }
        }
        if (current.deadline_at !== null && now >= current.deadline_at) return { admitted: false, reason: "deadline" }

        const executionScope = ctx.executionBudgetScope(current)
        const rootScope = `root-session:${current.root_session_id}`
        const projectScope = `project:${current.project_id}`
        const executionTotal = ctx.total(executionScope)
        const rootTotal = ctx.total(rootScope)
        const projectTotal = ctx.total(projectScope)
        if (ctx.expertLimitReached(current, "calls", 1)) return { admitted: false, reason: "call_limit" }
        if (current.max_calls !== null && executionTotal.calls + executionTotal.pending_calls + 1 > current.max_calls) {
          return { admitted: false, reason: "call_limit" }
        }
        const executionCost = executionTotal.spent + executionTotal.reserved + executionTotal.uncertain
        const rootCost = rootTotal.spent + rootTotal.reserved + rootTotal.uncertain
        const projectCost = projectTotal.spent + projectTotal.reserved + projectTotal.uncertain
        if (
          (current.max_cost !== null && executionCost + input.estimateMicrousd > current.max_cost) ||
          (ctx.scopeMaxCost(rootScope) !== undefined &&
            rootCost + input.estimateMicrousd > ctx.scopeMaxCost(rootScope)!) ||
          (ctx.scopeMaxCost(projectScope) !== undefined &&
            projectCost + input.estimateMicrousd > ctx.scopeMaxCost(projectScope)!)
        ) {
          return { admitted: false, reason: "cost_limit" }
        }

        db.query(
          `INSERT INTO attempt
            (id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, price_known,
             created_at, session_id, review_id)
           VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)`,
        ).run(
          input.attemptID,
          input.executionID,
          input.invocationID ?? null,
          input.runID,
          input.fence,
          input.purpose,
          input.estimateMicrousd,
          input.priceKnown === false ? 0 : 1,
          now,
          input.sessionID ?? null,
          current.status === "finalizing" ? (ctx.reviewClaim(input.executionID)?.id ?? null) : null,
        )
        for (const scopeID of [executionScope, rootScope, projectScope]) {
          ctx.changeTotal(scopeID, { pending_calls: 1, reserved: input.estimateMicrousd })
        }
        ctx.touchExecution(input.executionID, now)
        ctx.emitBudgetWarnings(current, now)
        return { admitted: true, attemptID: input.attemptID, state: "reserved", idempotent: false }
      })
    },

    dispatch(input: { attemptID: string; runID: string; fence: number; now?: number }) {
      return transaction(() => {
        const attempt = db
          .query<
            AttemptRow,
            [string]
          >("SELECT id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, actual FROM attempt WHERE id = ?")
          .get(input.attemptID)
        if (!attempt) throw new Error(`Unknown attempt: ${input.attemptID}`)
        const current = ctx.execution(attempt.execution_id)!
        if (attempt.state !== "reserved") {
          return { dispatched: false as const, reason: "not_reserved" as const, state: attempt.state }
        }
        const now = input.now ?? Date.now()
        let reason: "not_active" | "stale_fence" | "deadline" | undefined
        if (
          current.status !== "active" &&
          !(current.status === "finalizing" && ctx.attemptReviewAuthorized(input.attemptID))
        )
          reason = "not_active"
        else if (
          !ctx.ownershipValid(current, input.runID, input.fence, now) ||
          attempt.fence !== input.fence ||
          attempt.run_id !== input.runID
        )
          reason = "stale_fence"
        else if (current.deadline_at !== null && now >= current.deadline_at) reason = "deadline"
        if (reason) {
          db.query("UPDATE attempt SET state = 'released' WHERE id = ?").run(input.attemptID)
          for (const scopeID of ctx.scopeIDs(current)) {
            ctx.changeTotal(scopeID, { pending_calls: -1, reserved: -attempt.estimate })
          }
          ctx.touchExecution(attempt.execution_id, now)
          ctx.emitBudgetWarnings(current, now)
          return { dispatched: false as const, reason }
        }
        db.query("UPDATE attempt SET state = 'dispatched', dispatched_at = ? WHERE id = ?").run(now, input.attemptID)
        for (const scopeID of ctx.scopeIDs(current)) {
          ctx.changeTotal(scopeID, { pending_calls: -1, calls: 1 })
        }
        ctx.touchExecution(attempt.execution_id, now)
        ctx.emitBudgetWarnings(current, now)
        return { dispatched: true as const }
      })
    },

    settle(attemptID: string, actualMicrousd: number, now = Date.now()) {
      if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd < 0) throw new Error("invalid actualMicrousd")
      return transaction(() => {
        const attempt = db
          .query<
            AttemptRow,
            [string]
          >("SELECT id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, actual FROM attempt WHERE id = ?")
          .get(attemptID)
        if (!attempt) throw new Error(`Unknown attempt: ${attemptID}`)
        if (attempt.state === "settled") {
          if (attempt.actual !== actualMicrousd) throw new Error("Attempt was already settled with a different cost")
          return "settled" as const
        }
        if (attempt.state !== "dispatched" && attempt.state !== "uncertain") {
          throw new Error(`Cannot settle attempt in state ${attempt.state}`)
        }
        const current = ctx.execution(attempt.execution_id)!
        db.query("UPDATE attempt SET state = 'settled', actual = ?, settled_at = ? WHERE id = ?").run(
          actualMicrousd,
          now,
          attemptID,
        )
        for (const scopeID of ctx.scopeIDs(current)) {
          ctx.changeTotal(scopeID, {
            [attempt.state === "uncertain" ? "uncertain" : "reserved"]: -attempt.estimate,
            spent: actualMicrousd,
          })
        }
        ctx.touchExecution(attempt.execution_id, now)
        ctx.emitBudgetWarnings(current, now)
        return "settled" as const
      })
    },

    uncertain(attemptID: string, now = Date.now()) {
      return transaction(() => {
        const attempt = db
          .query<
            AttemptRow,
            [string]
          >("SELECT id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, actual FROM attempt WHERE id = ?")
          .get(attemptID)
        if (!attempt) throw new Error(`Unknown attempt: ${attemptID}`)
        if (attempt.state === "uncertain") return "uncertain" as const
        if (attempt.state !== "dispatched") throw new Error(`Cannot mark attempt uncertain in state ${attempt.state}`)
        const current = ctx.execution(attempt.execution_id)!
        db.query("UPDATE attempt SET state = 'uncertain' WHERE id = ?").run(attemptID)
        for (const scopeID of ctx.scopeIDs(current)) {
          ctx.changeTotal(scopeID, { reserved: -attempt.estimate, uncertain: attempt.estimate })
        }
        ctx.touchExecution(attempt.execution_id, now)
        ctx.emitBudgetWarnings(current, now)
        return "uncertain" as const
      })
    },

    release(attemptID: string, now = Date.now()) {
      return transaction(() => {
        const attempt = db
          .query<
            AttemptRow,
            [string]
          >("SELECT id, execution_id, invocation_id, run_id, fence, purpose, state, estimate, actual FROM attempt WHERE id = ?")
          .get(attemptID)
        if (!attempt) throw new Error(`Unknown attempt: ${attemptID}`)
        if (attempt.state === "released") return "released" as const
        if (attempt.state !== "reserved") throw new Error(`Cannot release attempt in state ${attempt.state}`)
        const current = ctx.execution(attempt.execution_id)!
        db.query("UPDATE attempt SET state = 'released' WHERE id = ?").run(attemptID)
        for (const scopeID of ctx.scopeIDs(current)) {
          ctx.changeTotal(scopeID, { pending_calls: -1, reserved: -attempt.estimate })
        }
        ctx.touchExecution(attempt.execution_id, now)
        ctx.emitBudgetWarnings(current, now)
        return "released" as const
      })
    },

    totals(scopeID: string) {
      return ctx.total(scopeID)
    },

    requiresKnownPrice(executionID: string) {
      return ctx.execution(executionID)?.unknown_price_blocked === 1
    },

    revision(executionID: string) {
      return ctx.execution(executionID)?.mutation_revision
    },

    planRevision(executionID: string) {
      return ctx.execution(executionID)?.plan_revision
    },

    stepCount(executionID: string) {
      const row = db
        .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM execution_step WHERE execution_id = ?")
        .get(executionID)
      return row?.count ?? 0
    },
  }
}
