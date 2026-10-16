import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
}

export function createPolicyStateModule(ctx: Context) {
  const { db } = ctx
  const { transaction } = ctx
  function scopeIDs(current: ExecutionLedger.ExecutionRow) {
    return [executionBudgetScope(current), `root-session:${current.root_session_id}`, `project:${current.project_id}`]
  }
  function executionBudgetScope(current: ExecutionLedger.ExecutionRow) {
    return `execution:${current.budget_scope_id}`
  }
  function tighten(current: number | null, incoming: number | undefined) {
    if (incoming === undefined) return current
    return current === null ? incoming : Math.min(current, incoming)
  }
  function tightenScopePolicy(scopeID: string, maxCost: number | undefined) {
    db.query("INSERT OR IGNORE INTO scope_policy (scope_id, max_cost) VALUES (?, ?)").run(scopeID, maxCost ?? null)
    if (maxCost !== undefined) {
      db.query(
        "UPDATE scope_policy SET max_cost = CASE WHEN max_cost IS NULL THEN ? ELSE MIN(max_cost, ?) END WHERE scope_id = ?",
      ).run(maxCost, maxCost, scopeID)
    }
  }
  function scopeMaxCost(scopeID: string) {
    const value = db
      .query<{ max_cost: number | null }, [string]>("SELECT max_cost FROM scope_policy WHERE scope_id = ?")
      .get(scopeID)?.max_cost
    return value === null ? undefined : value
  }
  function reserveToolAllowance(executionID: string): boolean {
    return transaction(() => {
      const row = db
        .query<
          { slice_limit: number | null; slice_used_calls: number },
          [string]
        >("SELECT slice_limit, slice_used_calls FROM execution_policy_state WHERE execution_id = ?")
        .get(executionID)
      if (!row) return true
      const limit = row.slice_limit ?? 30
      if (row.slice_used_calls >= limit) return false
      const changed = db
        .query(
          "UPDATE execution_policy_state SET slice_used_calls = slice_used_calls + 1, updated_at = ? WHERE execution_id = ? AND slice_used_calls < COALESCE(slice_limit, 30)",
        )
        .run(Date.now(), executionID)
      return changed.changes === 1
    })
  }

  function releaseToolAllowance(executionID: string): void {
    transaction(() => {
      db.query(
        "UPDATE execution_policy_state SET slice_used_calls = MAX(0, slice_used_calls - 1), updated_at = ? WHERE execution_id = ?",
      ).run(Date.now(), executionID)
    })
  }

  function getPolicyState(executionID: string) {
    const row = db
      .query<
        {
          contract_json: string
          policy_json: string
          evidence_json: string
          promotion_reasons_json: string
          classifier_fallback: number
          extension_count: number
          slice_limit: number | null
          slice_start_calls: number | null
          slice_used_calls: number
        },
        [string]
      >(
        "SELECT contract_json, policy_json, evidence_json, promotion_reasons_json, classifier_fallback, extension_count, slice_limit, slice_start_calls, slice_used_calls FROM execution_policy_state WHERE execution_id = ?",
      )
      .get(executionID)
    if (!row) return undefined
    try {
      return {
        contract: JSON.parse(row.contract_json),
        policy: JSON.parse(row.policy_json),
        evidence: JSON.parse(row.evidence_json),
        promotionReasons: JSON.parse(row.promotion_reasons_json),
        classifierFallback: row.classifier_fallback === 1,
        extensionCount: row.extension_count,
        sliceLimit: row.slice_limit,
        sliceStartCalls: row.slice_start_calls,
        sliceUsedCalls: row.slice_used_calls,
      }
    } catch {
      return undefined
    }
  }
  return {
    reserveToolAllowance,
    releaseToolAllowance,
    getPolicyState,
    scopeIDs,
    executionBudgetScope,
    tighten,
    tightenScopePolicy,
    scopeMaxCost,
  }
}
