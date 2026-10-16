import path from "path"
import z from "zod"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import type { Provider } from "@/integrations/provider/provider"
import { Token } from "@/util/util/token"
import type { LanguageModelUsage, ProviderMetadata } from "ai"
import { Log } from "@/util/util/log"
import { ExecutionLedger } from "./ledger"
import { Storage } from "@/core/storage/storage"
import { Bus } from "@/core/bus"
import { BusEvent } from "@/core/bus/bus-event"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import * as RouteGuidanceStore from "./route-guidance"
import { createLeaseManager } from "./lease"
import { createExecutionStateStore } from "./runtime/state"
import {
  parseClaimOrRecordRecovery as parseClaimOrRecordRecoveryImpl,
  parseCompletion as parseCompletionImpl,
} from "./runtime/completion"
import { createCheckpointRuntimeModule } from "./runtime/checkpoint-runtime"
import { createWorkRuntimeModule } from "./runtime/work"
import { createCompletionLifecycle } from "./runtime/completion-lifecycle"
import { createRouteRuntimeModule } from "./runtime/routing"
import { createEvidenceRuntime } from "./runtime/evidence"
import { createTaskRuntimeModule } from "./runtime/task"
import type { RuntimeTypes } from "./runtime/types"
import {
  configuredReviewPolicy as configuredReviewPolicyImpl,
  contentSnapshotDigest as contentSnapshotDigestImpl,
  policy as policyImpl,
} from "./runtime/policy"

export namespace ExecutionRuntime {
  export type ExecutionState = import("./runtime/state").ExecutionState
  const log = Log.create({ service: "execution-runtime" })
  const runID = `${process.pid}:${crypto.randomUUID()}`
  const OWNER_LEASE_MS = 30_000
  const OWNER_HEARTBEAT_MS = 10_000
  const PROJECTION_LEASE_MS = 30_000
  const MAX_COMPLETION_PAYLOAD_BYTES = 2 * 1024 * 1024
  const MAX_COMPLETION_REVIEW_BYTES = 512 * 1024
  const MAX_CONTINUATION_PAYLOAD_BYTES = 64 * 1024
  const MAX_COMPLETION_EDITED_FILES = 1_000
  const ledgers = new Map<string, ReturnType<typeof ExecutionLedger.open>>()

  function hasRepeatedTail(values: string[] | undefined, count: number) {
    if (!values || values.length < count) return false
    const tail = values.slice(-count)
    return Boolean(tail[0]) && tail.every((value) => value === tail[0])
  }

  export const Event = {
    RouteProposal: BusEvent.define(
      "execution.route.proposal",
      z.object({ sessionID: z.string(), proposal: ExecutionLedger.RouteProposal }),
    ),
    RouteChanged: BusEvent.define(
      "execution.route.changed",
      z.object({
        sessionID: z.string(),
        executionID: z.string(),
        routeRevision: z.number().int().positive(),
        route: ExecutionLedger.Route,
        stage: z.enum(["base", "expert"]),
      }),
    ),
    Updated: BusEvent.define(
      "execution.updated",
      z.object({
        sessionID: z.string(),
        executionID: z.string(),
      }),
    ),
    TaskUpdated: BusEvent.define(
      "execution.task.updated",
      z.object({
        sessionID: z.string(),
        executionID: z.string(),
        taskID: z.string(),
        status: ExecutionLedger.TaskStatus,
        revision: z.number().int().positive(),
        version: z.number().int().positive(),
      }),
    ),
    ScopeChanged: BusEvent.define(
      "execution.scope.changed",
      z.object({
        sessionID: z.string(),
        executionID: z.string(),
        from: ExecutionContract.Scope,
        to: ExecutionContract.Scope,
        reason: z.string(),
      }),
    ),
    Checkpoint: BusEvent.define(
      "execution.checkpoint",
      z.object({
        sessionID: z.string(),
        executionID: z.string(),
        // Assistant message that owns the checkpoint part; lets event
        // consumers (Companion live stream) bind the checkpoint to a message.
        messageID: z.string(),
        triggerMessageID: z.string().optional(),
        sequence: z.number().int().positive(),
        checkpoint: z.unknown(),
      }),
    ),
  }

  export class BudgetExceededError extends Error {
    constructor(
      readonly reason: string,
      readonly executionID?: string,
      readonly detail?: string,
    ) {
      const isBudget = [
        "deadline",
        "call_limit",
        "step_limit",
        "checkpoint_required",
        "cost_limit",
        "unknown_price",
      ].includes(reason)
      const message = isBudget
        ? `Execution budget blocked the request: ${reason}`
        : reason === "recovery_required"
          ? `Execution recovery required: ${detail ?? "previous mutating work must be reconciled"}`
          : detail
            ? `Execution blocked: ${reason} (${detail})`
            : `Execution blocked: ${reason}`
      super(message)
      this.name = "ExecutionBudgetExceededError"
    }
  }

