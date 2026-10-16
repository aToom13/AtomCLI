import { Database } from "bun:sqlite"
import { createAdmissionModule } from "./ledger/admission"
import { createCheckpointModule } from "./ledger/checkpoints"
import { createCompletionModule } from "./ledger/completion"
import { createRouteModule } from "./ledger/routes"
import { createWorkModule } from "./ledger/work"
import { createQueryModule } from "./ledger/queries"
import { Log } from "@/util/util/log"
import { initialize as initializeLedgerSchema } from "./ledger/schema"
import { LedgerTypes } from "./ledger/types"
import { createProjectionModule } from "./ledger/projection"
import { createCancellationModule } from "./ledger/cancellation"
import { createLifecycleModule } from "./ledger/lifecycle"
import { createBindingModule } from "./ledger/bindings"
import { createExecutionView } from "./ledger/execution-view"
import { createPolicyStateModule } from "./ledger/policy-state"
import { createCancellationOutbox } from "./ledger/cancellation-outbox"
import { createTaskModule } from "./ledger/tasks"

const log = Log.create({ service: "execution.ledger" })

const MAX_PENDING_CONTINUATIONS = 100
const COMPLETION_PROJECTION_PAGE_SIZE = 50
const MAX_BLOCKER_EVIDENCE_BYTES = 16 * 1024
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RETAINED_EVENTS = 100_000

