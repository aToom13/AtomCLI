import z from "zod"

export namespace LedgerTypes {
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
        reason:
          | "not_active"
          | "stale_fence"
          | "deadline"
          | "step_limit"
          | "call_limit"
          | "checkpoint_required"
          | "cost_limit"
      }
  export type RejectionReason = Extract<Admission, { admitted: false }>["reason"]

  export type ExecutionRow = {
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
    granted_calls: number
    granted_steps: number
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

  export type AttemptRow = {
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
  export type TotalRow = {
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
    "waiting_input",
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
    "execution.scope.escalated",
    "execution.budget.warning",
    "execution.blocker.updated",
    "route.proposal.updated",
    "execution.task.updated",
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
  export type BudgetScopeView = z.infer<typeof BudgetScopeView>
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
    unknownWork: z
      .array(
        z.object({
          id: z.string(),
          executionID: z.string(),
          invocationID: z.string(),
          kind: z.string(),
          mutating: z.boolean(),
          state: z.literal("unknown"),
          version: z.number().int().positive(),
          createdAt: z.number().int(),
          beganAt: z.number().int().optional(),
        }),
      )
      .default([]),
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
      "reopened",
      "blocked",
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
    | "reopened"
    | "blocked"
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
  export const TaskStatus = z.enum([
    "pending",
    "running",
    "submitted",
    "verifying",
    "accepted",
    "needs_revision",
    "blocked",
    "failed",
    "cancelled",
  ])
  export type TaskStatus = z.infer<typeof TaskStatus>
  export const TaskAcceptance = z
    .object({
      id: z.string().min(1).max(100),
      description: z.string().min(1).max(2_000),
      verification: z.enum(["automatic", "reviewer", "parent"]).default("parent"),
      command: z.string().min(1).max(10_000).optional(),
    })
    .refine((value) => value.verification !== "automatic" || Boolean(value.command), {
      message: "Automatic acceptance requires an exact command",
    })
  export type TaskAcceptance = z.infer<typeof TaskAcceptance>
  export type TaskCheckInput = {
    criterionID: string
    verifier: "reviewer" | "parent"
    passed: boolean
    evidence: string
  }
  export type AutomaticTaskCheckInput = {
    criterionID: string
    command: string
    exitCode: number
    evidence: string
  }
  export type TaskCheck = {
    criterionID: string
    verifier: "automatic" | "reviewer" | "parent"
    passed: boolean
    evidence: string
    verifierID: string
    taskRevision: number
    verifiedAt: number
  }
  export type Task = {
    id: string
    executionID: string
    parentTaskID?: string
    revision: number
    goal: string
    owner: string
    agent: string
    skill?: string
    execution?: TaskExecution
    atomic?: AtomicWork
    dependsOn: string[]
    acceptance: TaskAcceptance[]
    evidence: string[]
    status: TaskStatus
    supersedes?: string
    version: number
    createdAt: number
    updatedAt: number
    submittedAt?: number
    verifiedAt?: number
    checks?: TaskCheck[]
    sessionID?: string
    source?: "task" | "taskflow" | "orchestrate"
  }
  export const TaskExecution = z.object({
    owns: z.array(z.string().max(4096)).max(200).default([]),
    skills: z.array(z.string().min(1).max(200)).max(100).default([]),
    isolation: z.enum(["auto", "required"]).default("auto"),
    category: z.enum(["coding", "documentation", "analysis", "general"]).default("coding"),
    model: z.string().min(1).max(200).optional(),
    maxRetries: z.number().int().min(0).max(10).default(2),
    attempts: z.number().int().nonnegative().default(0),
  })
  export type TaskExecution = z.infer<typeof TaskExecution>
  export type AtomicWork = {
    workflowID: string
    planned: boolean
    originalGoal?: string
    messages: Array<{
      id: string
      text: string
      classification?: "amendment" | "status" | "stop"
      evidence?: string
    }>
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
  export type RouteProposalRow = {
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
}