  function ledger() {
    const filepath = path.join(Global.Path.data, "execution-ledger.sqlite")
    let current = ledgers.get(filepath)
    if (!current) {
      current = ExecutionLedger.open(filepath)
      ledgers.set(filepath, current)
    }
    return current
  }

  export function scopeFloor(sessionID: string) {
    return ledger().scopeFloor(sessionID)
  }

  export function scopeEscalationStatus(sessionID: string) {
    return ledger().scopeEscalationStatus(sessionID)
  }

  export function raiseScopeFloor(sessionID: string, scope: ExecutionContract.Scope) {
    return ledger().raiseScopeFloor(sessionID, scope)
  }

  export function resetScopeFloor(sessionID: string) {
    ledger().resetScopeFloor(sessionID)
  }

  const leaseManager = createLeaseManager({
    ledger: {
      deadline: (executionID) => ledger().deadline(executionID),
      renewOwner: (input) => ledger().renewOwner(input),
    },
    log,
    ownerLeaseMs: OWNER_LEASE_MS,
    heartbeatMs: OWNER_HEARTBEAT_MS,
    makeError: (reason, executionID) => new BudgetExceededError(reason, executionID),
  })
  const { stopLease, ensureLease } = leaseManager
  export const renewLease = leaseManager.renewLease
  export const leaseSignal = leaseManager.leaseSignal
  export const holdLease = leaseManager.holdLease

  // Route guidance accumulates self-critique and failed approaches across
  // checkpoints so the next work slice prompt can steer the model away from
  // repeated failures. Keyed by executionID; lightweight and append-only.
  // Unlike execution policy state this is not reloadable from the ledger, so it
  // is bounded by TTL and by a hard cap instead — it is a soft steering hint, and
  // losing an idle entry only costs a less-informed next slice.
  const executionState = createExecutionStateStore({
    ledger,
    warn: (message, data) => log.warn(message, data),
  })
  const getExecutionState = executionState.get
  const setExecutionState = executionState.set
  const pruneExecutionStates = executionState.prune

  export const _internals = {
    pruneExecutionStates,
    EXECUTION_STATE_TTL_MS: executionState.limits.ttlMs,
    MAX_EXECUTION_STATES: executionState.limits.maxEntries,
    pruneRouteGuidance: (now = Date.now()) =>
      RouteGuidanceStore.prune(now, (executionID) => ledger().view(executionID)?.lifecycle === "terminal"),
    ROUTE_GUIDANCE_TTL_MS: RouteGuidanceStore.limits.ttlMs,
    MAX_ROUTE_GUIDANCE: RouteGuidanceStore.limits.maxEntries,
    seedRouteGuidance: RouteGuidanceStore.seed,
  }

  export function setExecutionContract(
    executionID: string,
    contract: ExecutionContract.Info,
    options?: { classifierFallback?: boolean; acceptanceChange?: ExecutionContract.Info["acceptanceChange"] },
  ): ExecutionPolicy.PolicyInfo {
    const existing = getExecutionState(executionID)
    let evidence = existing?.evidence ?? {}
    const acceptance = contract.acceptance ?? existing?.contract.acceptance
    const changed = !Bun.deepEquals(acceptance, existing?.contract.acceptance)
    if (changed && existing?.contract.acceptance?.length && !options?.acceptanceChange)
      throw new Error("Acceptance revision requires a concrete user, skill, platform or runtime reason")
    contract = {
      ...contract,
      acceptance,
      acceptanceRevision: (existing?.contract.acceptanceRevision ?? 0) + (changed ? 1 : 0),
      acceptanceChange: changed
        ? ExecutionContract.Info.shape.acceptanceChange.parse(
            options?.acceptanceChange ?? {
              reason: "initial_classification",
              detail: "Evidence requirements derived before mutation",
              invalidatedEvidence: [],
            },
          )
        : existing?.contract.acceptanceChange,
    }
    if (changed && existing?.contract.acceptance?.length)
      evidence = { ...evidence, browserNavigations: 0, browserVerificationCalls: 0 }
    const policy = ExecutionPolicy.resolvePolicy(contract, evidence, existing?.promotionReasons ?? [], existing?.policy)
    setExecutionState(executionID, {
      contract,
      policy,
      evidence,
      promotionReasons: policy.promotionReasons,
      classifierFallback: options?.classifierFallback ?? false,
    })
    log.info("execution contract set", {
      executionID,
      scope: contract.scope,
      risk: contract.risk,
      diagnostics: policy.diagnostics,
    })
    return policy
  }

  export function getExecutionContract(executionID: string): ExecutionContract.Info | undefined {
    return getExecutionState(executionID)?.contract
  }

  export function getExecutionPolicy(executionID: string): ExecutionPolicy.PolicyInfo | undefined {
    return getExecutionState(executionID)?.policy
  }

  export function getExecutionEvidence(executionID: string): ExecutionPolicy.RuntimeEvidence | undefined {
    return getExecutionState(executionID)?.evidence
  }

  export function isClassifierFallback(executionID: string): boolean {
    return getExecutionState(executionID)?.classifierFallback ?? false
  }