export namespace ExecutionLedger {
  export const Policy = LedgerTypes.Policy
  export type Policy = LedgerTypes.Policy
  export const AttemptState = LedgerTypes.AttemptState
  export type AttemptState = LedgerTypes.AttemptState
  export type Admission = LedgerTypes.Admission
  export type Context = LedgerTypes.Context
  export type Completion = LedgerTypes.Completion
  export type CompletionClaim = LedgerTypes.CompletionClaim
  export const Lifecycle = LedgerTypes.Lifecycle
  export type ExecutionLifecycle = LedgerTypes.ExecutionLifecycle
  export const Phase = LedgerTypes.Phase
  export type ExecutionPhase = LedgerTypes.ExecutionPhase
  export const Outcome = LedgerTypes.Outcome
  export type ExecutionOutcome = LedgerTypes.ExecutionOutcome
  export const ReasonCode = LedgerTypes.ReasonCode
  export type ReasonCode = LedgerTypes.ReasonCode
  export type ExecutionState = LedgerTypes.ExecutionState
  export const EventType = LedgerTypes.EventType
  export type EventType = LedgerTypes.EventType
  export const EventEnvelope = LedgerTypes.EventEnvelope
  export type EventEnvelope = LedgerTypes.EventEnvelope
  export const BudgetScopeView = LedgerTypes.BudgetScopeView
  export type BudgetScopeView = LedgerTypes.BudgetScopeView
  export const BudgetView = LedgerTypes.BudgetView
  export type BudgetView = LedgerTypes.BudgetView
  export const Route = LedgerTypes.Route
  export type Route = LedgerTypes.Route
  export const ExecutionView = LedgerTypes.ExecutionView
  export type ExecutionView = LedgerTypes.ExecutionView
  export const RouteProposal = LedgerTypes.RouteProposal
  export type RouteProposal = LedgerTypes.RouteProposal
  export const InvocationView = LedgerTypes.InvocationView
  export type InvocationView = LedgerTypes.InvocationView
  export const PublicBlocker = LedgerTypes.PublicBlocker
  export type PublicBlocker = LedgerTypes.PublicBlocker
  export const Cursor = LedgerTypes.Cursor
  export type Cursor = LedgerTypes.Cursor
  export const ExecutionList = LedgerTypes.ExecutionList
  export type ExecutionList = LedgerTypes.ExecutionList
  export const ExecutionSnapshot = LedgerTypes.ExecutionSnapshot
  export type ExecutionSnapshot = LedgerTypes.ExecutionSnapshot
  export type Continuation = LedgerTypes.Continuation
  export type WorkState = LedgerTypes.WorkState
  export type InvocationKind = LedgerTypes.InvocationKind
  export type InvocationState = LedgerTypes.InvocationState
  export type Invocation = LedgerTypes.Invocation
  export type BlockerKind = LedgerTypes.BlockerKind
  export type BlockerState = LedgerTypes.BlockerState
  export type Blocker = LedgerTypes.Blocker
  export const TaskStatus = LedgerTypes.TaskStatus
  export type TaskStatus = LedgerTypes.TaskStatus
  export type TaskAcceptance = LedgerTypes.TaskAcceptance
  export const TaskAcceptance = LedgerTypes.TaskAcceptance
  export type TaskCheckInput = LedgerTypes.TaskCheckInput
  export type AutomaticTaskCheckInput = LedgerTypes.AutomaticTaskCheckInput
  export type TaskCheck = LedgerTypes.TaskCheck
  export const TaskExecution = LedgerTypes.TaskExecution
  export type TaskExecution = LedgerTypes.TaskExecution
  export type AtomicWork = LedgerTypes.AtomicWork
  export type Task = LedgerTypes.Task
  export type ReviewState = LedgerTypes.ReviewState
  export type ReviewClaim = LedgerTypes.ReviewClaim
  export type RejectionReason = LedgerTypes.RejectionReason
  export type ExecutionRow = LedgerTypes.ExecutionRow
  export type AttemptRow = LedgerTypes.AttemptRow
  export type TotalRow = LedgerTypes.TotalRow
  export type RouteProposalRow = LedgerTypes.RouteProposalRow
  export function open(filepath: string) {
    const db = new Database(filepath, { create: true })
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = FULL")
    db.run("PRAGMA foreign_keys = ON")
    initializeLedgerSchema(db)
    function transaction<T>(fn: () => T): T {
      db.run("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.run("COMMIT")
        return result
      } catch (error) {
        // A failing ROLLBACK must not replace the business error we are about to
        // report, and must not leave the handle mid-transaction for the next
        // BEGIN IMMEDIATE. Same guard as the open/migrate path above.
        try {
          db.run("ROLLBACK")
        } catch (rollbackError) {
          log.error("ledger rollback failed after a transaction error", { rollbackError })
        }
        throw error
      }
    }

    const policyModule = createPolicyStateModule({ db, transaction })
    const { scopeIDs, executionBudgetScope, tighten, tightenScopePolicy, scopeMaxCost } = policyModule
    const { reserveToolAllowance, releaseToolAllowance, getPolicyState } = policyModule

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
            max_calls, max_steps, granted_calls, granted_steps, max_cost, owner_id, lease_expires_at,
            unknown_price_blocked, mutation_revision,
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

    const executionView = createExecutionView({
      db,
      execution,
      executionState,
      total,
      unpricedCalls,
      budgetScope,
      executionBudgetScope,
      scopeMaxCost,
      completion,
      executionRoute,
    })

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
        running: ["draining", "unknown", "resolved", "failed", "blocked", "cancelled", "waived"],
        draining: ["unknown", "resolved", "failed", "cancelled"],
        unknown: ["resolved", "failed", "cancelled", "waived"],
        resumable: ["running", "cancelled", "waived"],
        reopened: ["running", "cancelled", "waived"],
        blocked: ["running", "cancelled", "waived"],
        resolved: ["reopened"],
        failed: ["resolved", "waived"],
        cancelled: ["resolved", "waived"],
        waived: [],
      }
      return transitions[from].includes(to)
    }

    function hasUnresolvedExecutionTaskflow(executionID: string): boolean {
      const row = db
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) AS count FROM execution_blocker
           WHERE execution_id = ?
             AND kind IN ('plan_item', 'workflow')
             AND state NOT IN ('resolved', 'waived', 'cancelled')`,
        )
        .get(executionID)
      return (row?.count ?? 0) > 0
    }

    const workModule = createWorkModule({
      db,
      transaction,
      execution,
      invocation,
      blocker,
      invocationReviewAuthorized,
      ownershipValid,
      blockerTransitionAllowed,
      appendExecutionEvent,
    })
    const taskModule = createTaskModule({
      db,
      transaction,
      execution,
      ownershipValid,
      appendExecutionEvent,
    })

    const completionModule = createCompletionModule({
      db,
      transaction,
      execution,
      completion,
      reviewClaim,
      ownershipValid,
      appendExecutionEvent,
      hasUnresolvedTasks: (executionID) => taskModule.hasUnresolvedTasks(executionID),
    })
    const admissionModule = createAdmissionModule({
      db,
      transaction,
      execution,
      invocationReviewAuthorized,
      attemptReviewAuthorized,
      reviewClaim,
      expertLimitReached,
      total,
      changeTotal,
      emitBudgetWarnings,
      ownershipValid,
      scopeIDs,
      executionBudgetScope,
      scopeMaxCost,
      touchExecution,
    })

    const projectionModule = createProjectionModule({
      db,
      transaction,
      completion,
      appendExecutionEvent,
      touchExecution,
      completionProjectionPageSize: COMPLETION_PROJECTION_PAGE_SIZE,
      maxPendingContinuations: MAX_PENDING_CONTINUATIONS,
    })
    const cancellationOutbox = createCancellationOutbox(db)
    const cancellationModule = createCancellationModule({
      db,
      transaction,
      execution,
      invocation,
      ownershipValid,
      cancellationOutbox,
      appendExecutionEvent,
      executionView,
      maxEvidenceBytes: MAX_BLOCKER_EVIDENCE_BYTES,
    })
    const lifecycleModule = createLifecycleModule({
      db,
      transaction,
      execution,
      invocation,
      ownershipValid,
      appendExecutionEvent,
      cancellationOutbox,
      tighten,
      tightenScopePolicy,
      executionBudgetScope,
      policy: Policy,
      log,
    })
    const bindingModule = createBindingModule(db)

    return {
      ...policyModule,
      execution(executionID: string) {
        return executionState(executionID)
      },

      executionLeaseActive(executionID: string, now = Date.now()) {
        const current = execution(executionID)
        return (
          !!current &&
          current.lifecycle !== "terminal" &&
          current.owner_id !== null &&
          current.lease_expires_at !== null &&
          now < current.lease_expires_at
        )
      },

      view(executionID: string) {
        return executionView(executionID)
      },

      hasUnresolvedExecutionTaskflow(executionID: string): boolean {
        return hasUnresolvedExecutionTaskflow(executionID)
      },

      hasRunningChild(executionID: string, callerInvocationID?: string): boolean {
        return !!db
          .query<{ id: string }, [string, string | null, string | null]>(
            `SELECT blocker.id FROM execution_blocker blocker
             JOIN execution_invocation child ON child.id = blocker.producer_id
             WHERE blocker.execution_id = ? AND blocker.kind = 'child' AND blocker.state = 'running'
               AND (? IS NULL OR child.parent_invocation_id = ?) LIMIT 1`,
          )
          .get(executionID, callerInvocationID ?? null, callerInvocationID ?? null)
      },

      ...createCheckpointModule({ db, transaction, execution, getPolicyState, appendExecutionEvent }),

      reserveToolAllowance(executionID: string): boolean {
        return reserveToolAllowance(executionID)
      },

      releaseToolAllowance(executionID: string): void {
        releaseToolAllowance(executionID)
      },

      ...createQueryModule({
        db,
        transaction,
        executionView,
        expireRouteProposals,
        currentEventSequence,
        eventEpoch,
        eventRetentionFloor,
        sessionGeneration,
        activeExecutionID,
        blockers: (executionID) => workModule.blockers(executionID),
        publicBlocker,
        invocationView,
        pendingRouteProposals,
      }),

      invocation(invocationID: string) {
        return invocation(invocationID)
      },

      blocker(blockerID: string) {
        return blocker(blockerID)
      },

      deadline(executionID: string) {
        return execution(executionID)?.deadline_at ?? undefined
      },

      activeOwned(ownerID: string) {
        return db
          .query<
            { executionID: string; rootSessionID: string; ownerID: string; fence: number },
            [string]
          >("SELECT id AS executionID, root_session_id AS rootSessionID, owner_id AS ownerID, fence FROM execution WHERE owner_id = ? AND lifecycle != 'terminal'")
          .all(ownerID)
      },

      routeProposal(id: string) {
        return routeProposal(id)
      },

      ...createRouteModule({
        db,
        transaction,
        execution,
        invocation,
        routeProposal,
        total,
        executionBudgetScope,
        ownershipValid,
        touchExecution,
        appendExecutionEvent,
      }),
      ...workModule,
      ...taskModule,
      ...completionModule,
      ...admissionModule,
      ...projectionModule,
      ...cancellationModule,
      ...lifecycleModule,
      ...bindingModule,

      getPolicyState(executionID: string) {
        return getPolicyState(executionID)
      },

      close() {
        db.close()
      },
    }
  }
}
