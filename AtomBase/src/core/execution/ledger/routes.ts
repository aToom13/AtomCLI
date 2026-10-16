import { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"
import { LedgerTypes } from "./types"

const MAX_PENDING_CONTINUATIONS = 100

type CurrentExecution = {
  id: string
  status: string
  outcome: string | null
  fence: number
  owner_id: string | null
  deadline_at: number | null
  route_revision: number
  session_generation: number
  root_session_id: string
  project_id: string
  deleted_at: number | null
  budget_scope_id: string
  phase: string
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
  state: ExecutionLedger.RouteProposal["state"]
  version: number
  decision_id: string | null
  actor_id: string | null
  accept_scope: "episode" | "execution" | null
  created_at: number
  decided_at: number | null
  applied_at: number | null
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): CurrentExecution | undefined
  invocation(invocationID: string): ExecutionLedger.Invocation | undefined
  routeProposal(id: string): ExecutionLedger.RouteProposal | undefined
  total(scopeID: string): { calls: number; steps: number }
  executionBudgetScope(current: CurrentExecution): string
  ownershipValid(current: CurrentExecution, ownerID: string | undefined, fence: number, now: number): boolean
  touchExecution(
    executionID: string,
    now: number,
    type: ExecutionLedger.EventType,
    properties: Record<string, unknown>,
  ): void
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties: Record<string, unknown>,
  ): void
}

export function createRouteModule(ctx: Context) {
  const { db, transaction } = ctx

  return {
    routeProposalHistory(executionID: string, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("route proposal limit is invalid")
      return db
        .query<{ id: string }, [string, number]>(
          "SELECT id FROM route_proposal WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(executionID, limit)
        .map((row) => ctx.routeProposal(row.id)!)
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
      fromRoute: ExecutionLedger.Route
      toRoute: ExecutionLedger.Route
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
        const current = ctx.execution(input.executionID)
        if (!current || current.status !== "active" || current.outcome !== null)
          return { proposed: false as const, reason: "not_active" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now))
          return { proposed: false as const, reason: "stale_fence" as const }
        if (current.deadline_at !== null && now >= current.deadline_at)
          return { proposed: false as const, reason: "deadline" as const }
        if (current.route_revision !== input.expectedRouteRevision)
          return { proposed: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
        if (current.session_generation !== input.sessionGeneration)
          return { proposed: false as const, reason: "stale_generation" as const }
        const source = ctx.invocation(input.invocationID)
        if (
          !source ||
          source.executionID !== input.executionID ||
          !["accepted", "running", "waiting"].includes(source.state)
        )
          return { proposed: false as const, reason: "invalid_invocation" as const }
        if (input.expiresAt <= now) return { proposed: false as const, reason: "expired" as const }
        const fromRoute = LedgerTypes.Route.parse(input.fromRoute)
        const toRoute = LedgerTypes.Route.parse(input.toRoute)
        const routeRow = db
          .query<
            { current_route: string; route_revision: number; manual_model_pin: number; manual_thinking_pin: number },
            [string]
          >("SELECT current_route, route_revision, manual_model_pin, manual_thinking_pin FROM execution_route WHERE execution_id = ?")
          .get(input.executionID)
        if (
          routeRow &&
          (routeRow.route_revision !== current.route_revision || routeRow.current_route !== JSON.stringify(fromRoute))
        )
          return { proposed: false as const, reason: "stale_route" as const, routeRevision: current.route_revision }
        if (
          input.autoAccept &&
          ((input.scope === "thinking" && (input.manualThinkingPin || routeRow?.manual_thinking_pin === 1)) ||
            (input.scope !== "thinking" &&
              (input.manualModelPin ||
                input.manualThinkingPin ||
                routeRow?.manual_model_pin === 1 ||
                routeRow?.manual_thinking_pin === 1)))
        )
          return { proposed: false as const, reason: "manual_pin" as const }
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
          return { proposed: true as const, idempotent: true, proposal: ctx.routeProposal(existing.id)! }
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
        ctx.touchExecution(input.executionID, now, "route.proposal.updated", {
          proposalID: input.id,
          state: initialState,
        })
        return { proposed: true as const, idempotent: false, proposal: ctx.routeProposal(input.id)! }
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
          const proposal = ctx.routeProposal(input.proposalID)
          return proposal
            ? { decided: true as const, idempotent: true, proposal }
            : { decided: false as const, reason: "not_found" as const }
        }
        const current = ctx.execution(input.executionID)
        const proposal = ctx.routeProposal(input.proposalID)
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
          ctx.touchExecution(input.executionID, now, "route.proposal.updated", {
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
        ctx.touchExecution(input.executionID, now, "route.proposal.updated", { proposalID: input.proposalID, state })
        const updated = ctx.routeProposal(input.proposalID)!
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
        const current = ctx.execution(input.executionID)
        const proposal = ctx.routeProposal(input.proposalID)
        if (!current || !proposal || proposal.executionID !== input.executionID)
          return { applied: false as const, reason: "not_found" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now))
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
        const executionUsage = ctx.total(ctx.executionBudgetScope(current))
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
        ctx.appendExecutionEvent(input.executionID, "execution.route.changed", now, {
          proposalID: input.proposalID,
          route: proposal.toRoute,
        })
        return {
          applied: true as const,
          proposal: ctx.routeProposal(input.proposalID)!,
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
        const current = ctx.execution(input.executionID)
        if (!current || current.status !== "active" || current.outcome !== null)
          return { returned: false as const, reason: "not_active" as const }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now))
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
        const baseRoute = LedgerTypes.Route.parse(JSON.parse(route.base_route))
        ctx.appendExecutionEvent(input.executionID, "execution.route.changed", now, {
          episodeID: input.episodeID,
          route: baseRoute,
        })
        return { returned: true as const, routeRevision: input.expectedRouteRevision + 1, route: baseRoute }
      })
    },
  }
}