  export async function escalateScope(input: {
    sessionID: string
    execution: Context
    scope: ExecutionContract.Scope
    reason: string
    actorID: string
  }) {
    if (input.sessionID !== input.execution.rootSessionID)
      throw new BudgetExceededError("scope_escalation_root_only", input.execution.executionID)
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const existing = getExecutionState(input.execution.executionID)
    if (!existing) throw new BudgetExceededError("policy_unavailable", input.execution.executionID)
    const currentScope = existing.policy.scope
    if (ExecutionPolicy.SCOPE_RANK[input.scope] <= ExecutionPolicy.SCOPE_RANK[currentScope]) {
      return { changed: false as const, scope: currentScope, policy: existing.policy }
    }
    const config = await Config.get()
    const settings = {
      maxPerSession: config.experimental?.scope_escalation?.max_per_session ?? 20,
      cooldownMs: config.experimental?.scope_escalation?.cooldown_ms ?? 0,
    }
    const contract = {
      ...existing.contract,
      scope: input.scope,
      likelyCrossBoundary: input.scope === "coordinated" || existing.contract.likelyCrossBoundary,
      rationale: `${existing.contract.rationale} Scope escalated: ${input.reason}`.trim(),
    }
    const policy = ExecutionPolicy.resolvePolicy(
      contract,
      existing.evidence,
      [...existing.promotionReasons, `Scope escalated to ${input.scope}: ${input.reason}`],
      existing.policy,
    )
    const budget = resolved.store.view(input.execution.executionID)?.budget.execution
    const grantedCalls =
      budget?.calls.limit === undefined
        ? Math.max(0, policy.budget.maxToolCalls - existing.policy.budget.maxToolCalls)
        : 0
    const grantedSteps =
      budget?.steps.limit === undefined ? Math.max(0, policy.budget.maxSteps - existing.policy.budget.maxSteps) : 0
    const applied = resolved.store.applyScopeEscalation({
      executionID: input.execution.executionID,
      scope: input.scope,
      contract,
      policy,
      promotionReasons: policy.promotionReasons,
      reason: input.reason,
      actorID: input.actorID,
      grantedCalls,
      grantedSteps,
      maxPerSession: settings.maxPerSession,
      cooldownMs: settings.cooldownMs,
    })
    if (!applied.allowed) throw new BudgetExceededError(applied.reason, input.execution.executionID)
    setExecutionState(input.execution.executionID, {
      ...existing,
      contract,
      policy,
      promotionReasons: policy.promotionReasons,
    })
    await Bus.publish(Event.ScopeChanged, {
      sessionID: input.sessionID,
      executionID: input.execution.executionID,
      from: currentScope,
      to: input.scope,
      reason: input.reason,
    })
    return { changed: true as const, scope: input.scope, policy, grantedCalls, grantedSteps }
  }

  const evidenceRuntime = createEvidenceRuntime({
    ledger,
    getState: getExecutionState,
    setState: setExecutionState,
    updateState: executionState.update,
    makeBudgetError: (reason, executionID) => new BudgetExceededError(reason, executionID),
    logPromotion: (kind, data) => log.info(`execution ${kind} promoted`, data),
    hasRepeatedTail,
  })
  const hasNewEvidencePath = evidenceRuntime.hasNewEvidencePath
  export const resolveExecutionPolicy = evidenceRuntime.resolveExecutionPolicy
  export const promoteScope = evidenceRuntime.promoteScope
  export const promoteRisk = evidenceRuntime.promoteRisk
  export const recordRuntimeEvidence = evidenceRuntime.recordRuntimeEvidence
  export const isCheckpointRequired = evidenceRuntime.isCheckpointRequired
  export const checkpointReason = evidenceRuntime.checkpointReason
  export const requestCheckpoint = evidenceRuntime.requestCheckpoint
  export const admitToolCall = evidenceRuntime.admitToolCall
  export const reserveToolCall = evidenceRuntime.reserveToolCall
  export const releaseToolCall = evidenceRuntime.releaseToolCall
  export const recordToolCall = evidenceRuntime.recordToolCall
  export const recordSemanticActionResult = evidenceRuntime.recordSemanticActionResult

  async function rootSession(sessionID: string) {
    let current = await Session.get(sessionID)
    const projectID = current.projectID
    const visited = new Set<string>()
    while (current.parentID) {
      if (visited.has(current.id)) throw new Error("Cyclic session ancestry")
      visited.add(current.id)
      current = await Session.get(current.parentID)
      if (current.projectID !== projectID) throw new Error("Session ancestry crosses project boundary")
    }
    return current
  }

  export function estimateMicrousd(model: Provider.Model, input: string, maxOutputTokens: number) {
    if (model.options?._catalogCostKnown === false) return
    if (!model.cost || !Number.isFinite(model.cost.input) || !Number.isFinite(model.cost.output)) return
    return Math.ceil(Token.estimate(input) * model.cost.input + maxOutputTokens * model.cost.output)
  }

