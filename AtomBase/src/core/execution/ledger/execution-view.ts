import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"
import { LedgerTypes } from "./types"

type BudgetScope = {
  limitMicrousd?: number
  spentMicrousd: number
  reservedMicrousd: number
  uncertainMicrousd: number
  unpricedCalls: number
}

type RouteView = {
  active: ExecutionLedger.Route
  base: ExecutionLedger.Route
  stage: "base" | "expert"
  activeEpisodeID?: string
  manualModelPin: boolean
  manualThinkingPin: boolean
  expert?: {
    episodes: number
    maxEpisodes: number
    calls: number
    maxCalls: number
    steps: number
    maxSteps: number
  }
}

type Context = {
  db: Database
  execution(executionID: string): ExecutionLedger.ExecutionRow | undefined
  executionState(executionID: string): ExecutionLedger.ExecutionState | undefined
  total(scopeID: string): ExecutionLedger.TotalRow | undefined
  unpricedCalls(where: string, value: string): number
  budgetScope(total: ExecutionLedger.TotalRow, limitMicrousd: number | undefined, unpriced: number): BudgetScope
  executionBudgetScope(current: ExecutionLedger.ExecutionRow): string
  scopeMaxCost(scopeID: string): number | undefined
  completion(executionID: string): ExecutionLedger.Completion | undefined
  executionRoute(executionID: string): RouteView | undefined
}

export function createExecutionView(ctx: Context) {
  const { db } = ctx
  const {
    execution,
    executionState,
    total,
    unpricedCalls,
    budgetScope,
    executionBudgetScope,
    scopeMaxCost,
    completion,
    executionRoute,
  } = ctx
  const ExecutionView = LedgerTypes.ExecutionView
  const ReasonCode = LedgerTypes.ReasonCode
  type TotalRow = ExecutionLedger.TotalRow
  type BlockerState = ExecutionLedger.BlockerState
  return function executionView(executionID: string): ExecutionLedger.ExecutionView | undefined {
    const current = execution(executionID)
    if (!current) return
    const state = executionState(executionID)!
    const rootInvocation = db
      .query<{ id: string; accepted_message_id: string | null }, [string]>(
        `SELECT id, accepted_message_id FROM execution_invocation
         WHERE execution_id = ? AND kind = 'root' ORDER BY created_at, id LIMIT 1`,
      )
      .get(executionID)
    const rootInvocationID = rootInvocation?.id ?? executionID
    const executionScopeID = executionBudgetScope(current)
    const rootScopeID = `root-session:${current.root_session_id}`
    const projectScopeID = `project:${current.project_id}`
    const emptyTotal: TotalRow = { calls: 0, pending_calls: 0, steps: 0, spent: 0, reserved: 0, uncertain: 0 }
    const executionTotal = total(executionScopeID) ?? emptyTotal
    const rootTotal = total(rootScopeID) ?? emptyTotal
    const projectTotal = total(projectScopeID) ?? emptyTotal
    const blockerRows = db
      .query<
        { state: BlockerState; count: number },
        [string]
      >("SELECT state, COUNT(*) AS count FROM execution_blocker WHERE execution_id = ? GROUP BY state")
      .all(executionID)
    const blockerCounts = new Map(blockerRows.map((row) => [row.state, row.count]))
    const openWork =
      db
        .query<
          { count: number },
          [string]
        >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND state IN ('draining', 'unknown')")
        .get(executionID)?.count ?? 0
    const candidate = completion(executionID)
    const turnSequence =
      db
        .query<{ sequence: number }, [string, number, number, string]>(
          `SELECT COUNT(*) AS sequence FROM execution
           WHERE root_session_id = ? AND (created_at < ? OR (created_at = ? AND id <= ?))`,
        )
        .get(current.root_session_id, current.created_at, current.created_at, executionID)?.sequence ?? 1
    const publicReason = state.reason
      ? ReasonCode.safeParse(state.reason.code).success
        ? state.reason
        : {
            code: "provider_unavailable" as const,
            message: "The execution stopped because its provider became unavailable.",
            retryable: false,
          }
      : undefined
    return ExecutionView.parse({
      id: executionID,
      projectID: current.project_id,
      rootSessionID: current.root_session_id,
      resumesExecutionID: current.resumes_execution_id ?? undefined,
      budgetScopeID: current.budget_scope_id,
      rootInvocationID,
      userMessageID: rootInvocation?.accepted_message_id ?? rootInvocationID,
      sessionGeneration: current.session_generation,
      turnSequence,
      version: state.version,
      routeRevision: current.route_revision,
      route: executionRoute(executionID),
      lifecycle: state.lifecycle,
      phase: state.phase,
      outcome: state.outcome,
      reason: publicReason,
      createdAt: current.created_at,
      updatedAt: state.updatedAt,
      terminalAt: state.terminalAt,
      budget: {
        execution: {
          ...budgetScope(
            executionTotal,
            current.max_cost ?? undefined,
            unpricedCalls("owner.budget_scope_id", current.budget_scope_id),
          ),
          calls: {
            used: executionTotal.calls,
            limit: current.max_calls ?? undefined,
          },
          steps: {
            used: executionTotal.steps,
            limit: current.max_steps ?? undefined,
          },
          deadlineAt: current.deadline_at ?? undefined,
        },
        rootSession: budgetScope(
          rootTotal,
          scopeMaxCost(rootScopeID),
          unpricedCalls("owner.root_session_id", current.root_session_id),
        ),
        project: budgetScope(
          projectTotal,
          scopeMaxCost(projectScopeID),
          unpricedCalls("owner.project_id", current.project_id),
        ),
      },
      blockers: {
        pending: (blockerCounts.get("pending") ?? 0) + (blockerCounts.get("resumable") ?? 0),
        running: (blockerCounts.get("running") ?? 0) + (blockerCounts.get("draining") ?? 0),
        unknown: blockerCounts.get("unknown") ?? 0,
        failed: (blockerCounts.get("failed") ?? 0) + (blockerCounts.get("cancelled") ?? 0),
      },
      recoveryRequired:
        openWork > 0 ||
        candidate?.projection === "recovery_required" ||
        (blockerCounts.get("unknown") ?? 0) > 0 ||
        (blockerCounts.get("failed") ?? 0) > 0 ||
        (blockerCounts.get("cancelled") ?? 0) > 0,
      unknownWork: db
        .query<
          {
            id: string
            execution_id: string
            invocation_id: string
            kind: string
            mutating: number
            state: "unknown"
            version: number
            created_at: number
            began_at: number | null
          },
          [string]
        >(
          `SELECT id, execution_id, invocation_id, kind, mutating, state, version, created_at, began_at
           FROM execution_work WHERE execution_id = ? AND state = 'unknown' ORDER BY created_at, id`,
        )
        .all(executionID)
        .map((row) => ({
          id: row.id,
          executionID: row.execution_id,
          invocationID: row.invocation_id,
          kind: row.kind,
          mutating: Boolean(row.mutating),
          state: row.state,
          version: row.version,
          createdAt: row.created_at,
          beganAt: row.began_at ?? undefined,
        })),
      completion: candidate
        ? {
            id: `completion:${executionID}`,
            messageID: candidate.messageID,
            digest: candidate.digest,
            projection: candidate.projection,
          }
        : undefined,
    })
  }
}
