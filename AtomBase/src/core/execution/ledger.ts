import { Database } from "bun:sqlite"
import z from "zod"

const MAX_PENDING_CONTINUATIONS = 100
const COMPLETION_PROJECTION_PAGE_SIZE = 50
const MAX_WORK_ITEMS_PER_EXECUTION = 10_000
const MAX_BLOCKERS_PER_EXECUTION = 1_000
const MAX_PLAN_ITEMS = 200
const MAX_BLOCKER_EVIDENCE_BYTES = 16 * 1024
const MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT = 1_000
const TERMINAL_EXECUTIONS_PER_SNAPSHOT = 20
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RETAINED_EVENTS = 100_000

export namespace ExecutionLedger {
  export const Policy = z.object({
    maxCalls: z.number().int().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    maxCostMicrousd: z.number().int().nonnegative().optional(),
    rootMaxCostMicrousd: z.number().int().nonnegative().optional(),
    projectMaxCostMicrousd: z.number().int().nonnegative().optional(),
    unknownPriceBlocked: z.boolean().optional(),
  })
  export type Policy = z.infer<typeof Policy>

  export const AttemptState = z.enum(["reserved", "dispatched", "settled", "released", "uncertain"])
  export type AttemptState = z.infer<typeof AttemptState>

  export type Admission =
    | { admitted: true; attemptID: string; state: AttemptState; idempotent: boolean }
    | {
        admitted: false
        reason: "not_active" | "stale_fence" | "deadline" | "step_limit" | "call_limit" | "cost_limit"
      }
  type RejectionReason = Extract<Admission, { admitted: false }>["reason"]

  type ExecutionRow = {
    id: string
    project_id: string
    root_session_id: string
    resumes_execution_id: string | null
    budget_scope_id: string
    session_generation: number
    created_at: number
    status: string
    fence: number
    deadline_at: number | null
    max_calls: number | null
    max_steps: number | null
    max_cost: number | null
    owner_id: string | null
    lease_expires_at: number | null
    unknown_price_blocked: number
    mutation_revision: number
    plan_revision: number
    route_revision: number
    lifecycle: ExecutionLifecycle
    phase: ExecutionPhase
    outcome: ExecutionOutcome | null
    reason_code: string | null
    reason_message: string | null
    reason_retryable: number
    version: number
    updated_at: number
    terminal_at: number | null
    deleted_at: number | null
  }

  type AttemptRow = {
    id: string
    execution_id: string
    invocation_id: string | null
    run_id: string
    fence: number
    purpose: string
    state: AttemptState
    estimate: number
    actual: number | null
    price_known: number
  }
  type TotalRow = {
    calls: number
    pending_calls: number
    steps: number
    spent: number
    reserved: number
    uncertain: number
  }
  export type Context = {
    executionID: string
    rootSessionID: string
    invocationID: string
    ownerID: string
    fence: number
  }
  export type Completion = {
    executionID: string
    sessionID: string
    messageID: string
    parentUserID?: string
    ownerID: string
    fence: number
    finish: string
    payload: string
    reviewFiles: string
    digest: string
    requiresReview: boolean
    revision: number
    planRevision: number
    routeRevision: number
    policyVersion: number
    policyDigest: string
    reviewRequirement: "required" | "not_required" | "user_bypass"
    reviewReasonCode: string
    requiredReviewers: number
    attemptLimit: number
    contentSnapshotDigest: string
    deliveryPayload?: string
    deliveryFinish?: string
    outcome?: ExecutionOutcome
    reasonCode?: string
    projection: "pending" | "projected" | "recovery_required" | "abandoned"
    state: "staged" | "committed" | "discarded"
  }
  export type CompletionClaim = Completion & {
    projectorID: string
    projectionToken: string
    projectionLeaseExpiresAt: number
    sessionGeneration: number
  }

  export const Lifecycle = z.enum(["active", "draining", "terminal"])
  export type ExecutionLifecycle = z.infer<typeof Lifecycle>
  export const Phase = z.enum([
    "queued",
    "preparing",
    "model",
    "tools",
    "waiting_permission",
    "waiting_children",
    "awaiting_route_approval",
    "reviewing",
    "finalizing",
    "awaiting_reconciliation",
    "draining",
    "idle",
  ])
  export type ExecutionPhase = z.infer<typeof Phase>
  export const Outcome = z.enum(["completed", "failed", "cancelled", "budget_exhausted", "blocked"])
  export type ExecutionOutcome = z.infer<typeof Outcome>
  export const ReasonCode = z.enum([
    "user_cancelled",
    "invocation_cancelled",
    "provider_unavailable",
    "verification_required",
    "no_verified_model",
    "unsupported_variant",
    "deadline",
    "call_limit",
    "step_limit",
    "cost_limit",
    "unknown_price",
    "review_rejected",
    "review_unavailable",
    "active_work",
    "recovery_required",
    "stale_owner",
    "storage_error",
    "resource_limit",
    "approval_required",
    "deleted",
  ])
  export type ReasonCode = z.infer<typeof ReasonCode>
  export type ExecutionState = {
    id: string
    lifecycle: ExecutionLifecycle
    phase: ExecutionPhase
    outcome: ExecutionOutcome | null
    reason?: { code: string; message: string; retryable: boolean }
    version: number
    updatedAt: number
    terminalAt?: number
  }