  export function usageCostUsd(model: Provider.Model, usage: LanguageModelUsage, metadata?: ProviderMetadata) {
    return Session.getUsage({ model, usage, metadata }).cost
  }

  export type Attempt = {
    executionID: string
    attemptID: string
    signal: AbortSignal
    settle(costUsd: number): void
    uncertain(): void
  }

  export type Context = RuntimeTypes.Context
  export type Completion = RuntimeTypes.Completion
  export type CompletionClaim = RuntimeTypes.CompletionClaim
  export type ReviewDecision = RuntimeTypes.ReviewDecision
  export type TerminalFailure = RuntimeTypes.TerminalFailure

  export function classifyTerminalFailure(error: unknown, aborted = false): TerminalFailure {
    const errorRecord =
      typeof error === "object" && error !== null
        ? (error as { name?: unknown; reason?: unknown; detail?: unknown })
        : undefined
    const budgetReason =
      error instanceof BudgetExceededError
        ? error.reason
        : errorRecord?.name === "ExecutionBudgetExceededError" && typeof errorRecord.reason === "string"
          ? errorRecord.reason
          : undefined
    if (budgetReason === "checkpoint_required") {
      throw new Error("checkpoint_required is a resumable control signal and cannot become a terminal outcome")
    }
    if (
      budgetReason &&
      ["deadline", "call_limit", "step_limit", "cost_limit", "unknown_price"].includes(budgetReason)
    ) {
      const reasonCode = ExecutionLedger.ReasonCode.parse(budgetReason)
      const messages: Record<string, string> = {
        deadline: "The execution reached its configured deadline.",
        call_limit: "The execution reached its configured model-call limit.",
        step_limit: "The execution reached its configured step limit.",
        cost_limit: "The execution reached its configured cost limit.",
        unknown_price: "The execution budget requires a known model price.",
      }
      return { outcome: "budget_exhausted", reasonCode, reasonMessage: messages[reasonCode], retryable: false }
    }
    if (budgetReason === "recovery_required") {
      return {
        outcome: "failed",
        reasonCode: "recovery_required",
        reasonMessage:
          (error instanceof BudgetExceededError && error.detail) ||
          (typeof errorRecord?.detail === "string" ? errorRecord.detail : undefined) ||
          "The session has unknown mutating work that must be reconciled.",
        // Reconciliation must happen before a new root can start. Resuming this
        // execution would replay the uncertain mutating call.
        retryable: false,
      }
    }
    if (aborted || (error instanceof Error && error.name === "AbortError")) {
      return {
        outcome: "cancelled",
        reasonCode: "user_cancelled",
        reasonMessage: "The execution was cancelled before it completed.",
        retryable: false,
      }
    }
    const message = error instanceof Error ? error.message.toLowerCase() : ""
    if (message.includes("no verified") || message.includes("verified free model")) {
      return {
        outcome: "failed",
        reasonCode: "no_verified_model",
        reasonMessage: "No verified eligible model is currently available for this route.",
        retryable: true,
      }
    }
    if (message.includes("verification")) {
      return {
        outcome: "failed",
        reasonCode: "verification_required",
        reasonMessage: "The selected model route could not be verified.",
        retryable: true,
      }
    }
    return {
      outcome: "failed",
      reasonCode: "provider_unavailable",
      reasonMessage: "The selected provider or model could not complete this execution.",
      retryable: true,
    }
  }

  const parseCompletion = parseCompletionImpl
  const parseClaimOrRecordRecovery = (candidate: ExecutionLedger.CompletionClaim) =>
    parseClaimOrRecordRecoveryImpl(
      candidate,
      (input) => ledger().markProjectionRecovery(input),
      (error, executionID) => log.error("completion projection payload is invalid", { error, executionID }),
    )

  const policy = policyImpl

  const configuredReviewPolicy = configuredReviewPolicyImpl

  const contentSnapshotDigest = contentSnapshotDigestImpl

