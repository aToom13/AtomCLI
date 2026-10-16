import { Bus } from "@/core/bus"
import { MessageV2 } from "@/core/session/message-v2"
import type { ExecutionLedger } from "../ledger"
import type { RuntimeTypes } from "./types"

type Ledger = ReturnType<typeof ExecutionLedger.open>
type ProposeRouteInput = Omit<Parameters<Ledger["proposeRoute"]>[0], "ownerID" | "fence" | "sessionGeneration"> & {
  sessionID: string
  execution: RuntimeTypes.Context
}
type ApplyRouteProposalInput = Omit<Parameters<Ledger["applyRouteProposal"]>[0], "ownerID" | "fence"> & {
  sessionID: string
  execution: RuntimeTypes.Context
}

type RouteRuntimeDependencies = {
  ledger: () => Ledger
  context: (
    sessionID: string,
    execution?: RuntimeTypes.Context,
  ) => Promise<{ store: Ledger; executionContext: RuntimeTypes.Context } | undefined>
  BudgetExceededError: new (reason: string, executionID?: string) => Error
  stopLease: (executionID: string, reason: string) => void
  event: {
    RouteProposal: Parameters<typeof Bus.publish>[0]
    RouteChanged: Parameters<typeof Bus.publish>[0]
    Updated: Parameters<typeof Bus.publish>[0]
  }
  maxContinuationPayloadBytes: number
}

export function createRouteRuntimeModule(input: RouteRuntimeDependencies) {
  const { ledger, context, BudgetExceededError, stopLease, event: Event, maxContinuationPayloadBytes } = input
  const MAX_CONTINUATION_PAYLOAD_BYTES = maxContinuationPayloadBytes
  function requestCancel(input: {
    requestID: string
    executionID: string
    sessionID: string
    projectID: string
    expectedVersion: number
    invocationID?: string
  }) {
    const result = ledger().requestCancel(input)
    if (result.accepted && !input.invocationID) stopLease(input.executionID, "not_active")
    return result
  }

  function requestReconcile(input: {
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
  }) {
    const result = ledger().requestReconcile(input)
    if (result.reconciled) {
      Bus.publish(Event.Updated, { sessionID: input.sessionID, executionID: input.executionID })
    }
    return result
  }

  function decideRouteProposal(input: {
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
  }) {
    const result = ledger().decideRouteProposal(input)
    if (result.decided) Bus.publish(Event.RouteProposal, { sessionID: input.sessionID, proposal: result.proposal })
    return result
  }

  function routeProposalHistory(executionID: string) {
    return ledger().routeProposalHistory(executionID)
  }

  async function proposeRoute(input: ProposeRouteInput) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const view = resolved.store.view(input.executionID)
    if (!view) throw new BudgetExceededError("not_active", input.execution.executionID)
    const { sessionID: _, execution: __, ...proposal } = input
    const result = resolved.store.proposeRoute({
      ...proposal,
      ownerID: resolved.executionContext.ownerID,
      fence: resolved.executionContext.fence,
      sessionGeneration: view.sessionGeneration,
    })
    if (result.proposed) Bus.publish(Event.RouteProposal, { sessionID: view.rootSessionID, proposal: result.proposal })
    return result
  }

  async function applyRouteProposal(input: ApplyRouteProposalInput) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const { sessionID: _, execution: __, ...proposal } = input
    const result = resolved.store.applyRouteProposal({
      ...proposal,
      ownerID: resolved.executionContext.ownerID,
      fence: resolved.executionContext.fence,
    })
    if (result.applied) {
      Bus.publish(Event.RouteProposal, {
        sessionID: resolved.executionContext.rootSessionID,
        proposal: result.proposal,
      })
      Bus.publish(Event.RouteChanged, {
        sessionID: resolved.executionContext.rootSessionID,
        executionID: input.executionID,
        routeRevision: result.routeRevision,
        route: result.proposal.toRoute,
        stage: result.proposal.scope === "expert" ? "expert" : "base",
      })
    }
    return result
  }

  async function returnFromExpert(input: {
    sessionID: string
    execution: RuntimeTypes.Context
    episodeID: string
    expectedRouteRevision: number
    message: MessageV2.User
    part: MessageV2.TextPart
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const payload = JSON.stringify({ message: input.message, part: input.part })
    if (new TextEncoder().encode(payload).byteLength > MAX_CONTINUATION_PAYLOAD_BYTES) {
      throw new Error(`Continuation payload exceeds ${MAX_CONTINUATION_PAYLOAD_BYTES} bytes`)
    }
    const id = `expert-handoff:${input.execution.executionID}:${input.episodeID}`
    const result = resolved.store.returnFromExpert({
      id,
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      invocationID: input.message.id,
      rootSessionID: input.execution.rootSessionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      episodeID: input.episodeID,
      expectedRouteRevision: input.expectedRouteRevision,
      payload,
    })
    if (!result.returned) throw new BudgetExceededError(result.reason, input.execution.executionID)
    Bus.publish(Event.RouteChanged, {
      sessionID: input.execution.rootSessionID,
      executionID: input.execution.executionID,
      routeRevision: result.routeRevision,
      route: result.route,
      stage: "base",
    })
    return { id, message: input.message, part: input.part, ...result }
  }

  return {
    requestCancel,
    requestReconcile,
    decideRouteProposal,
    routeProposalHistory,
    proposeRoute,
    applyRouteProposal,
    returnFromExpert,
  }
}