  export const EventType = z.enum([
    "execution.updated",
    "execution.deleted",
    "execution.route.changed",
    "execution.budget.warning",
    "execution.blocker.updated",
    "route.proposal.updated",
  ])
  export type EventType = z.infer<typeof EventType>
  export const EventEnvelope = z.object({
    eventID: z.string(),
    cursor: z.object({ epoch: z.string(), sequence: z.number().int().nonnegative() }),
    projectID: z.string(),
    sessionID: z.string(),
    sessionGeneration: z.number().int().positive(),
    executionID: z.string().optional(),
    resourceVersion: z.number().int().positive(),
    type: EventType,
    properties: z.record(z.string(), z.unknown()),
  })
  export type EventEnvelope = z.infer<typeof EventEnvelope>
  export const BudgetScopeView = z.object({
    limitMicrousd: z.number().int().nonnegative().optional(),
    spentMicrousd: z.number().int().nonnegative(),
    reservedMicrousd: z.number().int().nonnegative(),
    uncertainMicrousd: z.number().int().nonnegative(),
    unpricedCalls: z.number().int().nonnegative(),
  })
  export const BudgetView = z.object({
    execution: BudgetScopeView.extend({
      calls: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive().optional() }),
      steps: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive().optional() }),
      deadlineAt: z.number().int().optional(),
    }),
    rootSession: BudgetScopeView,
    project: BudgetScopeView,
  })
  export type BudgetView = z.infer<typeof BudgetView>
  export const Route = z.object({
    providerID: z.string(),
    modelID: z.string(),
    variant: z.string().optional(),
  })
  export type Route = z.infer<typeof Route>
  export const ExecutionView = z.object({
    id: z.string(),
    projectID: z.string(),
    rootSessionID: z.string(),
    resumesExecutionID: z.string().optional(),
    budgetScopeID: z.string(),
    rootInvocationID: z.string(),
    userMessageID: z.string(),
    sessionGeneration: z.number().int().positive(),
    turnSequence: z.number().int().positive(),
    version: z.number().int().positive(),
    routeRevision: z.number().int().positive(),
    route: z
      .object({
        active: Route,
        base: Route,
        stage: z.enum(["base", "expert"]),
        activeEpisodeID: z.string().optional(),
        manualModelPin: z.boolean(),
        manualThinkingPin: z.boolean(),
        expert: z
          .object({
            episodes: z.number().int().nonnegative(),
            maxEpisodes: z.number().int().nonnegative(),
            calls: z.number().int().nonnegative(),
            maxCalls: z.number().int().nonnegative(),
            steps: z.number().int().nonnegative(),
            maxSteps: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .optional(),
    lifecycle: Lifecycle,
    phase: Phase,
    outcome: Outcome.nullable(),
    reason: z.object({ code: ReasonCode, message: z.string(), retryable: z.boolean() }).optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    terminalAt: z.number().int().optional(),
    budget: BudgetView,
    blockers: z.object({
      pending: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    recoveryRequired: z.boolean(),
    completion: z
      .object({
        id: z.string(),
        messageID: z.string(),
        digest: z.string(),
        projection: z.enum(["pending", "projected", "recovery_required", "abandoned"]),
      })
      .optional(),
  })
  export type ExecutionView = z.infer<typeof ExecutionView>

  export const RouteProposal = z.object({
    id: z.string(),
    executionID: z.string(),
    invocationID: z.string(),
    stepID: z.string(),
    routeRevision: z.number().int().positive(),
    sessionGeneration: z.number().int().positive(),
    fromRoute: Route,
    toRoute: Route,
    paramsDigest: z.string(),
    scope: z.enum(["thinking", "model", "expert"]),
    reasonCode: z.string(),
    evidenceRefs: z.array(z.string()),
    estimatedUsage: z.record(z.string(), z.unknown()),
    uncertainty: z.boolean(),
    expiresAt: z.number().int(),
    policyVersion: z.number().int().positive(),
    consentVersion: z.number().int().nonnegative(),
    credentialRevision: z.string(),
    state: z.enum(["pending", "accepted", "rejected", "expired", "applied", "superseded"]),
    version: z.number().int().positive(),
    decisionID: z.string().optional(),
    actorID: z.string().optional(),
    acceptScope: z.enum(["episode", "execution"]).optional(),
    createdAt: z.number().int(),
    decidedAt: z.number().int().optional(),
    appliedAt: z.number().int().optional(),
  })
  export type RouteProposal = z.infer<typeof RouteProposal>

  export const InvocationView = z.object({
    id: z.string(),
    executionID: z.string(),
    sessionID: z.string(),
    parentInvocationID: z.string().optional(),
    kind: z.enum(["root", "child", "reviewer", "compaction", "expert", "auxiliary"]),
    state: z.enum(["accepted", "running", "waiting", "draining", "completed", "failed", "cancelled", "unknown"]),
    revision: z.number().int().positive(),
    createdAt: z.number().int(),
  })
  export type InvocationView = z.infer<typeof InvocationView>

  export const PublicBlocker = z.object({
    id: z.string(),
    executionID: z.string(),
    invocationID: z.string(),
    kind: z.enum(["child", "workflow", "plan_item", "verification_job"]),
    resourceScope: z.string(),
    state: z.enum([
      "pending",
      "running",
      "draining",
      "unknown",
      "resumable",
      "resolved",
      "failed",
      "cancelled",
      "waived",
    ]),
    version: z.number().int().positive(),
    planRevision: z.number().int().nonnegative().optional(),
    resolutionCode: z.string().optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  export type PublicBlocker = z.infer<typeof PublicBlocker>

  export const Cursor = z.object({ epoch: z.string(), sequence: z.number().int().nonnegative() })
  export type Cursor = z.infer<typeof Cursor>
  export const ExecutionList = z.object({
    items: ExecutionView.array(),
    nextCursor: z.string().optional(),
    sessionGeneration: z.number().int().positive(),
    activeExecutionID: z.string().optional(),
    sessionVersion: z.number().int().nonnegative(),
  })
  export type ExecutionList = z.infer<typeof ExecutionList>
  export const ExecutionSnapshot = z.object({
    cursor: Cursor,
    sessionGeneration: z.number().int().positive(),
    sessionVersion: z.number().int().nonnegative(),
    activeExecutionID: z.string().optional(),
    activeInvocations: InvocationView.array(),
    executions: ExecutionView.array(),
    pendingProposals: RouteProposal.array(),
    blockers: PublicBlocker.array(),
  })
  export type ExecutionSnapshot = z.infer<typeof ExecutionSnapshot>

  export type Continuation = {
    id: string
    executionID: string
    sessionID: string
    invocationID: string
    kind: "review_retry" | "expert_handoff"
    payload: string
    state: "pending" | "projected"
  }

  export type WorkState = "prepared" | "running" | "draining" | "completed" | "failed" | "cancelled" | "unknown"
  export type InvocationKind = "root" | "child" | "reviewer" | "compaction" | "expert" | "auxiliary"
  export type InvocationState =
    | "accepted"
    | "running"
    | "waiting"
    | "draining"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown"
  export type Invocation = {
    id: string
    executionID: string
    sessionID: string
    parentInvocationID?: string
    kind: InvocationKind
    acceptedMessageID?: string
    state: InvocationState
    revision: number
    cancellationRequestedAt?: number
    createdAt: number
    finishedAt?: number
  }
  export type BlockerKind = "child" | "workflow" | "plan_item" | "verification_job"
  export type BlockerState =
    | "pending"
    | "running"
    | "draining"
    | "unknown"
    | "resumable"
    | "resolved"
    | "failed"
    | "cancelled"
    | "waived"
  export type Blocker = {
    id: string
    executionID: string
    invocationID: string
    parentBlockerID?: string
    kind: BlockerKind
    producerID: string
    resourceScope: string
    state: BlockerState
    version: number
    ownerID: string
    fence: number
    planRevision?: number
    evidence?: string
    resolutionCode?: string
    createdAt: number
    updatedAt: number
    finishedAt?: number
  }
  export type ReviewState = "pending" | "passed" | "rejected" | "inconclusive"
  export type ReviewClaim = {
    id: string
    executionID: string
    digest: string
    revision: number
    ownerID: string
    fence: number
    state: ReviewState
  }
  type RouteProposalRow = {
    id: string
    execution_id: string
    invocation_id: string
    step_id: string
    route_revision: number
    session_generation: number
    from_route: string
    to_route: string
    params_digest: string
    scope: "thinking" | "model" | "expert"
    reason_code: string
    evidence_refs: string
    estimated_usage: string
    uncertainty: number
    expires_at: number
    policy_version: number
    consent_version: number
    credential_revision: string
    state: RouteProposal["state"]
    version: number
    decision_id: string | null
    actor_id: string | null
    accept_scope: "episode" | "execution" | null
    created_at: number
    decided_at: number | null
    applied_at: number | null
  }

  export function open(filepath: string) {
    const db = new Database(filepath, { create: true })
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = FULL")
    db.run("PRAGMA foreign_keys = ON")
    db.run("BEGIN IMMEDIATE")
    try {
      db.run(`
      CREATE TABLE IF NOT EXISTS execution (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        resumes_execution_id TEXT,
        budget_scope_id TEXT NOT NULL DEFAULT '',
        session_generation INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        deadline_at INTEGER,
        max_calls INTEGER,
        max_steps INTEGER,
        max_cost INTEGER,
        project_max_cost INTEGER,
        owner_id TEXT,
        lease_expires_at INTEGER,
        unknown_price_blocked INTEGER NOT NULL DEFAULT 0,
        mutation_revision INTEGER NOT NULL DEFAULT 0,
        plan_revision INTEGER NOT NULL DEFAULT 0,
        route_revision INTEGER NOT NULL DEFAULT 1,
        lifecycle TEXT NOT NULL DEFAULT 'active',
        phase TEXT NOT NULL DEFAULT 'preparing',
        outcome TEXT,
        reason_code TEXT,
        reason_message TEXT,
        reason_retryable INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT 0,
        terminal_at INTEGER,
        deleted_at INTEGER
      )
    `)
      const executionColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(execution)")
          .all()
          .map((column) => column.name),
      )
      if (!executionColumns.has("max_steps")) db.run("ALTER TABLE execution ADD COLUMN max_steps INTEGER")
      if (!executionColumns.has("resumes_execution_id")) {
        db.run("ALTER TABLE execution ADD COLUMN resumes_execution_id TEXT")
      }
      if (!executionColumns.has("budget_scope_id")) {
        db.run("ALTER TABLE execution ADD COLUMN budget_scope_id TEXT NOT NULL DEFAULT ''")
        db.run("UPDATE execution SET budget_scope_id = id WHERE budget_scope_id = ''")
      }
      if (!executionColumns.has("session_generation")) {
        db.run("ALTER TABLE execution ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 1")
      }
      if (!executionColumns.has("owner_id")) db.run("ALTER TABLE execution ADD COLUMN owner_id TEXT")
      if (!executionColumns.has("lease_expires_at")) db.run("ALTER TABLE execution ADD COLUMN lease_expires_at INTEGER")
      if (!executionColumns.has("unknown_price_blocked")) {
        db.run("ALTER TABLE execution ADD COLUMN unknown_price_blocked INTEGER NOT NULL DEFAULT 0")
      }
      if (!executionColumns.has("mutation_revision")) {
        db.run("ALTER TABLE execution ADD COLUMN mutation_revision INTEGER NOT NULL DEFAULT 0")
      }
      if (!executionColumns.has("plan_revision")) {
        db.run("ALTER TABLE execution ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0")
      }
      if (!executionColumns.has("route_revision")) {
        db.run("ALTER TABLE execution ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 1")
      }
      if (!executionColumns.has("lifecycle")) {
        db.run("ALTER TABLE execution ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
      }
      if (!executionColumns.has("phase")) {
        db.run("ALTER TABLE execution ADD COLUMN phase TEXT NOT NULL DEFAULT 'preparing'")
      }
      if (!executionColumns.has("outcome")) db.run("ALTER TABLE execution ADD COLUMN outcome TEXT")
      if (!executionColumns.has("reason_code")) db.run("ALTER TABLE execution ADD COLUMN reason_code TEXT")
      if (!executionColumns.has("reason_message")) db.run("ALTER TABLE execution ADD COLUMN reason_message TEXT")
      if (!executionColumns.has("reason_retryable")) {
        db.run("ALTER TABLE execution ADD COLUMN reason_retryable INTEGER NOT NULL DEFAULT 0")
      }
      if (!executionColumns.has("version")) {
        db.run("ALTER TABLE execution ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
      }
      if (!executionColumns.has("updated_at")) {
        db.run("ALTER TABLE execution ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0")
      }
      if (!executionColumns.has("terminal_at")) db.run("ALTER TABLE execution ADD COLUMN terminal_at INTEGER")
      if (!executionColumns.has("deleted_at")) db.run("ALTER TABLE execution ADD COLUMN deleted_at INTEGER")
      db.run(`
        UPDATE execution SET
          lifecycle = CASE WHEN status IN ('terminal', 'cancelled') THEN 'terminal' ELSE 'active' END,
          phase = CASE WHEN status IN ('terminal', 'cancelled') THEN 'idle'
                       WHEN status = 'finalizing' THEN 'finalizing' ELSE phase END,
          outcome = CASE WHEN outcome IS NOT NULL THEN outcome
                         WHEN status = 'terminal' THEN 'completed'
                         WHEN status = 'cancelled' THEN 'cancelled' ELSE NULL END,
          updated_at = CASE WHEN updated_at = 0 THEN created_at ELSE updated_at END,
          terminal_at = CASE WHEN status IN ('terminal', 'cancelled') AND terminal_at IS NULL
                             THEN created_at ELSE terminal_at END
      `)
      db.run(`
      CREATE TABLE IF NOT EXISTS attempt (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        run_id TEXT NOT NULL,
        fence INTEGER NOT NULL DEFAULT 1,
        purpose TEXT NOT NULL,
        state TEXT NOT NULL,
        estimate INTEGER NOT NULL,
        actual INTEGER,
        price_known INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        dispatched_at INTEGER,
        settled_at INTEGER
      )
    `)
      const attemptColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(attempt)")
          .all()
          .map((column) => column.name),
      )
      if (!attemptColumns.has("fence")) db.run("ALTER TABLE attempt ADD COLUMN fence INTEGER NOT NULL DEFAULT 1")
      if (!attemptColumns.has("session_id")) db.run("ALTER TABLE attempt ADD COLUMN session_id TEXT")
      if (!attemptColumns.has("review_id")) db.run("ALTER TABLE attempt ADD COLUMN review_id TEXT")
      if (!attemptColumns.has("invocation_id")) db.run("ALTER TABLE attempt ADD COLUMN invocation_id TEXT")
      if (!attemptColumns.has("price_known")) {
        db.run("ALTER TABLE attempt ADD COLUMN price_known INTEGER NOT NULL DEFAULT 1")
      }
      db.run(`
      CREATE TABLE IF NOT EXISTS scope_total (
        scope_id TEXT PRIMARY KEY,
        calls INTEGER NOT NULL DEFAULT 0,
        pending_calls INTEGER NOT NULL DEFAULT 0,
        steps INTEGER NOT NULL DEFAULT 0,
        spent INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        uncertain INTEGER NOT NULL DEFAULT 0
      )
    `)
      const totalColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(scope_total)")
          .all()
          .map((column) => column.name),
      )
      if (!totalColumns.has("steps")) db.run("ALTER TABLE scope_total ADD COLUMN steps INTEGER NOT NULL DEFAULT 0")
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_step (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        created_at INTEGER NOT NULL
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS scope_policy (
        scope_id TEXT PRIMARY KEY,
        max_cost INTEGER
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_binding (
        invocation_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_invocation (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        session_id TEXT NOT NULL,
        parent_invocation_id TEXT,
        kind TEXT NOT NULL,
        accepted_message_id TEXT,
        state TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        cancellation_requested_at INTEGER,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `)
      db.run(`
        INSERT OR IGNORE INTO execution_invocation
          (id, execution_id, session_id, kind, state, owner_id, fence, created_at, finished_at)
        SELECT b.invocation_id, b.execution_id, b.session_id, 'auxiliary',
          CASE
            WHEN b.rowid = (SELECT MAX(latest.rowid) FROM execution_binding latest WHERE latest.session_id = b.session_id)
              AND e.status IN ('active', 'finalizing') THEN 'running'
            ELSE 'completed'
          END,
          b.owner_id, b.fence, b.created_at,
          CASE
            WHEN b.rowid = (SELECT MAX(latest.rowid) FROM execution_binding latest WHERE latest.session_id = b.session_id)
              AND e.status IN ('active', 'finalizing') THEN NULL
            ELSE b.created_at
          END
        FROM execution_binding b JOIN execution e ON e.id = b.execution_id
      `)
      db.run(
        "CREATE INDEX IF NOT EXISTS execution_invocation_execution_state ON execution_invocation(execution_id, state)",
      )
      db.run("CREATE INDEX IF NOT EXISTS execution_invocation_session_state ON execution_invocation(session_id, state)")
      db.run(`
      CREATE TABLE IF NOT EXISTS session_execution (
        session_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
      const sessionExecutionColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(session_execution)")
          .all()
          .map((column) => column.name),
      )
      if (!sessionExecutionColumns.has("parent_invocation_id")) {
        db.run("ALTER TABLE session_execution ADD COLUMN parent_invocation_id TEXT")
      }
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_completion (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        parent_user_id TEXT,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        finish TEXT NOT NULL,
        payload TEXT NOT NULL,
        review_files TEXT NOT NULL DEFAULT '[]',
        digest TEXT NOT NULL,
        requires_review INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        plan_revision INTEGER NOT NULL DEFAULT 0,
        route_revision INTEGER NOT NULL DEFAULT 1,
        policy_version INTEGER NOT NULL DEFAULT 1,
        policy_digest TEXT NOT NULL DEFAULT '',
        review_requirement TEXT NOT NULL DEFAULT 'not_required',
        review_reason_code TEXT NOT NULL DEFAULT 'legacy',
        required_reviewers INTEGER NOT NULL DEFAULT 0,
        attempt_limit INTEGER NOT NULL DEFAULT 0,
        content_snapshot_digest TEXT NOT NULL DEFAULT '',
        delivery_payload TEXT,
        delivery_finish TEXT,
        terminal_outcome TEXT,
        reason_code TEXT,
        projection_state TEXT NOT NULL DEFAULT 'pending',
        projection_owner TEXT,
        projection_token TEXT,
        projection_lease_expires_at INTEGER,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        committed_at INTEGER
      )
    `)
      const completionColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(execution_completion)")
          .all()
          .map((column) => column.name),
      )
      if (!completionColumns.has("review_files")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN review_files TEXT NOT NULL DEFAULT '[]'")
      }
      if (!completionColumns.has("parent_user_id")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN parent_user_id TEXT")
      }
      if (!completionColumns.has("revision")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
      }
      if (!completionColumns.has("plan_revision")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0")
      }
      if (!completionColumns.has("route_revision")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 1")
      }
      if (!completionColumns.has("policy_version")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1")
      }
      if (!completionColumns.has("policy_digest")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN policy_digest TEXT NOT NULL DEFAULT ''")
      }
      if (!completionColumns.has("review_requirement")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN review_requirement TEXT NOT NULL DEFAULT 'not_required'")
      }
      if (!completionColumns.has("review_reason_code")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN review_reason_code TEXT NOT NULL DEFAULT 'legacy'")
      }
      if (!completionColumns.has("required_reviewers")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN required_reviewers INTEGER NOT NULL DEFAULT 0")
      }
      if (!completionColumns.has("attempt_limit")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN attempt_limit INTEGER NOT NULL DEFAULT 0")
      }
      if (!completionColumns.has("content_snapshot_digest")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN content_snapshot_digest TEXT NOT NULL DEFAULT ''")
      }
      if (!completionColumns.has("delivery_payload")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN delivery_payload TEXT")
      }
      if (!completionColumns.has("delivery_finish")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN delivery_finish TEXT")
      }
      if (!completionColumns.has("terminal_outcome")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN terminal_outcome TEXT")
      }
      if (!completionColumns.has("reason_code")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN reason_code TEXT")
      }
      if (!completionColumns.has("projected_at")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN projected_at INTEGER")
      }
      if (!completionColumns.has("projection_state")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN projection_state TEXT NOT NULL DEFAULT 'pending'")
        db.run(
          `UPDATE execution_completion SET projection_state = CASE
             WHEN projected_at = -1 THEN 'abandoned'
             WHEN projected_at IS NOT NULL THEN 'projected'
             ELSE 'pending' END`,
        )
      }
      db.run(
        "UPDATE execution_completion SET terminal_outcome = 'completed' WHERE state = 'committed' AND terminal_outcome IS NULL",
      )
      if (!completionColumns.has("projection_owner")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN projection_owner TEXT")
      }
      if (!completionColumns.has("projection_token")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN projection_token TEXT")
      }
      if (!completionColumns.has("projection_lease_expires_at")) {
        db.run("ALTER TABLE execution_completion ADD COLUMN projection_lease_expires_at INTEGER")
      }
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_continuation (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        session_id TEXT NOT NULL,
        invocation_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        projected_at INTEGER
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_work (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        mutating INTEGER NOT NULL,
        state TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )
    `)
      const workColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(execution_work)")
          .all()
          .map((column) => column.name),
      )
      if (!workColumns.has("version"))
        db.run("ALTER TABLE execution_work ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
      if (!workColumns.has("began_at")) db.run("ALTER TABLE execution_work ADD COLUMN began_at INTEGER")
      if (!workColumns.has("evidence")) db.run("ALTER TABLE execution_work ADD COLUMN evidence TEXT")
      if (!workColumns.has("resolution_code")) db.run("ALTER TABLE execution_work ADD COLUMN resolution_code TEXT")
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_blocker (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        parent_blocker_id TEXT,
        kind TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        resource_scope TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        plan_revision INTEGER,
        evidence TEXT,
        resolution_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        UNIQUE(execution_id, kind, producer_id)
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_review (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        id TEXT NOT NULL UNIQUE,
        digest TEXT NOT NULL,
        revision INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_review_session (
        session_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        review_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
      db.query("INSERT OR IGNORE INTO execution_meta (key, value) VALUES ('event_epoch', ?)").run(crypto.randomUUID())
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_event (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        epoch TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL,
        execution_id TEXT,
        resource_version INTEGER NOT NULL,
        type TEXT NOT NULL,
        properties TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_request (
        request_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        kind TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        resulting_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS route_proposal (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        invocation_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        route_revision INTEGER NOT NULL,
        session_generation INTEGER NOT NULL,
        from_route TEXT NOT NULL,
        to_route TEXT NOT NULL,
        params_digest TEXT NOT NULL,
        scope TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        evidence_refs TEXT NOT NULL,
        estimated_usage TEXT NOT NULL,
        uncertainty INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        consent_version INTEGER NOT NULL,
        credential_revision TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        decision_id TEXT,
        actor_id TEXT,
        accept_scope TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        applied_at INTEGER
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_route (
        execution_id TEXT PRIMARY KEY REFERENCES execution(id),
        route_revision INTEGER NOT NULL,
        current_route TEXT NOT NULL,
        base_route TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'base',
        active_episode_id TEXT,
        manual_model_pin INTEGER NOT NULL DEFAULT 0,
        manual_thinking_pin INTEGER NOT NULL DEFAULT 0,
        expert_start_calls INTEGER,
        expert_start_steps INTEGER,
        max_expert_episodes INTEGER,
        max_expert_calls INTEGER,
        max_expert_steps INTEGER
      )
    `)
      const routeColumns = new Set(
        db
          .query<{ name: string }, []>("PRAGMA table_info(execution_route)")
          .all()
          .map((column) => column.name),
      )
      for (const column of [
        "expert_start_calls",
        "expert_start_steps",
        "max_expert_episodes",
        "max_expert_calls",
        "max_expert_steps",
      ]) {
        if (!routeColumns.has(column)) db.run(`ALTER TABLE execution_route ADD COLUMN ${column} INTEGER`)
      }
      db.run(`
      CREATE TABLE IF NOT EXISTS route_grant (
        execution_id TEXT NOT NULL REFERENCES execution(id),
        target_route TEXT NOT NULL,
        params_digest TEXT NOT NULL,
        scope TEXT NOT NULL,
        policy_version INTEGER NOT NULL,
        credential_revision TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, target_route, params_digest, scope)
      )
    `)
      db.run(`
      CREATE TABLE IF NOT EXISTS execution_budget_warning (
        scope_id TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        policy_version INTEGER NOT NULL,
        execution_id TEXT NOT NULL REFERENCES execution(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope_id, threshold, policy_version)
      )
    `)
      db.query("INSERT OR IGNORE INTO execution_meta (key, value) VALUES ('event_retention_floor', '0')").run()
      db.run("CREATE INDEX IF NOT EXISTS execution_event_session_sequence ON execution_event(session_id, sequence)")
      db.run("CREATE INDEX IF NOT EXISTS execution_request_execution ON execution_request(execution_id, created_at)")
      db.run(
        "CREATE INDEX IF NOT EXISTS route_proposal_execution_state ON route_proposal(execution_id, state, created_at)",
      )
      db.run(
        "CREATE INDEX IF NOT EXISTS execution_continuation_session_state ON execution_continuation(session_id, state, created_at)",
      )
      db.run("CREATE INDEX IF NOT EXISTS execution_work_execution_state ON execution_work(execution_id, state)")
      db.run("CREATE INDEX IF NOT EXISTS execution_blocker_execution_state ON execution_blocker(execution_id, state)")

      const schemaVersion = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
      if (schemaVersion < 1) {
        db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'execution:' || e.id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0),
            (SELECT COUNT(*) FROM execution_step s WHERE s.execution_id = e.id),
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
        db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'root-session:' || e.root_session_id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0), 0,
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.root_session_id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
        db.run(`
          INSERT INTO scope_total (scope_id, calls, pending_calls, steps, spent, reserved, uncertain)
          SELECT 'project:' || e.project_id,
            COALESCE(SUM(CASE WHEN a.state IN ('dispatched', 'settled', 'uncertain') THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'reserved' THEN 1 ELSE 0 END), 0), 0,
            COALESCE(SUM(CASE WHEN a.state = 'settled' THEN a.actual ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state IN ('reserved', 'dispatched') THEN a.estimate ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN a.state = 'uncertain' THEN a.estimate ELSE 0 END), 0)
          FROM execution e LEFT JOIN attempt a ON a.execution_id = e.id GROUP BY e.project_id
          ON CONFLICT(scope_id) DO UPDATE SET
            calls = excluded.calls, pending_calls = excluded.pending_calls, steps = excluded.steps,
            spent = excluded.spent, reserved = excluded.reserved, uncertain = excluded.uncertain
        `)
        db.run("PRAGMA user_version = 1")
      }
      db.run("COMMIT")
    } catch (error) {
      try {
        db.run("ROLLBACK")
      } catch {}
      db.close()
      throw error
    }

    function transaction<T>(fn: () => T): T {
      db.run("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.run("COMMIT")
        return result
      } catch (error) {
        db.run("ROLLBACK")
        throw error
      }
    }

    function total(scopeID: string): TotalRow {
      return db
        .query<
          TotalRow,
          [string]
        >("SELECT calls, pending_calls, steps, spent, reserved, uncertain FROM scope_total WHERE scope_id = ?")
        .get(scopeID)!
    }

    function changeTotal(scopeID: string, values: Partial<TotalRow>) {
      const keys = Object.keys(values) as Array<keyof TotalRow>
      if (!keys.length) return
      db.query(`UPDATE scope_total SET ${keys.map((key) => `${key} = ${key} + ?`).join(", ")} WHERE scope_id = ?`).run(
        ...keys.map((key) => values[key]!),
        scopeID,
      )
    }

    function expertLimitReached(current: ExecutionRow, dimension: "calls" | "steps", increment: number) {
      const row = db
        .query<
          {
            stage: string
            expert_start_calls: number | null
            expert_start_steps: number | null
            max_expert_calls: number | null
            max_expert_steps: number | null
          },
          [string]
        >(
          `SELECT stage, expert_start_calls, expert_start_steps, max_expert_calls, max_expert_steps
           FROM execution_route WHERE execution_id = ?`,
        )
        .get(current.id)
      if (!row || row.stage !== "expert") return false
      const start = dimension === "calls" ? row.expert_start_calls : row.expert_start_steps
      const limit = dimension === "calls" ? row.max_expert_calls : row.max_expert_steps
      if (start === null || limit === null) return true
      return total(executionBudgetScope(current))[dimension] - start + increment > limit
    }

    function execution(executionID: string) {
      return db
        .query<ExecutionRow, [string]>(
          `SELECT id, project_id, root_session_id, resumes_execution_id, budget_scope_id,
            session_generation, created_at, status, fence, deadline_at,
            max_calls, max_steps, max_cost, owner_id, lease_expires_at, unknown_price_blocked, mutation_revision,
            plan_revision, route_revision, lifecycle, phase, outcome, reason_code, reason_message, reason_retryable,
            version, updated_at, terminal_at, deleted_at
           FROM execution WHERE id = ?`,
        )
        .get(executionID)
    }

    function executionState(executionID: string): ExecutionState | undefined {
      const current = execution(executionID)
      if (!current) return
      return {
        id: current.id,
        lifecycle: Lifecycle.parse(current.lifecycle),
        phase: Phase.parse(current.phase),
        outcome: current.outcome === null ? null : Outcome.parse(current.outcome),
        reason:
          current.reason_code && current.reason_message
            ? {
                code: current.reason_code,
                message: current.reason_message,
                retryable: current.reason_retryable === 1,
              }
            : undefined,
        version: current.version,
        updatedAt: current.updated_at,
        terminalAt: current.terminal_at ?? undefined,
      }
    }

    function unpricedCalls(where: string, value: string) {
      return (
        db
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) AS count FROM attempt candidate
             JOIN execution owner ON owner.id = candidate.execution_id
             WHERE ${where} = ? AND candidate.price_known = 0 AND candidate.state != 'released'`,
          )
          .get(value)?.count ?? 0
      )
    }

    function budgetScope(totalRow: TotalRow, limitMicrousd: number | undefined, unpriced: number) {
      return {
        limitMicrousd,
        spentMicrousd: totalRow.spent,
        reservedMicrousd: totalRow.reserved,
        uncertainMicrousd: totalRow.uncertain,
        unpricedCalls: unpriced,
      }
    }

    function executionView(executionID: string): ExecutionView | undefined {
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
            calls: { used: executionTotal.calls, limit: current.max_calls ?? undefined },
            steps: { used: executionTotal.steps, limit: current.max_steps ?? undefined },
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

    type ListCursor = {
      version: 1
      sessionID: string
      epoch: string
      sequence: number
      createdAt: number
      executionID: string
    }

    function encodeListCursor(cursor: ListCursor) {
      return Buffer.from(JSON.stringify(cursor)).toString("base64url")
    }

    function decodeListCursor(value: string | undefined, sessionID: string): ListCursor | undefined {
      if (!value) return
      try {
        const parsed = z
          .object({
            version: z.literal(1),
            sessionID: z.string(),
            epoch: z.string(),
            sequence: z.number().int().nonnegative(),
            createdAt: z.number().int(),
            executionID: z.string(),
          })
          .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
        if (parsed.sessionID !== sessionID || parsed.epoch !== eventEpoch()) throw new Error("cursor scope changed")
        return parsed
      } catch {
        throw new Error("Invalid or expired execution cursor")
      }
    }

    function currentEventSequence() {
      return db
        .query<{ sequence: number }, []>("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM execution_event")
        .get()!.sequence
    }

    function eventRetentionFloor() {
      return Number(
        db.query<{ value: string }, []>("SELECT value FROM execution_meta WHERE key = 'event_retention_floor'").get()
          ?.value ?? 0,
      )
    }

    function sessionGeneration(sessionID: string) {
      return (
        db
          .query<
            { generation: number },
            [string]
          >("SELECT COALESCE(MAX(session_generation), 1) AS generation FROM execution WHERE root_session_id = ?")
          .get(sessionID)?.generation ?? 1
      )
    }

    function activeExecutionID(sessionID: string) {
      return db
        .query<{ id: string }, [string]>(
          `SELECT current.id FROM session_execution binding
           JOIN execution current ON current.id = binding.execution_id
           WHERE binding.session_id = ? AND current.lifecycle != 'terminal' AND current.outcome IS NULL
           ORDER BY binding.updated_at DESC LIMIT 1`,
        )
        .get(sessionID)?.id
    }

    function invocationView(row: {
      id: string
      execution_id: string
      session_id: string
      parent_invocation_id: string | null
      kind: InvocationKind
      state: InvocationState
      revision: number
      created_at: number
    }) {
      return InvocationView.parse({
        id: row.id,
        executionID: row.execution_id,
        sessionID: row.session_id,
        parentInvocationID: row.parent_invocation_id ?? undefined,
        kind: row.kind,
        state: row.state,
        revision: row.revision,
        createdAt: row.created_at,
      })
    }

    function publicBlocker(value: Blocker) {
      return PublicBlocker.parse({
        id: value.id,
        executionID: value.executionID,
        invocationID: value.invocationID,
        kind: value.kind,
        resourceScope: value.resourceScope,
        state: value.state,
        version: value.version,
        planRevision: value.planRevision,
        resolutionCode: value.resolutionCode,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      })
    }

    function routeProposal(id: string): RouteProposal | undefined {
      const row = db.query<RouteProposalRow, [string]>("SELECT * FROM route_proposal WHERE id = ?").get(id)
      if (!row) return
      return RouteProposal.parse({
        id: row.id,
        executionID: row.execution_id,
        invocationID: row.invocation_id,
        stepID: row.step_id,
        routeRevision: row.route_revision,
        sessionGeneration: row.session_generation,
        fromRoute: JSON.parse(row.from_route),
        toRoute: JSON.parse(row.to_route),
        paramsDigest: row.params_digest,
        scope: row.scope,
        reasonCode: row.reason_code,
        evidenceRefs: JSON.parse(row.evidence_refs),
        estimatedUsage: JSON.parse(row.estimated_usage),
        uncertainty: row.uncertainty === 1,
        expiresAt: row.expires_at,
        policyVersion: row.policy_version,
        consentVersion: row.consent_version,
        credentialRevision: row.credential_revision,
        state: row.state,
        version: row.version,
        decisionID: row.decision_id ?? undefined,
        actorID: row.actor_id ?? undefined,
        acceptScope: row.accept_scope ?? undefined,
        createdAt: row.created_at,
        decidedAt: row.decided_at ?? undefined,
        appliedAt: row.applied_at ?? undefined,
      })
    }

    function executionRoute(executionID: string) {
      const row = db
        .query<
          {
            route_revision: number
            current_route: string
            base_route: string
            stage: "base" | "expert"
            active_episode_id: string | null
            manual_model_pin: number
            manual_thinking_pin: number
            expert_start_calls: number | null
            expert_start_steps: number | null
            max_expert_episodes: number | null
            max_expert_calls: number | null
            max_expert_steps: number | null
          },
          [string]
        >("SELECT * FROM execution_route WHERE execution_id = ?")
        .get(executionID)
      if (!row) return
      const current = execution(executionID)!
      const usage = total(executionBudgetScope(current))
      const episodes = db
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) AS count FROM route_proposal proposal
           JOIN execution candidate ON candidate.id = proposal.execution_id
           WHERE candidate.budget_scope_id = ? AND proposal.scope = 'expert' AND proposal.state = 'applied'`,
        )
        .get(current.budget_scope_id)!.count
      return {
        active: Route.parse(JSON.parse(row.current_route)),
        base: Route.parse(JSON.parse(row.base_route)),
        stage: row.stage,
        activeEpisodeID: row.active_episode_id ?? undefined,
        manualModelPin: row.manual_model_pin === 1,
        manualThinkingPin: row.manual_thinking_pin === 1,
        expert:
          row.max_expert_episodes !== null &&
          row.max_expert_calls !== null &&
          row.max_expert_steps !== null &&
          row.expert_start_calls !== null &&
          row.expert_start_steps !== null
            ? {
                episodes,
                maxEpisodes: row.max_expert_episodes,
                calls: Math.max(0, usage.calls - row.expert_start_calls),
                maxCalls: row.max_expert_calls,
                steps: Math.max(0, usage.steps - row.expert_start_steps),
                maxSteps: row.max_expert_steps,
              }
            : undefined,
      }
    }

    function pendingRouteProposals(executionIDs: string[]) {
      if (!executionIDs.length) return []
      const placeholders = executionIDs.map(() => "?").join(",")
      return db
        .query<RouteProposalRow, string[]>(
          `SELECT * FROM route_proposal WHERE execution_id IN (${placeholders})
             AND state IN ('pending', 'accepted') ORDER BY created_at, id`,
        )
        .all(...executionIDs)
        .map((row) => routeProposal(row.id)!)
    }

    function expireRouteProposals(executionIDs: string[], now: number) {
      if (!executionIDs.length) return
      const placeholders = executionIDs.map(() => "?").join(",")
      const expired = db
        .query<{ id: string; execution_id: string }, [...string[], number]>(
          `SELECT id, execution_id FROM route_proposal WHERE execution_id IN (${placeholders})
             AND state IN ('pending', 'accepted') AND expires_at <= ?`,
        )
        .all(...executionIDs, now)
      for (const proposal of expired) {
        db.query(
          "UPDATE route_proposal SET state = 'expired', version = version + 1, decided_at = COALESCE(decided_at, ?) WHERE id = ?",
        ).run(now, proposal.id)
        db.query("UPDATE execution SET phase = 'model' WHERE id = ? AND phase = 'awaiting_route_approval'").run(
          proposal.execution_id,
        )
        touchExecution(proposal.execution_id, now, "route.proposal.updated", {
          proposalID: proposal.id,
          state: "expired",
        })
      }
    }

    function eventEpoch() {
      return db.query<{ value: string }, []>("SELECT value FROM execution_meta WHERE key = 'event_epoch'").get()!.value
    }

    function appendExecutionEvent(
      executionID: string,
      type: EventType,
      now: number,
      properties: Record<string, unknown> = {},
    ) {
      const current = execution(executionID)
      if (!current) throw new Error(`Execution not found while appending event: ${executionID}`)
      const state = executionState(executionID)!
      const epoch = eventEpoch()
      const eventID = `${epoch}:${executionID}:${state.version}:${type}`
      db.query(
        `INSERT OR IGNORE INTO execution_event
          (event_id, epoch, project_id, session_id, session_generation, execution_id,
           resource_version, type, properties, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        eventID,
        epoch,
        current.project_id,
        current.root_session_id,
        current.session_generation,
        executionID,
        state.version,
        type,
        JSON.stringify({ execution: state, ...properties }),
        now,
      )
      const countFloor = currentEventSequence() - MAX_RETAINED_EVENTS
      const expired = db
        .query<{ sequence: number }, [number, number]>(
          `SELECT COALESCE(MAX(sequence), 0) AS sequence FROM execution_event
           WHERE created_at < ? OR sequence <= ?`,
        )
        .get(now - EVENT_RETENTION_MS, countFloor)?.sequence
      if (expired && expired > eventRetentionFloor()) {
        db.query("DELETE FROM execution_event WHERE sequence <= ?").run(expired)
        db.query("UPDATE execution_meta SET value = ? WHERE key = 'event_retention_floor'").run(String(expired))
      }
    }

    function touchExecution(
      executionID: string,
      now: number,
      type: EventType = "execution.updated",
      properties: Record<string, unknown> = {},
    ) {
      db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, executionID)
      appendExecutionEvent(executionID, type, now, properties)
    }

    function emitBudgetWarnings(current: ExecutionRow, now: number) {
      const scopes = [
        { id: executionBudgetScope(current), kind: "execution", limit: current.max_cost ?? undefined },
        {
          id: `root-session:${current.root_session_id}`,
          kind: "rootSession",
          limit: scopeMaxCost(`root-session:${current.root_session_id}`),
        },
        {
          id: `project:${current.project_id}`,
          kind: "project",
          limit: scopeMaxCost(`project:${current.project_id}`),
        },
      ]
      for (const scope of scopes) {
        if (scope.limit === undefined) continue
        const totals = total(scope.id)
        const observed = totals.spent + totals.reserved + totals.uncertain
        if (observed <= 0) continue
        for (const threshold of [80, 100]) {
          if (observed < Math.ceil((scope.limit * threshold) / 100)) continue
          const inserted = db
            .query(
              `INSERT OR IGNORE INTO execution_budget_warning
                (scope_id, threshold, policy_version, execution_id, created_at)
               VALUES (?, ?, 1, ?, ?)`,
            )
            .run(scope.id, threshold, current.id, now)
          if (inserted.changes !== 1) continue
          touchExecution(current.id, now, "execution.budget.warning", {
            budget: {
              scope: scope.kind,
              threshold,
              limitMicrousd: scope.limit,
              observedMicrousd: observed,
              policyVersion: 1,
            },
          })
        }
      }
    }

    function ownershipValid(current: ExecutionRow, ownerID: string | undefined, fence: number, now: number) {
      if (current.fence !== fence) return false
      if (current.owner_id === null) return true
      return current.owner_id === ownerID && current.lease_expires_at !== null && now < current.lease_expires_at
    }

    function scopeIDs(current: ExecutionRow) {
      return [executionBudgetScope(current), `root-session:${current.root_session_id}`, `project:${current.project_id}`]
    }

    function executionBudgetScope(current: ExecutionRow) {
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

    function completion(executionID: string): Completion | undefined {
      const row = db
        .query<
          {
            execution_id: string
            session_id: string
            message_id: string
            parent_user_id: string | null
            owner_id: string
            fence: number
            finish: string
            payload: string
            review_files: string
            digest: string
            requires_review: number
            revision: number
            plan_revision: number
            route_revision: number
            policy_version: number
            policy_digest: string
            review_requirement: Completion["reviewRequirement"]
            review_reason_code: string
            required_reviewers: number
            attempt_limit: number
            content_snapshot_digest: string
            delivery_payload: string | null
            delivery_finish: string | null
            terminal_outcome: Completion["outcome"] | null
            reason_code: string | null
            projection_state: Completion["projection"]
            state: Completion["state"]
          },
          [string]
        >(
          `SELECT execution_id, session_id, message_id, parent_user_id, owner_id, fence, finish, payload, review_files, digest,
            requires_review, revision, plan_revision, route_revision, policy_version, policy_digest, review_requirement,
            review_reason_code, required_reviewers, attempt_limit, content_snapshot_digest,
            delivery_payload, delivery_finish, terminal_outcome, reason_code, projection_state, state
           FROM execution_completion WHERE execution_id = ?`,
        )
        .get(executionID)
      if (!row) return
      return {
        executionID: row.execution_id,
        sessionID: row.session_id,
        messageID: row.message_id,
        parentUserID: row.parent_user_id ?? undefined,
        ownerID: row.owner_id,
        fence: row.fence,
        finish: row.finish,
        payload: row.payload,
        reviewFiles: row.review_files,
        digest: row.digest,
        requiresReview: row.requires_review === 1,
        revision: row.revision,
        planRevision: row.plan_revision,
        routeRevision: row.route_revision,
        policyVersion: row.policy_version,
        policyDigest: row.policy_digest,
        reviewRequirement: row.review_requirement,
        reviewReasonCode: row.review_reason_code,
        requiredReviewers: row.required_reviewers,
        attemptLimit: row.attempt_limit,
        contentSnapshotDigest: row.content_snapshot_digest,
        deliveryPayload: row.delivery_payload ?? undefined,
        deliveryFinish: row.delivery_finish ?? undefined,
        outcome: row.terminal_outcome ?? undefined,
        reasonCode: row.reason_code ?? undefined,
        projection: row.projection_state,
        state: row.state,
      }
    }

    function cancellationOutbox(current: ExecutionRow, now: number) {
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

    function reviewClaim(executionID: string): ReviewClaim | undefined {
      const row = db
        .query<
          {
            id: string
            execution_id: string
            digest: string
            revision: number
            owner_id: string
            fence: number
            state: ReviewState
          },
          [string]
        >(
          "SELECT id, execution_id, digest, revision, owner_id, fence, state FROM execution_review WHERE execution_id = ?",
        )
        .get(executionID)
      if (!row) return
      return {
        id: row.id,
        executionID: row.execution_id,
        digest: row.digest,
        revision: row.revision,
        ownerID: row.owner_id,
        fence: row.fence,
        state: row.state,
      }
    }

    function attemptReviewAuthorized(attemptID: string) {
      return !!db
        .query<{ authorized: number }, [string]>(
          `SELECT 1 AS authorized
           FROM attempt a
           JOIN execution_binding b
             ON b.execution_id = a.execution_id AND b.invocation_id = a.invocation_id
           JOIN execution_invocation i
             ON i.execution_id = b.execution_id AND i.id = b.invocation_id AND i.kind = 'reviewer'
           JOIN execution_review_session s
             ON s.execution_id = b.execution_id AND s.session_id = b.session_id AND s.review_id = a.review_id
           JOIN execution_review r ON r.execution_id = s.execution_id AND r.id = s.review_id
           WHERE a.id = ? AND r.state = 'pending'`,
        )
        .get(attemptID)
    }

    function invocationReviewAuthorized(executionID: string, invocationID: string) {
      return !!db
        .query<{ authorized: number }, [string, string]>(
          `SELECT 1 AS authorized
           FROM execution_binding b
           JOIN execution_invocation i
             ON i.execution_id = b.execution_id AND i.id = b.invocation_id AND i.kind = 'reviewer'
           JOIN execution_review_session s
             ON s.execution_id = b.execution_id AND s.session_id = b.session_id
           JOIN execution_review r ON r.execution_id = s.execution_id AND r.id = s.review_id
           WHERE b.execution_id = ? AND b.invocation_id = ? AND r.state = 'pending'`,
        )
        .get(executionID, invocationID)
    }

    function invocation(invocationID: string): Invocation | undefined {
      const row = db
        .query<
          {
            id: string
            execution_id: string
            session_id: string
            parent_invocation_id: string | null
            kind: InvocationKind
            accepted_message_id: string | null
            state: InvocationState
            revision: number
            cancellation_requested_at: number | null
            created_at: number
            finished_at: number | null
          },
          [string]
        >(
          `SELECT id, execution_id, session_id, parent_invocation_id, kind, accepted_message_id,
            state, revision, cancellation_requested_at, created_at, finished_at
           FROM execution_invocation WHERE id = ?`,
        )
        .get(invocationID)
      if (!row) return
      return {
        id: row.id,
        executionID: row.execution_id,
        sessionID: row.session_id,
        parentInvocationID: row.parent_invocation_id ?? undefined,
        kind: row.kind,
        acceptedMessageID: row.accepted_message_id ?? undefined,
        state: row.state,
        revision: row.revision,
        cancellationRequestedAt: row.cancellation_requested_at ?? undefined,
        createdAt: row.created_at,
        finishedAt: row.finished_at ?? undefined,
      }
    }

    function blocker(blockerID: string): Blocker | undefined {
      const row = db
        .query<
          {
            id: string
            execution_id: string
            invocation_id: string
            parent_blocker_id: string | null
            kind: BlockerKind
            producer_id: string
            resource_scope: string
            state: BlockerState
            version: number
            owner_id: string
            fence: number
            plan_revision: number | null
            evidence: string | null
            resolution_code: string | null
            created_at: number
            updated_at: number
            finished_at: number | null
          },
          [string]
        >(
          `SELECT id, execution_id, invocation_id, parent_blocker_id, kind, producer_id, resource_scope,
            state, version, owner_id, fence, plan_revision, evidence, resolution_code,
            created_at, updated_at, finished_at
           FROM execution_blocker WHERE id = ?`,
        )
        .get(blockerID)
      if (!row) return
      return {
        id: row.id,
        executionID: row.execution_id,
        invocationID: row.invocation_id,
        parentBlockerID: row.parent_blocker_id ?? undefined,
        kind: row.kind,
        producerID: row.producer_id,
        resourceScope: row.resource_scope,
        state: row.state,
        version: row.version,
        ownerID: row.owner_id,
        fence: row.fence,
        planRevision: row.plan_revision ?? undefined,
        evidence: row.evidence ?? undefined,
        resolutionCode: row.resolution_code ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finishedAt: row.finished_at ?? undefined,
      }
    }

    function blockerTransitionAllowed(from: BlockerState, to: BlockerState) {
      const transitions: Record<BlockerState, BlockerState[]> = {
        pending: ["running", "cancelled", "waived"],
        running: ["draining", "unknown", "resolved", "failed", "cancelled", "waived"],
        draining: ["unknown", "resolved", "failed", "cancelled"],
        unknown: ["resolved", "failed", "cancelled", "waived"],
        resumable: ["running", "cancelled", "waived"],
        resolved: [],
        failed: ["resolved", "waived"],
        cancelled: ["resolved", "waived"],
        waived: [],
      }
      return transitions[from].includes(to)
    }

    return {
      execution(executionID: string) {
        return executionState(executionID)
      },

      view(executionID: string) {
        return executionView(executionID)
      },

      list(input: { sessionID: string; cursor?: string; limit?: number }): ExecutionList {
        return transaction(() => {
          const limit = Math.min(100, Math.max(1, input.limit ?? 20))
          const cursor = decodeListCursor(input.cursor, input.sessionID)
          const sequence = cursor?.sequence ?? currentEventSequence()
          const rows = cursor
            ? db
                .query<{ id: string; created_at: number }, [string, number, number, string, number]>(
                  `SELECT id, created_at FROM execution
                   WHERE root_session_id = ? AND deleted_at IS NULL
                     AND (created_at < ? OR (created_at = ? AND id < ?))
                   ORDER BY created_at DESC, id DESC LIMIT ?`,
                )
                .all(input.sessionID, cursor.createdAt, cursor.createdAt, cursor.executionID, limit + 1)
            : db
                .query<{ id: string; created_at: number }, [string, number]>(
                  `SELECT id, created_at FROM execution
                   WHERE root_session_id = ? AND deleted_at IS NULL
                   ORDER BY created_at DESC, id DESC LIMIT ?`,
                )
                .all(input.sessionID, limit + 1)
          const page = rows.slice(0, limit)
          const last = page.at(-1)
          return ExecutionList.parse({
            items: page.map((row) => executionView(row.id)!),
            nextCursor:
              rows.length > limit && last
                ? encodeListCursor({
                    version: 1,
                    sessionID: input.sessionID,
                    epoch: eventEpoch(),
                    sequence,
                    createdAt: last.created_at,
                    executionID: last.id,
                  })
                : undefined,
            sessionGeneration: sessionGeneration(input.sessionID),
            activeExecutionID: activeExecutionID(input.sessionID),
            sessionVersion: db
              .query<
                { version: number },
                [string]
              >("SELECT COALESCE(MAX(sequence), 0) AS version FROM execution_event WHERE session_id = ?")
              .get(input.sessionID)!.version,
          })
        })
      },

      snapshot(sessionID: string, now = Date.now()): ExecutionSnapshot {
        return transaction(() => {
          const activeRows = db
            .query<{ id: string }, [string, number]>(
              `SELECT id FROM execution WHERE root_session_id = ? AND deleted_at IS NULL
                 AND lifecycle != 'terminal' AND outcome IS NULL
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .all(sessionID, MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT + 1)
          if (activeRows.length > MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT) {
            throw new Error("Execution snapshot exceeds the supported active execution limit")
          }
          const terminalRows = db
            .query<{ id: string }, [string, number]>(
              `SELECT id FROM execution WHERE root_session_id = ? AND deleted_at IS NULL
                 AND (lifecycle = 'terminal' OR outcome IS NOT NULL)
               ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .all(sessionID, TERMINAL_EXECUTIONS_PER_SNAPSHOT)
          const executionIDs = [...activeRows, ...terminalRows].map((row) => row.id)
          expireRouteProposals(executionIDs, now)
          const activeInvocations = db
            .query<
              {
                id: string
                execution_id: string
                session_id: string
                parent_invocation_id: string | null
                kind: InvocationKind
                state: InvocationState
                revision: number
                created_at: number
              },
              [string]
            >(
              `SELECT i.id, i.execution_id, i.session_id, i.parent_invocation_id, i.kind, i.state,
                 i.revision, i.created_at
               FROM execution_invocation i JOIN execution e ON e.id = i.execution_id
               WHERE e.root_session_id = ? AND e.deleted_at IS NULL
                 AND i.state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
               ORDER BY i.created_at, i.id`,
            )
            .all(sessionID)
          const blockers = executionIDs.flatMap((executionID) => this.blockers(executionID).map(publicBlocker))
          const sequence = currentEventSequence()
          return ExecutionSnapshot.parse({
            cursor: { epoch: eventEpoch(), sequence },
            sessionGeneration: sessionGeneration(sessionID),
            sessionVersion:
              db
                .query<
                  { version: number },
                  [string]
                >("SELECT COALESCE(MAX(sequence), 0) AS version FROM execution_event WHERE session_id = ?")
                .get(sessionID)?.version ?? 0,
            activeExecutionID: activeExecutionID(sessionID),
            activeInvocations: activeInvocations.map(invocationView),
            executions: executionIDs.map((executionID) => executionView(executionID)!),
            pendingProposals: pendingRouteProposals(executionIDs),
            blockers,
          })
        })
      },

      events(input: { sessionID: string; cursor?: Cursor; afterSequence?: number; limit?: number }) {
        const limit = Math.min(100, Math.max(1, input.limit ?? 100))
        const epoch = eventEpoch()
        const currentSequence = currentEventSequence()
        const sequence = input.cursor?.sequence ?? input.afterSequence ?? 0
        if (input.cursor?.epoch !== undefined && input.cursor.epoch !== epoch) {
          return {
            epoch,
            cursor: { epoch, sequence: currentSequence },
            items: [] as EventEnvelope[],
            resyncRequired: true as const,
            reason: "epoch_changed" as const,
          }
        }
        if (sequence > currentSequence) {
          return {
            epoch,
            cursor: { epoch, sequence: currentSequence },
            items: [] as EventEnvelope[],
            resyncRequired: true as const,
            reason: "cursor_ahead" as const,
          }
        }
        if (sequence < eventRetentionFloor()) {
          return {
            epoch,
            cursor: { epoch, sequence: currentSequence },
            items: [] as EventEnvelope[],
            resyncRequired: true as const,
            reason: "retention_gap" as const,
          }
        }
        const rows = db
          .query<
            {
              sequence: number
              event_id: string
              epoch: string
              project_id: string
              session_id: string
              session_generation: number
              execution_id: string | null
              resource_version: number
              type: EventType
              properties: string
            },
            [string, number, number]
          >(
            `SELECT sequence, event_id, epoch, project_id, session_id, session_generation,
               execution_id, resource_version, type, properties
             FROM execution_event
             WHERE session_id = ? AND sequence > ?
             ORDER BY sequence LIMIT ?`,
          )
          .all(input.sessionID, sequence, limit)
        const items = rows.map((row) =>
          EventEnvelope.parse({
            eventID: row.event_id,
            cursor: { epoch: row.epoch, sequence: row.sequence },
            projectID: row.project_id,
            sessionID: row.session_id,
            sessionGeneration: row.session_generation,
            executionID: row.execution_id ?? undefined,
            resourceVersion: row.resource_version,
            type: row.type,
            properties: JSON.parse(row.properties),
          }),
        )
        return {
          epoch,
          cursor: {
            epoch,
            sequence: items.length === limit ? items.at(-1)!.cursor.sequence : currentSequence,
          },
          items,
          resyncRequired: false as const,
        }
      },

      invocation(invocationID: string) {
        return invocation(invocationID)
      },

      blocker(blockerID: string) {
        return blocker(blockerID)
      },

      deadline(executionID: string) {
        return execution(executionID)?.deadline_at ?? undefined
      },

      routeProposal(id: string) {
        return routeProposal(id)
      },

      routeProposalHistory(executionID: string, limit = 20) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("route proposal limit is invalid")
        return db
          .query<{ id: string }, [string, number]>(
            "SELECT id FROM route_proposal WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          )
          .all(executionID, limit)
          .map((row) => routeProposal(row.id)!)
      },

      proposeRoute(input: {
        id: string
        executionID: string
        invocationID: string
        ownerID: string
        fence: number
        stepID: string
        expectedRouteRevision: number
        sessionGeneration: number
        fromRoute: Route
        toRoute: Route
        paramsDigest: string
        scope: "thinking" | "model" | "expert"
        reasonCode: string
        evidenceRefs: string[]
        estimatedUsage?: Record<string, unknown>
        uncertainty?: boolean
        expiresAt: number
        policyVersion: number
        consentVersion?: number
        credentialRevision: string
        autoAccept?: boolean
        manualModelPin?: boolean
        manualThinkingPin?: boolean
        now?: number
      }) {
        return transaction(() => {
          const now = input.now ?? Date.now()
          const current = execution(input.executionID)
          if (!current || current.status !== "active" || current.outcome !== null)
            return { proposed: false as const, reason: "not_active" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now))
            return { proposed: false as const, reason: "stale_fence" as const }
          if (current.deadline_at !== null && now >= current.deadline_at)
            return { proposed: false as const, reason: "deadline" as const }
          if (current.route_revision !== input.expectedRouteRevision)
            return { proposed: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
          if (current.session_generation !== input.sessionGeneration)
            return { proposed: false as const, reason: "stale_generation" as const }
          const source = invocation(input.invocationID)
          if (
            !source ||
            source.executionID !== input.executionID ||
            !["accepted", "running", "waiting"].includes(source.state)
          )
            return { proposed: false as const, reason: "invalid_invocation" as const }
          if (input.expiresAt <= now) return { proposed: false as const, reason: "expired" as const }
          const fromRoute = Route.parse(input.fromRoute)
          const toRoute = Route.parse(input.toRoute)
          const routeRow = db
            .query<
              { current_route: string; route_revision: number },
              [string]
            >("SELECT current_route, route_revision FROM execution_route WHERE execution_id = ?")
            .get(input.executionID)
          if (
            routeRow &&
            (routeRow.route_revision !== current.route_revision || routeRow.current_route !== JSON.stringify(fromRoute))
          )
            return { proposed: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
          if (!routeRow) {
            db.query(
              `INSERT INTO execution_route
                (execution_id, route_revision, current_route, base_route, stage, manual_model_pin, manual_thinking_pin)
               VALUES (?, ?, ?, ?, 'base', ?, ?)`,
            ).run(
              input.executionID,
              current.route_revision,
              JSON.stringify(fromRoute),
              JSON.stringify(fromRoute),
              input.manualModelPin ? 1 : 0,
              input.manualThinkingPin ? 1 : 0,
            )
          }
          const existing = db
            .query<
              RouteProposalRow,
              [string]
            >("SELECT * FROM route_proposal WHERE execution_id = ? AND state IN ('pending', 'accepted') ORDER BY created_at DESC LIMIT 1")
            .get(input.executionID)
          if (
            existing &&
            existing.invocation_id === input.invocationID &&
            existing.step_id === input.stepID &&
            existing.route_revision === input.expectedRouteRevision &&
            existing.to_route === JSON.stringify(toRoute) &&
            existing.params_digest === input.paramsDigest &&
            existing.reason_code === input.reasonCode
          ) {
            return { proposed: true as const, idempotent: true, proposal: routeProposal(existing.id)! }
          }
          if (existing) {
            db.query(
              "UPDATE route_proposal SET state = 'superseded', version = version + 1, decided_at = ? WHERE id = ?",
            ).run(now, existing.id)
          }
          const grant = input.autoAccept
            ? db
                .query<{ actor_id: string }, [string, string, string, string, number, string]>(
                  `SELECT actor_id FROM route_grant WHERE execution_id = ? AND target_route = ?
                     AND params_digest = ? AND scope = ? AND policy_version = ? AND credential_revision = ?`,
                )
                .get(
                  input.executionID,
                  JSON.stringify(toRoute),
                  input.paramsDigest,
                  input.scope,
                  input.policyVersion,
                  input.credentialRevision,
                )
            : undefined
          const initialState = grant ? "accepted" : "pending"
          db.query(
            `INSERT INTO route_proposal
              (id, execution_id, invocation_id, step_id, route_revision, session_generation,
               from_route, to_route, params_digest, scope, reason_code, evidence_refs, estimated_usage,
               uncertainty, expires_at, policy_version, consent_version, credential_revision,
               state, version, actor_id, accept_scope, decided_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          ).run(
            input.id,
            input.executionID,
            input.invocationID,
            input.stepID,
            input.expectedRouteRevision,
            input.sessionGeneration,
            JSON.stringify(fromRoute),
            JSON.stringify(toRoute),
            input.paramsDigest,
            input.scope,
            input.reasonCode,
            JSON.stringify(input.evidenceRefs),
            JSON.stringify(input.estimatedUsage ?? {}),
            input.uncertainty ? 1 : 0,
            input.expiresAt,
            input.policyVersion,
            input.consentVersion ?? 0,
            input.credentialRevision,
            initialState,
            grant?.actor_id ?? null,
            grant ? "execution" : null,
            grant ? now : null,
            now,
          )
          db.query("UPDATE execution SET phase = 'awaiting_route_approval' WHERE id = ?").run(input.executionID)
          touchExecution(input.executionID, now, "route.proposal.updated", {
            proposalID: input.id,
            state: initialState,
          })
          return { proposed: true as const, idempotent: false, proposal: routeProposal(input.id)! }
        })
      },

      decideRouteProposal(input: {
        requestID: string
        proposalID: string
        executionID: string
        sessionID: string
        projectID: string
        expectedProposalVersion: number
        expectedRouteRevision: number
        decision: "accept" | "reject"
        actorID: string
        acceptScope?: "episode" | "execution"
        now?: number
      }) {
        return transaction(() => {
          const payload = JSON.stringify({
            proposalID: input.proposalID,
            expectedProposalVersion: input.expectedProposalVersion,
            expectedRouteRevision: input.expectedRouteRevision,
            decision: input.decision,
            actorID: input.actorID,
            acceptScope: input.acceptScope ?? null,
          })
          const prior = db
            .query<
              { execution_id: string; kind: string; payload_digest: string },
              [string]
            >("SELECT execution_id, kind, payload_digest FROM execution_request WHERE request_id = ?")
            .get(input.requestID)
          if (prior) {
            if (
              prior.execution_id !== input.executionID ||
              prior.kind !== "route_decision" ||
              prior.payload_digest !== payload
            )
              return { decided: false as const, reason: "request_conflict" as const }
            const proposal = routeProposal(input.proposalID)
            return proposal
              ? { decided: true as const, idempotent: true, proposal }
              : { decided: false as const, reason: "not_found" as const }
          }
          const current = execution(input.executionID)
          const proposal = routeProposal(input.proposalID)
          if (
            !current ||
            !proposal ||
            proposal.executionID !== input.executionID ||
            current.root_session_id !== input.sessionID ||
            current.project_id !== input.projectID ||
            current.deleted_at !== null
          )
            return { decided: false as const, reason: "not_found" as const }
          if (proposal.version !== input.expectedProposalVersion)
            return { decided: false as const, reason: "stale_version" as const, version: proposal.version }
          if (
            current.route_revision !== input.expectedRouteRevision ||
            proposal.routeRevision !== input.expectedRouteRevision
          )
            return { decided: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
          if (proposal.state !== "pending") return { decided: false as const, reason: "not_pending" as const }
          const now = input.now ?? Date.now()
          if (proposal.expiresAt <= now) {
            db.query(
              "UPDATE route_proposal SET state = 'expired', version = version + 1, decided_at = ? WHERE id = ?",
            ).run(now, input.proposalID)
            db.query("UPDATE execution SET phase = 'model' WHERE id = ?").run(input.executionID)
            touchExecution(input.executionID, now, "route.proposal.updated", {
              proposalID: input.proposalID,
              state: "expired",
            })
            return { decided: false as const, reason: "expired" as const }
          }
          const state = input.decision === "accept" ? "accepted" : "rejected"
          const changed = db
            .query(
              `UPDATE route_proposal SET state = ?, version = version + 1, decision_id = ?, actor_id = ?,
                 accept_scope = ?, decided_at = ? WHERE id = ? AND version = ? AND state = 'pending'`,
            )
            .run(
              state,
              input.requestID,
              input.actorID,
              input.decision === "accept" ? (input.acceptScope ?? "episode") : null,
              now,
              input.proposalID,
              input.expectedProposalVersion,
            )
          if (changed.changes !== 1) return { decided: false as const, reason: "stale_version" as const }
          if (state === "rejected") db.query("UPDATE execution SET phase = 'model' WHERE id = ?").run(input.executionID)
          touchExecution(input.executionID, now, "route.proposal.updated", { proposalID: input.proposalID, state })
          const updated = routeProposal(input.proposalID)!
          if (state === "accepted" && updated.acceptScope === "execution") {
            db.query(
              `INSERT INTO route_grant
                (execution_id, target_route, params_digest, scope, policy_version,
                 credential_revision, actor_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(execution_id, target_route, params_digest, scope) DO UPDATE SET
                 policy_version = excluded.policy_version,
                 credential_revision = excluded.credential_revision,
                 actor_id = excluded.actor_id,
                 created_at = excluded.created_at`,
            ).run(
              input.executionID,
              JSON.stringify(updated.toRoute),
              updated.paramsDigest,
              updated.scope,
              updated.policyVersion,
              updated.credentialRevision,
              input.actorID,
              now,
            )
          }
          db.query(
            `INSERT INTO execution_request
              (request_id, execution_id, kind, payload_digest, resulting_version, created_at)
             VALUES (?, ?, 'route_decision', ?, ?, ?)`,
          ).run(input.requestID, input.executionID, payload, updated.version, now)
          return { decided: true as const, idempotent: false, proposal: updated }
        })
      },

      applyRouteProposal(input: {
        proposalID: string
        executionID: string
        invocationID: string
        ownerID: string
        fence: number
        expectedProposalVersion: number
        expectedRouteRevision: number
        paramsDigest: string
        expertLimits?: { maxEpisodes: number; maxCalls: number; maxSteps: number }
        now?: number
      }) {
        return transaction(() => {
          const now = input.now ?? Date.now()
          const current = execution(input.executionID)
          const proposal = routeProposal(input.proposalID)
          if (!current || !proposal || proposal.executionID !== input.executionID)
            return { applied: false as const, reason: "not_found" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now))
            return { applied: false as const, reason: "stale_fence" as const }
          if (current.deadline_at !== null && now >= current.deadline_at)
            return { applied: false as const, reason: "deadline" as const }
          if (proposal.version !== input.expectedProposalVersion)
            return { applied: false as const, reason: "stale_version" as const, version: proposal.version }
          if (proposal.state !== "accepted") return { applied: false as const, reason: "not_accepted" as const }
          if (proposal.expiresAt <= now) return { applied: false as const, reason: "expired" as const }
          if (
            current.route_revision !== input.expectedRouteRevision ||
            proposal.routeRevision !== input.expectedRouteRevision
          )
            return { applied: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
          if (proposal.invocationID !== input.invocationID || proposal.paramsDigest !== input.paramsDigest)
            return { applied: false as const, reason: "stale_proposal" as const }
          if (["tools", "waiting_permission", "reviewing", "finalizing", "draining"].includes(current.phase))
            return { applied: false as const, reason: "unsafe_boundary" as const }
          const openAttempts = db
            .query<
              { count: number },
              [string, string]
            >("SELECT COUNT(*) AS count FROM attempt WHERE execution_id = ? AND invocation_id = ? AND state IN ('reserved', 'dispatched')")
            .get(input.executionID, input.invocationID)!.count
          const openWork = db
            .query<
              { count: number },
              [string, string]
            >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND invocation_id = ? AND state IN ('prepared', 'running', 'draining', 'unknown')")
            .get(input.executionID, input.invocationID)!.count
          if (openAttempts || openWork) return { applied: false as const, reason: "unsafe_boundary" as const }
          const executionUsage = total(executionBudgetScope(current))
          if (proposal.scope === "expert") {
            const limits = input.expertLimits
            if (!limits) return { applied: false as const, reason: "expert_limits_required" as const }
            const episodes = db
              .query<{ count: number }, [string]>(
                `SELECT COUNT(*) AS count FROM route_proposal candidate
                 JOIN execution owner ON owner.id = candidate.execution_id
                 WHERE owner.budget_scope_id = ? AND candidate.scope = 'expert' AND candidate.state = 'applied'`,
              )
              .get(current.budget_scope_id)!.count
            if (episodes >= limits.maxEpisodes || limits.maxCalls === 0 || limits.maxSteps === 0)
              return { applied: false as const, reason: "expert_limit" as const }
          }
          const changed = db
            .query(
              "UPDATE route_proposal SET state = 'applied', version = version + 1, applied_at = ? WHERE id = ? AND version = ? AND state = 'accepted'",
            )
            .run(now, input.proposalID, input.expectedProposalVersion)
          if (changed.changes !== 1) return { applied: false as const, reason: "stale_version" as const }
          db.query(
            `UPDATE execution_route SET route_revision = route_revision + 1, current_route = ?,
               base_route = CASE WHEN ? = 'expert' THEN base_route ELSE ? END,
               manual_model_pin = CASE WHEN ? = 'model' THEN 1 ELSE manual_model_pin END,
               manual_thinking_pin = CASE WHEN ? = 'thinking' THEN 1 ELSE manual_thinking_pin END,
               stage = ?, active_episode_id = ?, expert_start_calls = ?, expert_start_steps = ?,
               max_expert_episodes = ?, max_expert_calls = ?, max_expert_steps = ?
             WHERE execution_id = ? AND route_revision = ?`,
          ).run(
            JSON.stringify(proposal.toRoute),
            proposal.scope,
            JSON.stringify(proposal.toRoute),
            proposal.scope,
            proposal.scope,
            proposal.scope === "expert" ? "expert" : "base",
            proposal.scope === "expert" ? proposal.id : null,
            proposal.scope === "expert" ? executionUsage.calls : null,
            proposal.scope === "expert" ? executionUsage.steps : null,
            proposal.scope === "expert" ? input.expertLimits!.maxEpisodes : null,
            proposal.scope === "expert" ? input.expertLimits!.maxCalls : null,
            proposal.scope === "expert" ? input.expertLimits!.maxSteps : null,
            input.executionID,
            input.expectedRouteRevision,
          )
          db.query(
            "UPDATE execution SET route_revision = route_revision + 1, phase = 'model', version = version + 1, updated_at = ? WHERE id = ?",
          ).run(now, input.executionID)
          appendExecutionEvent(input.executionID, "execution.route.changed", now, {
            proposalID: input.proposalID,
            route: proposal.toRoute,
          })
          return {
            applied: true as const,
            proposal: routeProposal(input.proposalID)!,
            routeRevision: current.route_revision + 1,
          }
        })
      },

      returnFromExpert(input: {
        id: string
        executionID: string
        sessionID: string
        invocationID: string
        rootSessionID: string
        ownerID: string
        fence: number
        episodeID: string
        expectedRouteRevision: number
        payload: string
        now?: number
      }) {
        return transaction(() => {
          const now = input.now ?? Date.now()
          const current = execution(input.executionID)
          if (!current || current.status !== "active" || current.outcome !== null)
            return { returned: false as const, reason: "not_active" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now))
            return { returned: false as const, reason: "stale_fence" as const }
          if (current.deadline_at !== null && now >= current.deadline_at)
            return { returned: false as const, reason: "deadline" as const }
          const route = db
            .query<
              { route_revision: number; base_route: string; stage: string; active_episode_id: string | null },
              [string]
            >("SELECT route_revision, base_route, stage, active_episode_id FROM execution_route WHERE execution_id = ?")
            .get(input.executionID)
          if (
            !route ||
            route.stage !== "expert" ||
            route.active_episode_id !== input.episodeID ||
            route.route_revision !== input.expectedRouteRevision ||
            current.route_revision !== input.expectedRouteRevision
          )
            return { returned: false as const, reason: "stale_route" as const }
          const unsafe = db
            .query<{ count: number }, [string, string]>(
              `SELECT
                 (SELECT COUNT(*) FROM attempt WHERE execution_id = ? AND state IN ('reserved', 'dispatched')) +
                 (SELECT COUNT(*) FROM execution_work WHERE execution_id = ? AND state IN ('prepared', 'running', 'draining', 'unknown'))
                 AS count`,
            )
            .get(input.executionID, input.executionID)!.count
          if (unsafe) return { returned: false as const, reason: "unsafe_boundary" as const }
          const pending = db
            .query<
              { count: number },
              [string]
            >("SELECT COUNT(*) AS count FROM execution_continuation WHERE session_id = ? AND state = 'pending'")
            .get(input.sessionID)!.count
          if (pending >= MAX_PENDING_CONTINUATIONS)
            return { returned: false as const, reason: "continuation_limit" as const }
          const binding = db
            .query<
              { session_id: string; execution_id: string },
              [string]
            >("SELECT session_id, execution_id FROM execution_binding WHERE invocation_id = ?")
            .get(input.invocationID)
          if (binding && (binding.session_id !== input.sessionID || binding.execution_id !== input.executionID))
            throw new Error("continuation invocation belongs to another execution")
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
            `INSERT INTO execution_continuation
              (id, execution_id, session_id, invocation_id, kind, payload, state, created_at)
             VALUES (?, ?, ?, ?, 'expert_handoff', ?, 'pending', ?)
             ON CONFLICT(id) DO NOTHING`,
          ).run(input.id, input.executionID, input.sessionID, input.invocationID, input.payload, now)
          db.query(
            `UPDATE route_proposal SET state = 'superseded', version = version + 1, decided_at = COALESCE(decided_at, ?)
             WHERE execution_id = ? AND state IN ('pending', 'accepted')`,
          ).run(now, input.executionID)
          db.query(
            `UPDATE execution_route SET route_revision = route_revision + 1, current_route = base_route,
               stage = 'base', active_episode_id = NULL
             WHERE execution_id = ? AND route_revision = ? AND stage = 'expert' AND active_episode_id = ?`,
          ).run(input.executionID, input.expectedRouteRevision, input.episodeID)
          db.query(
            `UPDATE execution SET route_revision = route_revision + 1, phase = 'model', version = version + 1,
               updated_at = ? WHERE id = ? AND route_revision = ?`,
          ).run(now, input.executionID, input.expectedRouteRevision)
          const baseRoute = Route.parse(JSON.parse(route.base_route))
          appendExecutionEvent(input.executionID, "execution.route.changed", now, {
            episodeID: input.episodeID,
            route: baseRoute,
          })
          return { returned: true as const, routeRevision: input.expectedRouteRevision + 1, route: baseRoute }
        })
      },

      binding(invocationID: string): Context | undefined {
        const row = db
          .query<
            {
              execution_id: string
              root_session_id: string
              invocation_id: string
              owner_id: string
              fence: number
            },
            [string]
          >(
            `SELECT execution_id, root_session_id, invocation_id, owner_id, fence
             FROM execution_binding WHERE invocation_id = ?`,
          )
          .get(invocationID)
        if (!row) return
        return {
          executionID: row.execution_id,
          rootSessionID: row.root_session_id,
          invocationID: row.invocation_id,
          ownerID: row.owner_id,
          fence: row.fence,
        }
      },

      active(sessionID: string): Omit<Context, "invocationID"> | undefined {
        const row = db
          .query<{ execution_id: string; root_session_id: string; owner_id: string; fence: number }, [string]>(
            `SELECT binding.execution_id, binding.root_session_id, binding.owner_id, binding.fence
             FROM session_execution binding
             JOIN execution current ON current.id = binding.execution_id
             WHERE binding.session_id = ? AND current.lifecycle != 'terminal' AND current.outcome IS NULL`,
          )
          .get(sessionID)
        if (!row) return
        return {
          executionID: row.execution_id,
          rootSessionID: row.root_session_id,
          ownerID: row.owner_id,
          fence: row.fence,
        }
      },

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
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
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

      finishInvocation(input: {
        invocationID: string
        executionID: string
        ownerID: string
        fence: number
        state: "completed" | "failed" | "cancelled" | "unknown"
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
          db.query(
            `UPDATE execution_invocation
             SET state = ?, revision = revision + 1, finished_at = ?
             WHERE id = ? AND revision = ?`,
          ).run(input.state, now, input.invocationID, record.revision)
          const blockerState =
            input.state === "completed"
              ? "resolved"
              : input.state === "failed"
                ? "failed"
                : input.state === "cancelled"
                  ? "cancelled"
                  : "unknown"
          db.query(
            `UPDATE execution_blocker SET state = ?, version = version + 1,
               evidence = ?, resolution_code = ?, updated_at = ?, finished_at = ?
             WHERE execution_id = ? AND kind = 'child' AND producer_id = ?
               AND state NOT IN ('resolved', 'waived')`,
          ).run(
            blockerState,
            `Child invocation finished with state ${input.state}`,
            `invocation_${input.state}`,
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

      blockers(executionID: string) {
        const ids = db
          .query<
            { id: string },
            [string]
          >("SELECT id FROM execution_blocker WHERE execution_id = ? ORDER BY created_at, id")
          .all(executionID)
        return ids.map((row) => blocker(row.id)!)
      },

      createPlan(input: {
        executionID: string
        invocationID: string
        ownerID: string
        fence: number
        items: Array<{ id: string; resourceScope: string }>
        now?: number
      }) {
        if (input.items.length > MAX_PLAN_ITEMS) {
          return { created: false as const, reason: "plan_item_limit" as const }
        }
        if (new Set(input.items.map((item) => item.id)).size !== input.items.length) {
          return { created: false as const, reason: "duplicate_plan_item" as const }
        }
        return transaction(() => {
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || current.status !== "active") {
            return { created: false as const, reason: "not_active" as const }
          }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { created: false as const, reason: "stale_fence" as const }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) {
            return { created: false as const, reason: "deadline" as const }
          }
          const producerInvocation = invocation(input.invocationID)
          if (
            !producerInvocation ||
            producerInvocation.executionID !== input.executionID ||
            !["accepted", "running", "waiting"].includes(producerInvocation.state)
          ) {
            return { created: false as const, reason: "invalid_invocation" as const }
          }
          const openPlanItems = db
            .query<{ count: number }, [string]>(
              `SELECT COUNT(*) AS count FROM execution_blocker
               WHERE execution_id = ? AND kind = 'plan_item' AND state NOT IN ('resolved', 'waived')`,
            )
            .get(input.executionID)?.count
          if ((openPlanItems ?? 0) > 0) {
            return { created: false as const, reason: "active_plan" as const }
          }
          const blockerCount = db
            .query<
              { count: number },
              [string]
            >("SELECT COUNT(*) AS count FROM execution_blocker WHERE execution_id = ?")
            .get(input.executionID)?.count
          if ((blockerCount ?? 0) + input.items.length > MAX_BLOCKERS_PER_EXECUTION) {
            return { created: false as const, reason: "blocker_limit" as const }
          }
          if (input.items.length === 0) {
            return {
              created: true as const,
              idempotent: true,
              revision: current.plan_revision,
              blockers: [] as Blocker[],
            }
          }

          const revision = current.plan_revision + 1
          for (const [index, item] of input.items.entries()) {
            const id = `plan:${input.executionID}:${revision}:${index}`
            db.query(
              `INSERT INTO execution_blocker
                (id, execution_id, invocation_id, kind, producer_id, resource_scope, state, version,
                 owner_id, fence, plan_revision, created_at, updated_at)
               VALUES (?, ?, ?, 'plan_item', ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`,
            ).run(
              id,
              input.executionID,
              input.invocationID,
              `${revision}:${item.id}`,
              item.resourceScope,
              input.ownerID,
              input.fence,
              revision,
              now,
              now,
            )
          }
          db.query("UPDATE execution SET plan_revision = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
            revision,
            now,
            input.executionID,
          )
          const blockers = input.items.map((_, index) => blocker(`plan:${input.executionID}:${revision}:${index}`)!)
          appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blockers })
          return { created: true as const, idempotent: false, revision, blockers }
        })
      },

      registerBlocker(input: {
        id: string
        executionID: string
        invocationID: string
        parentBlockerID?: string
        kind: BlockerKind
        producerID: string
        resourceScope: string
        ownerID: string
        fence: number
        planRevision?: number
        now?: number
      }) {
        return transaction(() => {
          const existing = blocker(input.id)
          if (existing) {
            if (
              existing.executionID !== input.executionID ||
              existing.kind !== input.kind ||
              existing.producerID !== input.producerID
            ) {
              throw new Error("blocker ID belongs to another producer")
            }
            return { registered: true as const, idempotent: true, blocker: existing }
          }
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { registered: false as const, reason: "not_active" as const }
          }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { registered: false as const, reason: "stale_fence" as const }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) {
            return { registered: false as const, reason: "deadline" as const }
          }
          const producerInvocation = invocation(input.invocationID)
          if (
            !producerInvocation ||
            producerInvocation.executionID !== input.executionID ||
            !["accepted", "running", "waiting"].includes(producerInvocation.state)
          ) {
            return { registered: false as const, reason: "invalid_invocation" as const }
          }
          if (
            current.status === "finalizing" &&
            (input.kind !== "verification_job" || !invocationReviewAuthorized(input.executionID, input.invocationID))
          ) {
            return { registered: false as const, reason: "not_active" as const }
          }
          const count = db
            .query<
              { count: number },
              [string]
            >("SELECT COUNT(*) AS count FROM execution_blocker WHERE execution_id = ?")
            .get(input.executionID)?.count
          if ((count ?? 0) >= MAX_BLOCKERS_PER_EXECUTION) {
            return { registered: false as const, reason: "blocker_limit" as const }
          }
          try {
            db.query(
              `INSERT INTO execution_blocker
                (id, execution_id, invocation_id, parent_blocker_id, kind, producer_id, resource_scope,
                 state, version, owner_id, fence, plan_revision, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`,
            ).run(
              input.id,
              input.executionID,
              input.invocationID,
              input.parentBlockerID ?? null,
              input.kind,
              input.producerID,
              input.resourceScope,
              input.ownerID,
              input.fence,
              input.planRevision ?? null,
              now,
              now,
            )
          } catch (error) {
            const duplicate = db
              .query<
                { id: string },
                [string, string, string]
              >("SELECT id FROM execution_blocker WHERE execution_id = ? AND kind = ? AND producer_id = ?")
              .get(input.executionID, input.kind, input.producerID)
            if (!duplicate) throw error
            return { registered: false as const, reason: "duplicate_producer" as const, blockerID: duplicate.id }
          }
          const registered = blocker(input.id)!
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
          appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blocker: registered })
          return { registered: true as const, idempotent: false, blocker: registered }
        })
      },

      transitionBlocker(input: {
        id: string
        executionID: string
        ownerID: string
        fence: number
        expectedVersion: number
        state: BlockerState
        evidence?: string
        resolutionCode?: string
        authority?: "user" | "policy"
        planRevision?: number
        now?: number
      }) {
        if (input.evidence && new TextEncoder().encode(input.evidence).byteLength > MAX_BLOCKER_EVIDENCE_BYTES) {
          throw new Error(`Blocker evidence exceeds ${MAX_BLOCKER_EVIDENCE_BYTES} bytes`)
        }
        return transaction(() => {
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { transitioned: false as const, reason: "not_active" as const }
          }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { transitioned: false as const, reason: "stale_fence" as const }
          }
          const record = blocker(input.id)
          if (!record) return { transitioned: false as const, reason: "not_found" as const }
          if (record.executionID !== input.executionID) throw new Error("blocker ID belongs to another execution")
          if (record.version !== input.expectedVersion) {
            return { transitioned: false as const, reason: "stale_version" as const, blocker: record }
          }
          if (record.state === input.state) {
            return { transitioned: true as const, idempotent: true, blocker: record }
          }
          if (!blockerTransitionAllowed(record.state, input.state)) {
            return { transitioned: false as const, reason: "invalid_transition" as const, blocker: record }
          }
          if (
            input.state === "waived" &&
            record.kind === "plan_item" &&
            (input.authority === undefined || input.planRevision !== record.planRevision)
          ) {
            return {
              transitioned: false as const,
              reason:
                input.authority === undefined ? ("authority_required" as const) : ("stale_plan_revision" as const),
              blocker: record,
            }
          }
          if (
            (["unknown", "failed", "cancelled"].includes(record.state) ||
              ["resolved", "waived"].includes(input.state)) &&
            (!input.evidence || !input.resolutionCode)
          ) {
            return { transitioned: false as const, reason: "evidence_required" as const, blocker: record }
          }
          const terminal = ["resolved", "failed", "cancelled", "waived"].includes(input.state)
          const result = db
            .query(
              `UPDATE execution_blocker SET state = ?, version = version + 1, owner_id = ?, fence = ?,
              evidence = ?, resolution_code = ?, updated_at = ?, finished_at = ?
             WHERE id = ? AND version = ?`,
            )
            .run(
              input.state,
              input.ownerID,
              input.fence,
              input.evidence ?? null,
              input.resolutionCode ?? null,
              now,
              terminal ? now : null,
              input.id,
              input.expectedVersion,
            )
          if (result.changes !== 1) {
            return { transitioned: false as const, reason: "stale_version" as const, blocker: blocker(input.id)! }
          }
          const transitioned = blocker(input.id)!
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
          appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blocker: transitioned })
          return { transitioned: true as const, idempotent: false, blocker: transitioned }
        })
      },

      registerWork(input: {
        id: string
        executionID: string
        invocationID: string
        kind: string
        mutating: boolean
        ownerID: string
        fence: number
        now?: number
      }) {
        return transaction(() => {
          const previous = db
            .query<
              { execution_id: string; state: WorkState; mutating: number },
              [string]
            >("SELECT execution_id, state, mutating FROM execution_work WHERE id = ?")
            .get(input.id)
          if (previous) {
            if (previous.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
            return {
              registered: false as const,
              reason: ["prepared", "running", "draining"].includes(previous.state)
                ? ("work_in_progress" as const)
                : ("duplicate_work" as const),
            }
          }
          const current = execution(input.executionID)
          if (
            !current ||
            (current.status !== "active" &&
              !(
                current.status === "finalizing" &&
                !input.mutating &&
                invocationReviewAuthorized(input.executionID, input.invocationID)
              ))
          ) {
            return { registered: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { registered: false as const, reason: "stale_fence" as const }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) {
            return { registered: false as const, reason: "deadline" as const }
          }
          const producerInvocation = invocation(input.invocationID)
          if (
            !producerInvocation ||
            producerInvocation.executionID !== input.executionID ||
            !["accepted", "running", "waiting"].includes(producerInvocation.state)
          ) {
            return { registered: false as const, reason: "invalid_invocation" as const }
          }
          const count = db
            .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ?")
            .get(input.executionID)?.count
          if ((count ?? 0) >= MAX_WORK_ITEMS_PER_EXECUTION) {
            return { registered: false as const, reason: "work_limit" as const }
          }
          db.query(
            `INSERT INTO execution_work
              (id, execution_id, invocation_id, kind, mutating, state, owner_id, fence, created_at)
             VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
          ).run(
            input.id,
            input.executionID,
            input.invocationID,
            input.kind,
            input.mutating ? 1 : 0,
            input.ownerID,
            input.fence,
            now,
          )
          return { registered: true as const, idempotent: false, state: "prepared" as const, version: 1 }
        })
      },

      beginWork(input: {
        id: string
        executionID: string
        invocationID: string
        ownerID: string
        fence: number
        expectedVersion: number
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { began: false as const, reason: "not_active" as const }
          }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { began: false as const, reason: "stale_fence" as const }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) {
            return { began: false as const, reason: "deadline" as const }
          }
          const producerInvocation = invocation(input.invocationID)
          if (
            !producerInvocation ||
            producerInvocation.executionID !== input.executionID ||
            !["accepted", "running", "waiting"].includes(producerInvocation.state)
          ) {
            return { began: false as const, reason: "invalid_invocation" as const }
          }
          if (current.status === "finalizing" && !invocationReviewAuthorized(input.executionID, input.invocationID)) {
            return { began: false as const, reason: "not_active" as const }
          }
          const work = db
            .query<
              {
                execution_id: string
                invocation_id: string
                state: WorkState
                owner_id: string
                fence: number
                version: number
                mutating: number
              },
              [string]
            >(
              `SELECT execution_id, invocation_id, state, owner_id, fence, version, mutating
               FROM execution_work WHERE id = ?`,
            )
            .get(input.id)
          if (!work) return { began: false as const, reason: "not_found" as const }
          if (work.execution_id !== input.executionID || work.invocation_id !== input.invocationID) {
            throw new Error("work ID belongs to another invocation")
          }
          if (work.version !== input.expectedVersion) return { began: false as const, reason: "stale_version" as const }
          if (work.state !== "prepared") return { began: false as const, reason: "already_began" as const }
          if (work.owner_id !== input.ownerID || work.fence !== input.fence) {
            return { began: false as const, reason: "stale_fence" as const }
          }
          const result = db
            .query(
              `UPDATE execution_work SET state = 'running', version = version + 1, began_at = ?
             WHERE id = ? AND version = ? AND state = 'prepared'`,
            )
            .run(now, input.id, input.expectedVersion)
          if (result.changes !== 1) return { began: false as const, reason: "stale_version" as const }
          if (work.mutating === 1) {
            db.query("UPDATE execution SET mutation_revision = mutation_revision + 1 WHERE id = ?").run(
              input.executionID,
            )
          }
          return { began: true as const, version: input.expectedVersion + 1 }
        })
      },

      finishWork(input: {
        id: string
        executionID: string
        ownerID: string
        fence: number
        expectedVersion: number
        state: "completed" | "failed" | "cancelled" | "unknown"
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing", "terminal"].includes(current.status)) {
            return { finished: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { finished: false as const, reason: "stale_fence" as const }
          }
          const work = db
            .query<
              { execution_id: string; state: WorkState; owner_id: string; fence: number; version: number },
              [string]
            >("SELECT execution_id, state, owner_id, fence, version FROM execution_work WHERE id = ?")
            .get(input.id)
          if (!work) return { finished: false as const, reason: "not_found" as const }
          if (work.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
          if (work.owner_id !== input.ownerID || work.fence !== input.fence) {
            return { finished: false as const, reason: "stale_fence" as const }
          }
          if (work.version !== input.expectedVersion) {
            return {
              finished: false as const,
              reason: "stale_version" as const,
              state: work.state,
              version: work.version,
            }
          }
          if (!["prepared", "running", "draining"].includes(work.state)) {
            if (work.state === input.state) {
              return { finished: true as const, idempotent: true, state: work.state, version: work.version }
            }
            return {
              finished: false as const,
              reason: work.state === "unknown" ? ("reconciliation_required" as const) : ("terminal" as const),
              state: work.state,
              version: work.version,
            }
          }
          if (work.state === "prepared" && input.state === "unknown") {
            return { finished: false as const, reason: "not_begun" as const }
          }
          const result = db
            .query(
              `UPDATE execution_work SET state = ?, version = version + 1, finished_at = ?
               WHERE id = ? AND version = ?`,
            )
            .run(input.state, now, input.id, input.expectedVersion)
          if (result.changes !== 1) return { finished: false as const, reason: "stale_version" as const }
          return {
            finished: true as const,
            idempotent: false,
            state: input.state,
            version: input.expectedVersion + 1,
          }
        })
      },

      reconcileWork(input: {
        id: string
        executionID: string
        ownerID: string
        fence: number
        state: "completed" | "failed" | "cancelled"
        expectedVersion: number
        evidence: string
        resolutionCode: string
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { reconciled: false as const, reason: "not_active" as const }
          }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { reconciled: false as const, reason: "stale_fence" as const }
          }
          if (
            !input.evidence ||
            !input.resolutionCode ||
            new TextEncoder().encode(input.evidence).byteLength > MAX_BLOCKER_EVIDENCE_BYTES
          ) {
            return { reconciled: false as const, reason: "evidence_required" as const }
          }
          const work = db
            .query<
              { execution_id: string; state: WorkState; version: number },
              [string]
            >("SELECT execution_id, state, version FROM execution_work WHERE id = ?")
            .get(input.id)
          if (!work) return { reconciled: false as const, reason: "not_found" as const }
          if (work.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
          if (work.version !== input.expectedVersion) {
            return { reconciled: false as const, reason: "stale_version" as const }
          }
          if (work.state !== "unknown") {
            return work.state === input.state
              ? { reconciled: true as const, idempotent: true, state: work.state }
              : { reconciled: false as const, reason: "not_unknown" as const }
          }
          const result = db
            .query(
              `UPDATE execution_work SET state = ?, version = version + 1, evidence = ?, resolution_code = ?, finished_at = ?
             WHERE id = ? AND version = ?`,
            )
            .run(input.state, input.evidence, input.resolutionCode, now, input.id, input.expectedVersion)
          if (result.changes !== 1) return { reconciled: false as const, reason: "stale_version" as const }
          return { reconciled: true as const, idempotent: false, state: input.state }
        })
      },

      stageCompletion(
        input: Omit<
          Completion,
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
              Completion,
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
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { staged: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
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
               WHERE execution_id = ? AND state NOT IN ('resolved', 'waived')`,
            )
            .get(input.executionID)?.count
          if ((openBlockers ?? 0) > 0) return { staged: false as const, reason: "active_blocker" as const }
          const existing = completion(input.executionID)
          if (existing?.state === "committed") {
            if (existing.digest !== input.digest)
              return { staged: false as const, reason: "already_committed" as const }
            return { staged: true as const, idempotent: true, completion: existing }
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
          return { staged: true as const, idempotent: false, completion: completion(input.executionID)! }
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
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || current.status !== "finalizing")
            return { claimed: false as const, reason: "not_active" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { claimed: false as const, reason: "stale_fence" as const }
          }
          const candidate = completion(input.executionID)
          if (
            !candidate ||
            candidate.state !== "staged" ||
            !candidate.requiresReview ||
            candidate.digest !== input.digest ||
            candidate.revision !== input.revision
          ) {
            return { claimed: false as const, reason: "stale_candidate" as const }
          }
          const existing = reviewClaim(input.executionID)
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
          return { claimed: true as const, idempotent: false, claim: reviewClaim(input.executionID)! }
        })
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
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || current.status !== "finalizing")
            return { authorized: false as const, reason: "not_active" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { authorized: false as const, reason: "stale_fence" as const }
          }
          const claim = reviewClaim(input.executionID)
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
        state: Exclude<ReviewState, "pending">
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          const now = input.now ?? Date.now()
          if (!current || current.status !== "finalizing")
            return { recorded: false as const, reason: "not_active" as const }
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { recorded: false as const, reason: "stale_fence" as const }
          }
          const claim = reviewClaim(input.executionID)
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
          return { recorded: true as const, idempotent: false, claim: reviewClaim(input.executionID)! }
        })
      },

      commitCompletion(input: {
        executionID: string
        ownerID: string
        fence: number
        digest: string
        policyDigest?: string
        contentSnapshotDigest?: string
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing", "terminal"].includes(current.status)) {
            return { committed: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { committed: false as const, reason: "stale_fence" as const }
          }
          const candidate = completion(input.executionID)
          if (!candidate || candidate.state === "discarded") {
            return { committed: false as const, reason: "not_staged" as const }
          }
          if (candidate.digest !== input.digest) {
            return { committed: false as const, reason: "stale_candidate" as const }
          }
          if (current.outcome !== null) {
            return current.outcome === "completed" &&
              candidate.state === "committed" &&
              candidate.outcome === "completed"
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
            const review = reviewClaim(input.executionID)
            if (
              !review ||
              review.digest !== candidate.digest ||
              review.revision !== candidate.revision ||
              review.state !== "passed"
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
          db.query(
            `UPDATE execution_completion SET state = 'committed', terminal_outcome = 'completed',
               delivery_payload = NULL, delivery_finish = NULL, reason_code = NULL,
               projection_state = 'pending', projected_at = NULL, projection_owner = NULL,
               projection_token = NULL, projection_lease_expires_at = NULL, committed_at = ?
             WHERE execution_id = ?`,
          ).run(now, input.executionID)
          db.query(
            `UPDATE execution SET status = 'terminal', lifecycle = 'terminal', phase = 'idle',
               outcome = 'completed', reason_code = NULL, reason_message = NULL, reason_retryable = 0,
               version = version + 1, updated_at = ?, terminal_at = ?
             WHERE id = ? AND outcome IS NULL`,
          ).run(now, now, input.executionID)
          appendExecutionEvent(input.executionID, "execution.updated", now)
          return { committed: true as const, idempotent: false, completion: completion(input.executionID)! }
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
          const current = execution(input.executionID)
          if (!current || !["finalizing", "terminal"].includes(current.status)) {
            return { finalized: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { finalized: false as const, reason: "stale_fence" as const }
          }
          const candidate = completion(input.executionID)
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
          const review = reviewClaim(input.executionID)
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
          appendExecutionEvent(input.executionID, "execution.updated", now)
          return { finalized: true as const, idempotent: false, completion: completion(input.executionID)! }
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
        outcome: Exclude<ExecutionOutcome, "completed">
        reasonCode: ReasonCode
        reasonMessage: string
        retryable: boolean
        now?: number
      }) {
        return transaction(() => {
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing", "terminal", "cancelled"].includes(current.status)) {
            return { finalized: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { finalized: false as const, reason: "stale_fence" as const }
          }
          const previous = completion(input.executionID)
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
          appendExecutionEvent(input.executionID, "execution.updated", now)
          return { finalized: true as const, idempotent: false, completion: completion(input.executionID)! }
        })
      },

      discardCompletion(input: { executionID: string; ownerID: string; fence: number; digest: string; now?: number }) {
        return transaction(() => {
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing"].includes(current.status))
            return { discarded: false as const, reason: "not_active" as const }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { discarded: false as const, reason: "stale_fence" as const }
          }
          const candidate = completion(input.executionID)
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
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { accepted: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
            return { accepted: false as const, reason: "stale_fence" as const }
          }
          const candidate = completion(input.executionID)
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
          db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(
            now,
            input.executionID,
          )
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

      cancel(input: { executionID: string; ownerID: string; fence: number; now?: number }) {
        return transaction(() => {
          const current = execution(input.executionID)
          if (!current || !["active", "finalizing"].includes(current.status)) {
            return { cancelled: false as const, reason: "not_active" as const }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.ownerID, input.fence, now)) {
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
                ["accepted", "running", "waiting"].includes(competing.state)
              ) {
                db.query(
                  `UPDATE execution_invocation SET state = 'completed', revision = revision + 1, finished_at = ?
                   WHERE id = ?`,
                ).run(now, competing.id)
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
          return this.binding(input.invocationID)!
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
          if (inserted.changes === 1) appendExecutionEvent(input.id, "execution.updated", now)
        })
        return execution(input.id)!
      },

      claimOwner(input: { executionID: string; ownerID: string; leaseMs: number; now?: number }) {
        if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) throw new Error("leaseMs must be positive")
        return transaction(() => {
          const current = execution(input.executionID)
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
              for (const scopeID of scopeIDs(current)) {
                changeTotal(scopeID, { pending_calls: -abandoned.length, reserved: -released })
              }
            }
            db.query(
              `UPDATE execution_work SET state = 'unknown', version = version + 1, finished_at = ?
               WHERE execution_id = ? AND state IN ('running', 'draining') AND fence < ?`,
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
          const current = execution(input.executionID)
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
        now?: number
      }) {
        return transaction(
          (): { admitted: true; idempotent: boolean } | { admitted: false; reason: RejectionReason } => {
            const current = execution(input.executionID)
            if (!current || !["active", "finalizing"].includes(current.status)) {
              return { admitted: false, reason: "not_active" }
            }
            const now = input.now ?? Date.now()
            if (!ownershipValid(current, input.ownerID, input.fence, now)) {
              return { admitted: false, reason: "stale_fence" }
            }
            if (
              current.status === "finalizing" &&
              (!input.invocationID || !invocationReviewAuthorized(input.executionID, input.invocationID))
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
            if (current.deadline_at !== null && now >= current.deadline_at)
              return { admitted: false, reason: "deadline" }
            const executionScope = executionBudgetScope(current)
            if (expertLimitReached(current, "steps", 1)) return { admitted: false, reason: "step_limit" }
            if (current.max_steps !== null && total(executionScope).steps + 1 > current.max_steps) {
              return { admitted: false, reason: "step_limit" }
            }
            db.query("INSERT INTO execution_step (id, execution_id, created_at) VALUES (?, ?, ?)").run(
              input.stepID,
              input.executionID,
              now,
            )
            changeTotal(executionScope, { steps: 1 })
            touchExecution(input.executionID, now)
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
      }): Admission {
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
            const current = execution(input.executionID)
            if (
              !current ||
              (current.status !== "active" &&
                !(
                  current.status === "finalizing" &&
                  input.invocationID &&
                  previous.invocation_id === input.invocationID &&
                  invocationReviewAuthorized(input.executionID, input.invocationID)
                ))
            ) {
              return { admitted: false, reason: "not_active" }
            }
            const now = input.now ?? Date.now()
            if (
              !ownershipValid(current, input.runID, input.fence, now) ||
              previous.fence !== input.fence ||
              previous.run_id !== input.runID
            ) {
              return { admitted: false, reason: "stale_fence" }
            }
            return { admitted: true, attemptID: previous.id, state: previous.state, idempotent: true }
          }
          const current = execution(input.executionID)
          if (
            !current ||
            (current.status !== "active" &&
              !(
                current.status === "finalizing" &&
                input.invocationID &&
                invocationReviewAuthorized(input.executionID, input.invocationID)
              ))
          ) {
            return { admitted: false, reason: "not_active" }
          }
          const now = input.now ?? Date.now()
          if (!ownershipValid(current, input.runID, input.fence, now)) {
            return { admitted: false, reason: "stale_fence" }
          }
          if (current.deadline_at !== null && now >= current.deadline_at) return { admitted: false, reason: "deadline" }

          const executionScope = executionBudgetScope(current)
          const rootScope = `root-session:${current.root_session_id}`
          const projectScope = `project:${current.project_id}`
          const executionTotal = total(executionScope)
          const rootTotal = total(rootScope)
          const projectTotal = total(projectScope)
          if (expertLimitReached(current, "calls", 1)) return { admitted: false, reason: "call_limit" }
          if (
            current.max_calls !== null &&
            executionTotal.calls + executionTotal.pending_calls + 1 > current.max_calls
          ) {
            return { admitted: false, reason: "call_limit" }
          }
          const executionCost = executionTotal.spent + executionTotal.reserved + executionTotal.uncertain
          const rootCost = rootTotal.spent + rootTotal.reserved + rootTotal.uncertain
          const projectCost = projectTotal.spent + projectTotal.reserved + projectTotal.uncertain
          if (
            (current.max_cost !== null && executionCost + input.estimateMicrousd > current.max_cost) ||
            (scopeMaxCost(rootScope) !== undefined && rootCost + input.estimateMicrousd > scopeMaxCost(rootScope)!) ||
            (scopeMaxCost(projectScope) !== undefined &&
              projectCost + input.estimateMicrousd > scopeMaxCost(projectScope)!)
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
            current.status === "finalizing" ? (reviewClaim(input.executionID)?.id ?? null) : null,
          )
          for (const scopeID of [executionScope, rootScope, projectScope]) {
            changeTotal(scopeID, { pending_calls: 1, reserved: input.estimateMicrousd })
          }
          touchExecution(input.executionID, now)
          emitBudgetWarnings(current, now)
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
          const current = execution(attempt.execution_id)!
          if (attempt.state !== "reserved") {
            return { dispatched: false as const, reason: "not_reserved" as const, state: attempt.state }
          }
          const now = input.now ?? Date.now()
          let reason: "not_active" | "stale_fence" | "deadline" | undefined
          if (
            current.status !== "active" &&
            !(current.status === "finalizing" && attemptReviewAuthorized(input.attemptID))
          )
            reason = "not_active"
          else if (
            !ownershipValid(current, input.runID, input.fence, now) ||
            attempt.fence !== input.fence ||
            attempt.run_id !== input.runID
          )
            reason = "stale_fence"
          else if (current.deadline_at !== null && now >= current.deadline_at) reason = "deadline"
          if (reason) {
            db.query("UPDATE attempt SET state = 'released' WHERE id = ?").run(input.attemptID)
            for (const scopeID of scopeIDs(current)) {
              changeTotal(scopeID, { pending_calls: -1, reserved: -attempt.estimate })
            }
            touchExecution(attempt.execution_id, now)
            emitBudgetWarnings(current, now)
            return { dispatched: false as const, reason }
          }
          db.query("UPDATE attempt SET state = 'dispatched', dispatched_at = ? WHERE id = ?").run(now, input.attemptID)
          for (const scopeID of scopeIDs(current)) {
            changeTotal(scopeID, { pending_calls: -1, calls: 1 })
          }
          touchExecution(attempt.execution_id, now)
          emitBudgetWarnings(current, now)
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
          const current = execution(attempt.execution_id)!
          db.query("UPDATE attempt SET state = 'settled', actual = ?, settled_at = ? WHERE id = ?").run(
            actualMicrousd,
            now,
            attemptID,
          )
          for (const scopeID of scopeIDs(current)) {
            changeTotal(scopeID, {
              [attempt.state === "uncertain" ? "uncertain" : "reserved"]: -attempt.estimate,
              spent: actualMicrousd,
            })
          }
          touchExecution(attempt.execution_id, now)
          emitBudgetWarnings(current, now)
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
          const current = execution(attempt.execution_id)!
          db.query("UPDATE attempt SET state = 'uncertain' WHERE id = ?").run(attemptID)
          for (const scopeID of scopeIDs(current)) {
            changeTotal(scopeID, { reserved: -attempt.estimate, uncertain: attempt.estimate })
          }
          touchExecution(attempt.execution_id, now)
          emitBudgetWarnings(current, now)
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
          const current = execution(attempt.execution_id)!
          db.query("UPDATE attempt SET state = 'released' WHERE id = ?").run(attemptID)
          for (const scopeID of scopeIDs(current)) {
            changeTotal(scopeID, { pending_calls: -1, reserved: -attempt.estimate })
          }
          touchExecution(attempt.execution_id, now)
          emitBudgetWarnings(current, now)
          return "released" as const
        })
      },

      totals(scopeID: string) {
        return total(scopeID)
      },

      requiresKnownPrice(executionID: string) {
        return execution(executionID)?.unknown_price_blocked === 1
      },

      revision(executionID: string) {
        return execution(executionID)?.mutation_revision
      },

      planRevision(executionID: string) {
        return execution(executionID)?.plan_revision
      },

      close() {
        db.close()
      },
    }
  }
}