  export async function resolveInvocation(input: {
    sessionID: string
    invocationID: string
    kind?: ExecutionLedger.InvocationKind
    acceptedMessageID?: string
    resumesExecutionID?: string
  }): Promise<Context> {
    const store = ledger()
    const existing = store.binding(input.invocationID)
    const session = await Session.get(input.sessionID)
    const root = await rootSession(input.sessionID)
    const waitingContinuation =
      !existing && !session.parentID && !input.resumesExecutionID && (input.kind === undefined || input.kind === "root")
        ? store.waitingInput(input.sessionID)
        : undefined
    const reviewerInvocationID =
      input.kind === "reviewer"
        ? store.snapshot(root.id).activeInvocations.find((invocation) => invocation.sessionID === input.sessionID)?.id
        : undefined
    const inherited =
      existing ??
      waitingContinuation ??
      (session.parentID ? (store.active(input.sessionID) ?? store.active(session.parentID)) : undefined)
    const candidate: Context = inherited
      ? { ...inherited, invocationID: input.invocationID }
      : {
          executionID: `${root.id}:${input.invocationID}`,
          rootSessionID: root.id,
          invocationID: input.invocationID,
          ownerID: runID,
          fence: 1,
        }
    const config = await Config.get()
    const sessionGuard = await Storage.sessionGuard(root.id)
    store.start({
      id: candidate.executionID,
      projectID: root.projectID,
      rootSessionID: candidate.rootSessionID,
      fence: candidate.fence,
      sessionGeneration: sessionGuard?.generation ?? 1,
      resumesExecutionID: input.resumesExecutionID ?? store.view(candidate.executionID)?.resumesExecutionID,
      policy: config.execution_budget ? policy(config.execution_budget) : {},
    })
    const ownership = store.claimOwner({
      executionID: candidate.executionID,
      ownerID: runID,
      leaseMs: OWNER_LEASE_MS,
    })
    if (!ownership.acquired) throw new BudgetExceededError(ownership.reason, candidate.executionID)
    const context: Context = {
      ...candidate,
      ownerID: runID,
      fence: ownership.fence,
    }
    let bound: Context | undefined
    try {
      bound = store.bind({
        ...context,
        sessionID: input.sessionID,
        kind: input.kind,
        acceptedMessageID: input.acceptedMessageID ?? input.invocationID,
        replacesInvocationID:
          waitingContinuation?.invocationID ??
          (reviewerInvocationID !== input.invocationID ? reviewerInvocationID : undefined),
      })
    } catch (error) {
      if (!inherited) store.cancel(context)
      throw error
    }
    if (!bound) {
      const view = store.view(candidate.executionID)
      const reasonCode = view?.reason?.code ?? "recovery_required"
      const reasonMessage = view?.reason?.message
      log.warn("execution invocation bind rejected", {
        sessionID: input.sessionID,
        executionID: candidate.executionID,
        reasonCode,
        reasonMessage,
      })
      throw new BudgetExceededError("recovery_required", candidate.executionID, reasonMessage)
    }
    return bound
  }

  export async function inheritSession(parentSessionID: string, childSessionID: string) {
    return ledger().inherit({ parentSessionID, childSessionID })
  }

  export async function bindContinuation(input: {
    sessionID: string
    invocationID: string
    execution: Context
  }): Promise<Context> {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const bound = resolved.store.bind({
      ...resolved.executionContext,
      invocationID: input.invocationID,
      sessionID: input.sessionID,
      replacesInvocationID: input.execution.invocationID,
      acceptedMessageID: input.invocationID,
    })
    if (!bound) {
      const view = resolved.store.view(input.execution.executionID)
      const reasonCode = view?.reason?.code ?? "recovery_required"
      const reasonMessage = view?.reason?.message
      log.warn("execution continuation bind rejected", {
        sessionID: input.sessionID,
        executionID: input.execution.executionID,
        reasonCode,
        reasonMessage,
      })
      throw new BudgetExceededError("recovery_required", input.execution.executionID, reasonMessage)
    }
    return bound
  }

  // Subscribe before reading the ledger so a fast approval cannot be missed.
  export async function waitForRouteDecision(sessionID: string, execution: Context, signal: AbortSignal) {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: unknown) => {
        unsubscribe()
        clearTimeout(timer)
        signal.removeEventListener("abort", aborted)
        if (error) reject(error)
        else resolve()
      }
      const aborted = () => finish(signal.reason ?? new Error("Aborted"))
      const check = () => {
        clearTimeout(timer)
        const pending = snapshot(sessionID).pendingProposals.find(
          (proposal) =>
            proposal.executionID === execution.executionID &&
            proposal.invocationID === execution.invocationID &&
            proposal.state === "pending",
        )
        if (!pending) return finish()
        timer = setTimeout(check, Math.max(1, pending.expiresAt - Date.now()))
      }
      const unsubscribe = Bus.subscribe(Event.RouteProposal, (event) => {
        if (event.properties.proposal.executionID === execution.executionID) check()
      })
      signal.addEventListener("abort", aborted, { once: true })
      check()
    })
  }

  export function events(sessionID: string, cursor: ExecutionLedger.Cursor | number = 0, limit = 100) {
    return typeof cursor === "number"
      ? ledger().events({ sessionID, afterSequence: cursor, limit })
      : ledger().events({ sessionID, cursor, limit })
  }

  export function mutationRevision(executionID: string) {
    return ledger().revision(executionID)
  }

  async function legacyInvocation(sessionID: string) {
    const root = await rootSession(sessionID)
    const messages = await Session.messages({ sessionID: root.id, excludePatches: true })
    const invocationID =
      messages.findLast(
        (message) =>
          message.info.role === "user" &&
          message.parts.some((part) => part.type !== "text" || !(part as MessageV2.TextPart).synthetic),
      )?.info.id ?? root.id
    return sessionID === root.id ? invocationID : `${invocationID}:${sessionID}`
  }

  async function context(sessionID: string, supplied?: Context, settleWork = false) {
    const config = await Config.get()
    const budget = config.execution_budget
    if (!budget && !supplied) return
    const executionContext =
      supplied ?? (await resolveInvocation({ sessionID, invocationID: await legacyInvocation(sessionID) }))
    const root = await rootSession(sessionID)
    if (root.id !== executionContext.rootSessionID)
      throw new BudgetExceededError("not_active", executionContext.executionID)
    const store = ledger()
    store.start({
      id: executionContext.executionID,
      projectID: root.projectID,
      rootSessionID: executionContext.rootSessionID,
      fence: executionContext.fence,
      resumesExecutionID: store.view(executionContext.executionID)?.resumesExecutionID,
      policy: budget ? policy(budget) : {},
    })
    if (executionContext.ownerID !== runID) {
      throw new BudgetExceededError("stale_fence", executionContext.executionID)
    }
    const activeInvocation = store.invocation(executionContext.invocationID)
    if (
      !activeInvocation ||
      activeInvocation.executionID !== executionContext.executionID ||
      (!settleWork && !["accepted", "running", "waiting"].includes(activeInvocation.state))
    ) {
      throw new BudgetExceededError("not_active", executionContext.executionID)
    }
    // Only existing work may settle after cancellation/deadline. The ledger
    // still checks its owner, fence, lease and CAS version; no admission occurs.
    if (settleWork) return { budget, executionContext, store }
    const deadline = store.deadline(executionContext.executionID)
    if (deadline !== undefined && Date.now() >= deadline) {
      stopLease(executionContext.executionID, "deadline")
      throw new BudgetExceededError("deadline", executionContext.executionID)
    }
    const renewal = store.renewOwner({
      executionID: executionContext.executionID,
      ownerID: executionContext.ownerID,
      fence: executionContext.fence,
      leaseMs: OWNER_LEASE_MS,
    })
    if (!renewal.renewed) throw new BudgetExceededError(renewal.reason, executionContext.executionID)
    return { budget, executionContext, store }
  }

  const completionLifecycle = createCompletionLifecycle({
    ledger,
    context,
    runID,
    projectionLeaseMs: PROJECTION_LEASE_MS,
    maxContinuationPayloadBytes: MAX_CONTINUATION_PAYLOAD_BYTES,
    maxCompletionPayloadBytes: MAX_COMPLETION_PAYLOAD_BYTES,
    maxCompletionReviewBytes: MAX_COMPLETION_REVIEW_BYTES,
    maxCompletionEditedFiles: MAX_COMPLETION_EDITED_FILES,
    parseCompletion,
    parseClaimOrRecordRecovery,
    configuredReviewPolicy,
    contentSnapshotDigest,
    BudgetExceededError,
    stopLease,
  })
  export const pendingCompletions = completionLifecycle.pendingCompletions
  export const claimCompletions = completionLifecycle.claimCompletions
  export const claimCompletion = completionLifecycle.claimCompletion
  export const ackCompletion = completionLifecycle.ackCompletion
  export const markProjectionRecovery = completionLifecycle.markProjectionRecovery
  export const deleteSessions = completionLifecycle.deleteSessions
  export const pendingContinuations = completionLifecycle.pendingContinuations
  export const projectContinuation = completionLifecycle.projectContinuation
  export const retryCompletion = completionLifecycle.retryCompletion
  export const stageCompletion = completionLifecycle.stageCompletion
  export const claimReview = completionLifecycle.claimReview
  export const recordQAReview = completionLifecycle.recordQAReview
  export const qaReviewPassed = completionLifecycle.qaReviewPassed
  export const authorizeReviewSession = completionLifecycle.authorizeReviewSession
  export const recordReview = completionLifecycle.recordReview
  export const commitCompletion = completionLifecycle.commitCompletion
  export const finalizeBlocked = completionLifecycle.finalizeBlocked
  export const finalizeOutcome = completionLifecycle.finalizeOutcome
  export const discardCompletion = completionLifecycle.discardCompletion

  const routeRuntime = createRouteRuntimeModule({
    ledger,
    context,
    BudgetExceededError,
    stopLease,
    event: Event,
    maxContinuationPayloadBytes: MAX_CONTINUATION_PAYLOAD_BYTES,
  })
  export const requestCancel = routeRuntime.requestCancel
  export const requestReconcile = routeRuntime.requestReconcile
  export const decideRouteProposal = routeRuntime.decideRouteProposal
  export const routeProposalHistory = routeRuntime.routeProposalHistory
  export const proposeRoute = routeRuntime.proposeRoute
  export const applyRouteProposal = routeRuntime.applyRouteProposal
  export const returnFromExpert = routeRuntime.returnFromExpert

  const workRuntime = createWorkRuntimeModule({
    context,
    BudgetExceededError,
    publishUpdated: (sessionID, executionID) => Bus.publish(Event.Updated, { sessionID, executionID }),
  })
  const taskRuntime = createTaskRuntimeModule({
    context,
    BudgetExceededError,
    publishTaskUpdated: (event) => Bus.publish(Event.TaskUpdated, event),
  })
  export const assertActive = workRuntime.assertActive
  export const registerWork = workRuntime.registerWork
  export const beginWork = workRuntime.beginWork
  export const finishWork = workRuntime.finishWork
  export const reconcileWork = workRuntime.reconcileWork
  export const registerBlocker = workRuntime.registerBlocker
  export const createPlan = workRuntime.createPlan
  export const transitionBlocker = workRuntime.transitionBlocker
  export const registerTask = taskRuntime.registerTask
  export const getTask = taskRuntime.getTask
  export const startAtomicWork = taskRuntime.startAtomicWork
  export const queueAtomicMessage = taskRuntime.queueAtomicMessage
  export const updateAtomicPlan = taskRuntime.updateAtomicPlan
  export const assertAtomicReady = taskRuntime.assertAtomicReady
  export const beginAtomicAttempt = taskRuntime.beginAtomicAttempt
  export const pauseAtomicTask = taskRuntime.pauseAtomicTask
  export const setAtomicTaskSession = taskRuntime.setAtomicTaskSession

  export function atomicRoot(executionID: string) {
    return ledger().atomicRoot(executionID)
  }

  export function atomicPending(executionID: string) {
    return ledger().atomicPending(executionID)
  }

  export function activeContext(sessionID: string) {
    const store = ledger()
    const waiting = store.waitingInput(sessionID)
    if (waiting) return waiting
    const active = store.active(sessionID)
    if (!active) return
    const invocation = store
      .snapshot(active.rootSessionID)
      .activeInvocations.findLast((item) => item.sessionID === sessionID)
    return invocation ? store.binding(invocation.id) : undefined
  }
  export const transitionTask = taskRuntime.transitionTask
  export const recordTaskChecks = taskRuntime.recordTaskChecks
  export const recordAutomaticTaskChecks = taskRuntime.recordAutomaticTaskChecks
  export const recordTaskVerification = taskRuntime.recordTaskVerification
  export const invalidateOpenTasks = taskRuntime.invalidateOpenTasks
  export const invalidateTaskDependents = taskRuntime.invalidateTaskDependents

  export function tasks(executionID: string) {
    return ledger().tasks(executionID)
  }
  export const recordMutation = workRuntime.recordMutation

  export function cancelSession(sessionID: string) {
    const store = ledger()
    const active = store.active(sessionID)
    if (!active || active.ownerID !== runID) return false
    return cancelExecution(active)
  }

  export function cancelOwnedExecutions() {
    for (const execution of ledger().activeOwned(runID)) cancelExecution(execution, { allowExpiredOwner: true })
  }

  export function cancelExecution(execution: Omit<Context, "invocationID">, options?: { allowExpiredOwner?: boolean }) {
    if (execution.ownerID !== runID) return false
    const cancelled = ledger().cancel({
      executionID: execution.executionID,
      ownerID: execution.ownerID,
      fence: execution.fence,
      allowExpiredOwner: options?.allowExpiredOwner,
    }).cancelled
    if (cancelled) stopLease(execution.executionID, "not_active")
    return cancelled
  }

  export function cancelInvocation(execution: Context) {
    if (execution.ownerID !== runID) return false
    return ledger().cancelInvocation({
      executionID: execution.executionID,
      invocationID: execution.invocationID,
      ownerID: execution.ownerID,
      fence: execution.fence,
    }).cancelled
  }

  export function finishInvocation(
    execution: Context,
    state: "completed" | "failed" | "cancelled" | "unknown",
    reasonCode?: string,
  ) {
    if (execution.ownerID !== runID) return false
    return ledger().finishInvocation({
      executionID: execution.executionID,
      invocationID: execution.invocationID,
      ownerID: execution.ownerID,
      fence: execution.fence,
      state,
      reasonCode,
    }).finished
  }

  export function invocation(invocationID: string) {
    return ledger().invocation(invocationID)
  }

  export function blocker(blockerID: string) {
    return ledger().blocker(blockerID)
  }

  export function taskflowPlan(executionID: string, sessionID: string) {
    return ledger().taskflowPlan(executionID, sessionID)
  }

  export async function closeTaskflow(value: { sessionID: string; execution: Context }) {
    await assertActive(value)
    return ledger().closeTaskflow({ ...value.execution, sessionID: value.sessionID })
  }

  export function completion(executionID: string) {
    const candidate = ledger().completion(executionID)
    return candidate ? parseCompletion(candidate) : undefined
  }

  export function execution(executionID: string) {
    return ledger().execution(executionID)
  }

  export function executionLeaseActive(executionID: string) {
    return ledger().executionLeaseActive(executionID)
  }

  export function view(executionID: string) {
    return ledger().view(executionID)
  }

  export function isReviewer(execution: Context) {
    const invocation = ledger().invocation(execution.invocationID)
    return invocation?.executionID === execution.executionID && invocation.kind === "reviewer"
  }

  export function reviewerToolCalls(execution: Context) {
    return ledger().reviewerToolCalls(execution.executionID, execution.invocationID)
  }

  export function list(value: Parameters<ReturnType<typeof ExecutionLedger.open>["list"]>[0]) {
    return ledger().list(value)
  }

  export function snapshot(sessionID: string) {
    return ledger().snapshot(sessionID)
  }

  export async function admitStep(input: { sessionID: string; stepID: string; execution?: Context }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) return
    const policy = getExecutionPolicy(resolved.executionContext.executionID)
    const admission = resolved.store.claimStep({
      stepID: input.stepID,
      executionID: resolved.executionContext.executionID,
      invocationID: resolved.executionContext.invocationID,
      ownerID: resolved.executionContext.ownerID,
      fence: resolved.executionContext.fence,
      maxSteps: isReviewer(resolved.executionContext) ? undefined : policy?.budget.maxSteps,
    })
    if ("reason" in admission) throw new BudgetExceededError(admission.reason, resolved.executionContext.executionID)
  }

  export async function admitModelCall(input: {
    sessionID: string
    purpose: string
    estimateMicrousd?: number
    execution?: Context
  }): Promise<Attempt | undefined> {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) return
    const { executionContext, store } = resolved
    const executionID = executionContext.executionID
    if (input.estimateMicrousd === undefined && store.requiresKnownPrice(executionID)) {
      throw new BudgetExceededError("unknown_price", executionID)
    }

    const attemptID = crypto.randomUUID()
    const admission = store.reserve({
      attemptID,
      executionID,
      invocationID: executionContext.invocationID,
      runID: executionContext.ownerID,
      fence: executionContext.fence,
      purpose: input.purpose,
      sessionID: input.sessionID,
      estimateMicrousd: input.estimateMicrousd ?? 0,
      priceKnown: input.estimateMicrousd !== undefined,
    })
    if ("reason" in admission) throw new BudgetExceededError(admission.reason, executionID)
    const dispatch = store.dispatch({
      attemptID,
      runID: executionContext.ownerID,
      fence: executionContext.fence,
    })
    if (!dispatch.dispatched) throw new BudgetExceededError(dispatch.reason, executionID)

    const signal = ensureLease(executionContext)
    const releaseLease = holdLease(executionContext)
    let completed = false
    const complete = () => {
      if (completed) return
      completed = true
      releaseLease()
    }
    return {
      executionID,
      attemptID,
      signal,
      settle(costUsd) {
        const actual = Math.max(0, Math.ceil(costUsd * 1_000_000))
        store.settle(attemptID, actual)
        complete()
      },
      uncertain() {
        if (completed) return
        store.uncertain(attemptID)
        complete()
        log.warn("model usage remains uncertain", { executionID, attemptID })
      },
    }
  }

  export function hasUnresolvedExecutionTaskflow(executionID: string): boolean {
    return ledger().hasUnresolvedExecutionTaskflow(executionID)
  }

  const checkpointRuntime = createCheckpointRuntimeModule({
    getExecutionState,
    setExecutionState,
    deleteExecutionState: executionState.delete,
    ledger,
    hasNewEvidencePath,
    hasRepeatedTail,
    event: Event,
  })
  export const reconcileCheckpoint = checkpointRuntime.reconcileCheckpoint
  export const finalizationConstraints = checkpointRuntime.finalizationConstraints
  export const applyCheckpoint = checkpointRuntime.applyCheckpoint

  export function checkpoints(executionID: string) {
    return ledger().checkpoints(executionID)
  }

  export type RouteGuidance = Omit<RouteGuidanceStore.RouteGuidance, "updatedAt">

  export function getRouteGuidance(executionID: string): RouteGuidance | undefined {
    const records = ledger().checkpoints(executionID)
    const entry = records.length
      ? RouteGuidanceStore.restore(executionID, records)
      : RouteGuidanceStore.get(executionID)
    if (!entry) return undefined
    const { updatedAt: _updatedAt, ...guidance } = entry
    return guidance
  }

  export function checkpointHandled(executionID: string, messageID: string) {
    return checkpoints(executionID).some((item) => item.payload?.triggerMessageID === messageID)
  }

  export function checkpointFailures(executionID: string) {
    return ledger().checkpointFailures(executionID)
  }

  export function recordCheckpointFailure(executionID: string) {
    return ledger().recordCheckpointFailure(executionID)
  }

  export function allowance(executionID: string) {
    const state = ledger().getPolicyState(executionID)
    return {
      limit: state?.sliceLimit ?? 30,
      used: state?.sliceUsedCalls ?? 0,
      extensions: state?.extensionCount ?? 0,
      toolCalls: state?.evidence?.toolCalls ?? 0,
    }
  }

  export function recordObjective(executionID: string, messageID: string, objective: string) {
    return ledger().recordObjective({ executionID, messageID, objective })
  }

  export function objective(executionID: string) {
    return ledger().objective(executionID)
  }

  export async function waitForInput(input: { sessionID: string; execution: Context; reason: string }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const waiting = resolved.store.waitForInput({
      executionID: input.execution.executionID,
      invocationID: input.execution.invocationID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      reason: input.reason,
    })
    if (!waiting.waiting) throw new BudgetExceededError(waiting.reason, input.execution.executionID)
  }
}
