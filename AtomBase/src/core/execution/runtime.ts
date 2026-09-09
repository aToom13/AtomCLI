import path from "path"
import z from "zod"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import type { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { Token } from "@/util/util/token"
import type { LanguageModelUsage, ProviderMetadata } from "ai"
import { Log } from "@/util/util/log"
import { ExecutionLedger } from "./ledger"
import { ReviewPolicy } from "@/core/verification/review-policy"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { Storage } from "@/core/storage/storage"
import { Bus } from "@/core/bus"
import { BusEvent } from "@/core/bus/bus-event"

export namespace ExecutionRuntime {
  const log = Log.create({ service: "execution-runtime" })
  const runID = `${process.pid}:${crypto.randomUUID()}`
  const OWNER_LEASE_MS = 30_000
  const OWNER_HEARTBEAT_MS = 10_000
  const PROJECTION_LEASE_MS = 30_000
  const MAX_COMPLETION_PAYLOAD_BYTES = 2 * 1024 * 1024
  const MAX_COMPLETION_REVIEW_BYTES = 512 * 1024
  const MAX_CONTINUATION_PAYLOAD_BYTES = 64 * 1024
  const ledgers = new Map<string, ReturnType<typeof ExecutionLedger.open>>()
  const leases = new Map<
    string,
    {
      ownerID: string
      fence: number
      controller: AbortController
      heartbeat: ReturnType<typeof setInterval>
      deadline: ReturnType<typeof setTimeout> | undefined
      holders: Map<string, number>
    }
  >()
  const leaseScope = Instance.state(
    () => ({ directory: Instance.directory }),
    async ({ directory }) => {
      for (const [executionID, lease] of leases) {
        if (!lease.holders.delete(directory)) continue
        if (lease.holders.size === 0) stopLease(executionID, "not_active")
      }
    },
  )

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
  }

  export class BudgetExceededError extends Error {
    constructor(
      readonly reason: string,
      readonly executionID?: string,
      readonly detail?: string,
    ) {
      const isBudget = ["deadline", "call_limit", "step_limit", "cost_limit", "unknown_price"].includes(reason)
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

  function stopLease(executionID: string, reason?: string) {
    const current = leases.get(executionID)
    if (!current) return
    clearInterval(current.heartbeat)
    if (current.deadline) clearTimeout(current.deadline)
    leases.delete(executionID)
    if (reason && !current.controller.signal.aborted) {
      current.controller.abort(new BudgetExceededError(reason, executionID))
    }
  }

  function ensureLease(input: Context) {
    const existing = leases.get(input.executionID)
    if (existing?.ownerID === input.ownerID && existing.fence === input.fence) return existing.controller.signal
    if (existing) stopLease(input.executionID, "stale_fence")

    const controller = new AbortController()
    const heartbeat = setInterval(() => {
      try {
        renewLease(input)
      } catch (error) {
        log.error("execution owner lease renewal failed", { executionID: input.executionID, error })
        stopLease(input.executionID, "lease_error")
      }
    }, OWNER_HEARTBEAT_MS)
    heartbeat.unref?.()
    const expiresAt = ledger().deadline(input.executionID)
    const deadline =
      expiresAt === undefined
        ? undefined
        : setTimeout(() => stopLease(input.executionID, "deadline"), Math.max(0, expiresAt - Date.now()))
    deadline?.unref?.()
    leases.set(input.executionID, {
      ownerID: input.ownerID,
      fence: input.fence,
      controller,
      heartbeat,
      deadline,
      holders: new Map(),
    })
    return controller.signal
  }

  export function renewLease(input: Context) {
    const current = leases.get(input.executionID)
    if (!current || current.ownerID !== input.ownerID || current.fence !== input.fence) return false
    const renewal = ledger().renewOwner({
      executionID: input.executionID,
      ownerID: input.ownerID,
      fence: input.fence,
      leaseMs: OWNER_LEASE_MS,
    })
    if (renewal.renewed) return true
    log.warn("execution owner lease was lost", { executionID: input.executionID, reason: renewal.reason })
    stopLease(input.executionID, renewal.reason)
    return false
  }

  export function leaseSignal(input: Context) {
    const current = leases.get(input.executionID)
    if (!current || current.ownerID !== input.ownerID || current.fence !== input.fence) {
      const controller = new AbortController()
      controller.abort(new BudgetExceededError("stale_fence", input.executionID))
      return controller.signal
    }
    return current.controller.signal
  }

  export function holdLease(input: Context) {
    ensureLease(input)
    const current = leases.get(input.executionID)
    if (!current || current.ownerID !== input.ownerID || current.fence !== input.fence) {
      throw new BudgetExceededError("stale_fence", input.executionID)
    }
    const directory = leaseScope().directory
    current.holders.set(directory, (current.holders.get(directory) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const active = leases.get(input.executionID)
      if (active !== current) return
      const count = active.holders.get(directory) ?? 0
      if (count <= 1) active.holders.delete(directory)
      else active.holders.set(directory, count - 1)
      if (active.holders.size === 0) stopLease(input.executionID)
    }
  }

  async function rootSession(sessionID: string) {
    let current = await Session.get(sessionID)
    const visited = new Set<string>()
    while (current.parentID && !visited.has(current.id)) {
      visited.add(current.id)
      current = await Session.get(current.parentID)
    }
    return current
  }

  function microusd(value: number | undefined) {
    if (value === undefined) return undefined
    const converted = Math.ceil(value * 1_000_000)
    if (!Number.isSafeInteger(converted)) throw new Error("Execution cost limit exceeds the supported range")
    return converted
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

  export type Context = ExecutionLedger.Context
  export type Completion = Omit<
    ExecutionLedger.Completion,
    "payload" | "reviewFiles" | "deliveryPayload" | "deliveryFinish"
  > & {
    parts: MessageV2.TextPart[]
    editedFiles: string[]
  }
  export type CompletionClaim = Completion & {
    projectorID: string
    projectionToken: string
    projectionLeaseExpiresAt: number
    sessionGeneration: number
  }

  export type ReviewDecision = {
    policyVersion: number
    policyDigest: string
    requirement: "required" | "not_required" | "user_bypass"
    reasonCode: string
    requiredReviewers: number
    attemptLimit: number
  }

  export type TerminalFailure = {
    outcome: "failed" | "cancelled" | "budget_exhausted" | "blocked"
    reasonCode: ExecutionLedger.ReasonCode
    reasonMessage: string
    retryable: boolean
  }

  export function classifyTerminalFailure(error: unknown, aborted = false): TerminalFailure {
    const budgetReason =
      error instanceof BudgetExceededError
        ? error.reason
        : (error as any)?.name === "ExecutionBudgetExceededError"
          ? (error as any)?.reason
          : undefined
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
          (error as any)?.detail ||
          "The session has unknown mutating work that must be reconciled.",
        retryable: true,
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

  function parseCompletion(candidate: ExecutionLedger.Completion): Completion {
    const { payload, reviewFiles, deliveryPayload, deliveryFinish, ...info } = candidate
    return {
      ...info,
      finish: deliveryFinish ?? info.finish,
      parts: MessageV2.TextPart.array().parse(JSON.parse(deliveryPayload ?? payload)),
      editedFiles: z.string().array().parse(JSON.parse(reviewFiles)),
    }
  }

  function parseCompletionClaim(candidate: ExecutionLedger.CompletionClaim): CompletionClaim {
    const { projectorID, projectionToken, projectionLeaseExpiresAt, sessionGeneration, ...completion } = candidate
    return {
      ...parseCompletion(completion),
      projectorID,
      projectionToken,
      projectionLeaseExpiresAt,
      sessionGeneration,
    }
  }

  function parseClaimOrRecordRecovery(candidate: ExecutionLedger.CompletionClaim): CompletionClaim | undefined {
    try {
      return parseCompletionClaim(candidate)
    } catch (error) {
      log.error("completion projection payload is invalid", { error, executionID: candidate.executionID })
      ledger().markProjectionRecovery({
        executionID: candidate.executionID,
        digest: candidate.digest,
        projectorID: candidate.projectorID,
        projectionToken: candidate.projectionToken,
        sessionGeneration: candidate.sessionGeneration,
        reasonCode: "invalid_payload",
      })
      return undefined
    }
  }

  function policy(budget: NonNullable<Awaited<ReturnType<typeof Config.get>>["execution_budget"]>) {
    return {
      maxCalls: budget.max_calls,
      maxSteps: budget.max_steps,
      maxDurationMs: budget.max_duration_ms,
      maxCostMicrousd: microusd(budget.max_cost_usd),
      rootMaxCostMicrousd: microusd(budget.session_max_cost_usd),
      projectMaxCostMicrousd: microusd(budget.project_max_cost_usd),
      unknownPriceBlocked:
        budget.unknown_price !== "allow" &&
        (budget.max_cost_usd !== undefined ||
          budget.session_max_cost_usd !== undefined ||
          budget.project_max_cost_usd !== undefined),
    }
  }

  function configuredReviewPolicy(config: Awaited<ReturnType<typeof Config.get>>, sessionID: string) {
    return ReviewPolicy.snapshot({
      enabled: config.review?.enabled !== false,
      configuredPolicy: config.review?.policy ?? "adaptive",
      executionProfile: SessionExecutionProfile.get(sessionID),
      reviewerCount: config.review?.reviewer_count ?? 2,
      attemptLimit: config.review?.max_attempts ?? 3,
      highRiskPatterns: config.review?.high_risk_patterns ?? [],
    })
  }

  async function contentSnapshotDigest(files: string[]) {
    const hasher = new Bun.CryptoHasher("sha256")
    for (const filename of [...files].sort()) {
      const filepath = path.isAbsolute(filename) ? filename : path.resolve(Instance.directory, filename)
      hasher.update(`${filename}\0`)
      try {
        const file = Bun.file(filepath)
        if (!(await file.exists())) {
          hasher.update("missing\0")
          continue
        }
        const reader = file.stream().getReader()
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            hasher.update(chunk.value)
          }
        } finally {
          reader.releaseLock()
        }
      } catch (error) {
        hasher.update(`unreadable:${error instanceof Error ? error.name : "unknown"}\0`)
      }
      hasher.update("\0")
    }
    return hasher.digest("hex")
  }

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
    const inherited =
      existing ?? (session.parentID ? (store.active(input.sessionID) ?? store.active(session.parentID)) : undefined)
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
      resumesExecutionID: input.resumesExecutionID,
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

  export async function assertActive(input: { sessionID: string; execution: Context }) {
    await context(input.sessionID, input.execution)
  }

  export async function registerWork(input: {
    sessionID: string
    execution: Context
    operationID: string
    kind: string
    mutating: boolean
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const registered = resolved.store.registerWork({
      id: input.operationID,
      executionID: input.execution.executionID,
      invocationID: input.execution.invocationID,
      kind: input.kind,
      mutating: input.mutating,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
    })
    if (!registered.registered) throw new BudgetExceededError(registered.reason, input.execution.executionID)
    return registered
  }

  export async function beginWork(input: {
    sessionID: string
    execution: Context
    operationID: string
    expectedVersion: number
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const began = resolved.store.beginWork({
      id: input.operationID,
      executionID: input.execution.executionID,
      invocationID: input.execution.invocationID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      expectedVersion: input.expectedVersion,
    })
    if (!began.began) throw new BudgetExceededError(began.reason, input.execution.executionID)
    return began
  }

  export async function finishWork(input: {
    sessionID: string
    execution: Context
    operationID: string
    expectedVersion: number
    state: "completed" | "failed" | "cancelled" | "unknown"
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const finished = resolved.store.finishWork({
      id: input.operationID,
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      expectedVersion: input.expectedVersion,
      state: input.state,
    })
    if (!finished.finished) throw new BudgetExceededError(finished.reason, input.execution.executionID)
    if (input.state === "unknown") {
      Bus.publish(Event.Updated, { sessionID: input.sessionID, executionID: input.execution.executionID })
    }
    return finished
  }

  export async function reconcileWork(input: {
    sessionID: string
    execution: Context
    operationID: string
    state: "completed" | "failed" | "cancelled"
    expectedVersion: number
    evidence: string
    resolutionCode: string
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const reconciled = resolved.store.reconcileWork({
      id: input.operationID,
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      state: input.state,
      expectedVersion: input.expectedVersion,
      evidence: input.evidence,
      resolutionCode: input.resolutionCode,
    })
    if (!reconciled.reconciled) throw new BudgetExceededError(reconciled.reason, input.execution.executionID)
    return reconciled
  }

  export async function registerBlocker(input: {
    sessionID: string
    execution: Context
    blockerID: string
    parentBlockerID?: string
    kind: ExecutionLedger.BlockerKind
    producerID: string
    resourceScope: string
    planRevision?: number
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const registered = resolved.store.registerBlocker({
      id: input.blockerID,
      executionID: input.execution.executionID,
      invocationID: input.execution.invocationID,
      parentBlockerID: input.parentBlockerID,
      kind: input.kind,
      producerID: input.producerID,
      resourceScope: input.resourceScope,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      planRevision: input.planRevision,
    })
    if (!registered.registered) throw new BudgetExceededError(registered.reason, input.execution.executionID)
    return registered.blocker
  }

  export async function createPlan(input: {
    sessionID: string
    execution: Context
    items: Array<{ id: string; resourceScope: string }>
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const created = resolved.store.createPlan({
      executionID: input.execution.executionID,
      invocationID: input.execution.invocationID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      items: input.items,
    })
    if (!created.created) throw new BudgetExceededError(created.reason, input.execution.executionID)
    return created
  }

  export async function transitionBlocker(input: {
    sessionID: string
    execution: Context
    blockerID: string
    expectedVersion: number
    state: ExecutionLedger.BlockerState
    evidence?: string
    resolutionCode?: string
    authority?: "user" | "policy"
    planRevision?: number
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const transitioned = resolved.store.transitionBlocker({
      id: input.blockerID,
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      expectedVersion: input.expectedVersion,
      state: input.state,
      evidence: input.evidence,
      resolutionCode: input.resolutionCode,
      authority: input.authority,
      planRevision: input.planRevision,
    })
    if (!transitioned.transitioned) throw new BudgetExceededError(transitioned.reason, input.execution.executionID)
    return transitioned.blocker
  }

  export async function recordMutation(input: { sessionID: string; execution: Context }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const recorded = resolved.store.recordMutation({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
    })
    if (!recorded.recorded) throw new BudgetExceededError(recorded.reason, input.execution.executionID)
    return recorded.revision
  }

  export function cancelSession(sessionID: string) {
    const store = ledger()
    const active = store.active(sessionID)
    if (!active || active.ownerID !== runID) return false
    return cancelExecution(active)
  }

  export function cancelExecution(execution: Pick<Context, "executionID" | "ownerID" | "fence">) {
    if (execution.ownerID !== runID) return false
    const cancelled = ledger().cancel({
      executionID: execution.executionID,
      ownerID: execution.ownerID,
      fence: execution.fence,
    }).cancelled
    if (cancelled) stopLease(execution.executionID, "not_active")
    return cancelled
  }

  export function cancelInvocation(execution: Pick<Context, "executionID" | "invocationID" | "ownerID" | "fence">) {
    if (execution.ownerID !== runID) return false
    return ledger().cancelInvocation({
      invocationID: execution.invocationID,
      executionID: execution.executionID,
      ownerID: execution.ownerID,
      fence: execution.fence,
    }).cancelled
  }

  export function finishInvocation(
    execution: Pick<Context, "executionID" | "invocationID" | "ownerID" | "fence">,
    state: "completed" | "failed" | "cancelled" | "unknown",
  ) {
    if (execution.ownerID !== runID) return false
    return ledger().finishInvocation({
      invocationID: execution.invocationID,
      executionID: execution.executionID,
      ownerID: execution.ownerID,
      fence: execution.fence,
      state,
    }).finished
  }

  export function blocker(blockerID: string) {
    return ledger().blocker(blockerID)
  }

  export function completion(executionID: string): Completion | undefined {
    const candidate = ledger().completion(executionID)
    return candidate ? parseCompletion(candidate) : undefined
  }

  export function execution(executionID: string) {
    return ledger().execution(executionID)
  }

  export function view(executionID: string) {
    return ledger().view(executionID)
  }

  export function list(input: { sessionID: string; cursor?: string; limit?: number }) {
    return ledger().list(input)
  }

  export function snapshot(sessionID: string) {
    return ledger().snapshot(sessionID)
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

  export function requestCancel(input: {
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

  export function requestReconcile(input: {
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

  export function decideRouteProposal(input: {
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

  export function routeProposalHistory(executionID: string) {
    return ledger().routeProposalHistory(executionID)
  }

  export async function proposeRoute(
    input: Omit<Parameters<ReturnType<typeof ledger>["proposeRoute"]>[0], "ownerID" | "fence" | "sessionGeneration"> & {
      sessionID: string
      execution: Context
    },
  ) {
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

  export async function applyRouteProposal(
    input: Omit<Parameters<ReturnType<typeof ledger>["applyRouteProposal"]>[0], "ownerID" | "fence"> & {
      sessionID: string
      execution: Context
    },
  ) {
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

  export async function returnFromExpert(input: {
    sessionID: string
    execution: Context
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

  export function pendingCompletions(sessionID: string) {
    return ledger().pendingCompletions(sessionID).map(parseCompletion)
  }

  export function claimCompletions(sessionID: string) {
    return ledger()
      .claimCompletions({ sessionID, projectorID: runID, leaseMs: PROJECTION_LEASE_MS })
      .flatMap((candidate) => {
        const parsed = parseClaimOrRecordRecovery(candidate)
        return parsed ? [parsed] : []
      })
  }

  export function claimCompletion(sessionID: string, executionID: string) {
    const candidate = ledger()
      .claimCompletions({ sessionID, executionID, projectorID: runID, leaseMs: PROJECTION_LEASE_MS })
      .at(0)
    return candidate ? parseClaimOrRecordRecovery(candidate) : undefined
  }

  export function ackCompletion(claim: CompletionClaim) {
    return ledger().ackCompletion({
      executionID: claim.executionID,
      digest: claim.digest,
      projectorID: claim.projectorID,
      projectionToken: claim.projectionToken,
      sessionGeneration: claim.sessionGeneration,
    })
  }

  export function markProjectionRecovery(claim: CompletionClaim, reasonCode: "invalid_payload" | "missing_message") {
    return ledger().markProjectionRecovery({
      executionID: claim.executionID,
      digest: claim.digest,
      projectorID: claim.projectorID,
      projectionToken: claim.projectionToken,
      sessionGeneration: claim.sessionGeneration,
      reasonCode,
    })
  }

  export function deleteSessions(sessionIDs: string[], sessionGenerations?: Record<string, number>) {
    return ledger().deleteSessions({ sessionIDs, sessionGenerations })
  }

  export function pendingContinuations(sessionID: string) {
    return ledger()
      .pendingContinuations(sessionID)
      .map((item) => ({
        ...item,
        payload: z.object({ message: MessageV2.User, part: MessageV2.TextPart }).parse(JSON.parse(item.payload)),
      }))
  }

  export function projectContinuation(id: string) {
    return ledger().projectContinuation({ id })
  }

  export async function retryCompletion(input: {
    sessionID: string
    execution: Context
    digest: string
    message: MessageV2.User
    part: MessageV2.TextPart
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const payload = JSON.stringify({ message: input.message, part: input.part })
    if (new TextEncoder().encode(payload).byteLength > MAX_CONTINUATION_PAYLOAD_BYTES) {
      throw new Error(`Continuation payload exceeds ${MAX_CONTINUATION_PAYLOAD_BYTES} bytes`)
    }
    const id = `review-retry:${input.execution.executionID}:${input.digest}`
    const accepted = resolved.store.retryCompletion({
      id,
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      invocationID: input.message.id,
      rootSessionID: input.execution.rootSessionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      payload,
    })
    if (!accepted.accepted) throw new BudgetExceededError(accepted.reason, input.execution.executionID)
    return { id, message: input.message, part: input.part }
  }

  export async function stageCompletion(input: {
    sessionID: string
    messageID: string
    finish: string
    parts: MessageV2.TextPart[]
    editedFiles: string[]
    requiresReview: boolean
    reviewDecision?: ReviewDecision
    execution: Context
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const parts = MessageV2.TextPart.array().parse(input.parts)
    const editedFiles = z.string().array().max(1_000).parse(input.editedFiles)
    const payload = JSON.stringify(parts)
    if (new TextEncoder().encode(payload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const reviewFiles = JSON.stringify(editedFiles)
    if (new TextEncoder().encode(reviewFiles).byteLength > MAX_COMPLETION_REVIEW_BYTES) {
      throw new Error(`Completion review evidence exceeds ${MAX_COMPLETION_REVIEW_BYTES} bytes`)
    }
    const revision = resolved.store.revision(input.execution.executionID)
    if (revision === undefined) throw new BudgetExceededError("not_active", input.execution.executionID)
    const planRevision = resolved.store.planRevision(input.execution.executionID)
    if (planRevision === undefined) throw new BudgetExceededError("not_active", input.execution.executionID)
    const config = await Config.get()
    const configuredPolicy = configuredReviewPolicy(config, input.sessionID)
    const reviewDecision: ReviewDecision = input.reviewDecision ?? {
      policyVersion: configuredPolicy.policyVersion,
      policyDigest: configuredPolicy.policyDigest,
      requirement: input.requiresReview ? "required" : "not_required",
      reasonCode: "legacy_callsite",
      requiredReviewers: input.requiresReview ? configuredPolicy.reviewerCount : 0,
      attemptLimit: configuredPolicy.attemptLimit,
    }
    if (reviewDecision.policyDigest !== configuredPolicy.policyDigest) {
      throw new BudgetExceededError("stale_policy", input.execution.executionID)
    }
    if (input.requiresReview !== (reviewDecision.requirement === "required")) {
      throw new BudgetExceededError("invalid_review_policy", input.execution.executionID)
    }
    const snapshotDigest = await contentSnapshotDigest(editedFiles)
    const digestInput = JSON.stringify({
      sessionID: input.sessionID,
      messageID: input.messageID,
      finish: input.finish,
      parts,
      editedFiles,
      requiresReview: input.requiresReview,
      revision,
      planRevision,
      reviewDecision,
      contentSnapshotDigest: snapshotDigest,
    })
    const digest = new Bun.CryptoHasher("sha256").update(digestInput).digest("hex")
    const staged = resolved.store.stageCompletion({
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      finish: input.finish,
      payload,
      reviewFiles,
      digest,
      requiresReview: input.requiresReview,
      revision,
      planRevision,
      policyVersion: reviewDecision.policyVersion,
      policyDigest: reviewDecision.policyDigest,
      reviewRequirement: reviewDecision.requirement,
      reviewReasonCode: reviewDecision.reasonCode,
      requiredReviewers: reviewDecision.requiredReviewers,
      attemptLimit: reviewDecision.attemptLimit,
      contentSnapshotDigest: snapshotDigest,
    })
    if (!staged.staged) throw new BudgetExceededError(staged.reason, input.execution.executionID)
    return parseCompletion(staged.completion)
  }

  export async function claimReview(input: {
    sessionID: string
    execution: Context
    digest: string
    revision: number
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const claimed = resolved.store.claimReview({
      id: crypto.randomUUID(),
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      revision: input.revision,
    })
    if (!claimed.claimed) throw new BudgetExceededError(claimed.reason, input.execution.executionID)
    return claimed.claim
  }

  export async function authorizeReviewSession(input: {
    sessionID: string
    reviewerSessionID: string
    execution: Context
    reviewID: string
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const authorized = resolved.store.authorizeReviewSession({
      executionID: input.execution.executionID,
      reviewID: input.reviewID,
      sessionID: input.reviewerSessionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
    })
    if (!authorized.authorized) throw new BudgetExceededError(authorized.reason, input.execution.executionID)
  }

  export async function recordReview(input: {
    sessionID: string
    execution: Context
    reviewID: string
    state: "passed" | "rejected" | "inconclusive"
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const recorded = resolved.store.recordReview({
      executionID: input.execution.executionID,
      reviewID: input.reviewID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      state: input.state,
    })
    if (!recorded.recorded) throw new BudgetExceededError(recorded.reason, input.execution.executionID)
    return recorded.claim
  }

  export async function commitCompletion(input: { sessionID: string; execution: Context; digest: string }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const candidate = resolved.store.completion(input.execution.executionID)
    if (!candidate) throw new BudgetExceededError("not_staged", input.execution.executionID)
    const config = await Config.get()
    const currentPolicy = configuredReviewPolicy(config, input.sessionID)
    if (candidate.policyDigest !== currentPolicy.policyDigest) {
      throw new BudgetExceededError("stale_policy", input.execution.executionID)
    }
    const snapshotDigest = await contentSnapshotDigest(z.string().array().parse(JSON.parse(candidate.reviewFiles)))
    const committed = resolved.store.commitCompletion({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      policyDigest: currentPolicy.policyDigest,
      contentSnapshotDigest: snapshotDigest,
    })
    if (!committed.committed) throw new BudgetExceededError(committed.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(committed.completion)
  }

  export async function finalizeBlocked(input: {
    sessionID: string
    execution: Context
    digest: string
    parts: MessageV2.TextPart[]
    reasonCode: "review_rejected" | "review_unavailable"
    reasonMessage: string
  }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const parts = MessageV2.TextPart.array().parse(input.parts)
    const deliveryPayload = JSON.stringify(parts)
    if (new TextEncoder().encode(deliveryPayload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const finalized = resolved.store.finalizeBlocked({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
      deliveryPayload,
      deliveryFinish: "error",
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
    })
    if (!finalized.finalized) throw new BudgetExceededError(finalized.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(finalized.completion)
  }

  export function finalizeOutcome(input: {
    sessionID: string
    messageID: string
    parts?: MessageV2.TextPart[]
    execution: Context
    failure: TerminalFailure
  }) {
    if (input.execution.ownerID !== runID) {
      throw new BudgetExceededError("stale_fence", input.execution.executionID)
    }
    const parts = input.parts ?? []
    const payload = JSON.stringify(parts)
    if (new TextEncoder().encode(payload).byteLength > MAX_COMPLETION_PAYLOAD_BYTES) {
      throw new Error(`Completion payload exceeds ${MAX_COMPLETION_PAYLOAD_BYTES} bytes`)
    }
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(
      JSON.stringify({
        executionID: input.execution.executionID,
        sessionID: input.sessionID,
        messageID: input.messageID,
        outcome: input.failure.outcome,
        reasonCode: input.failure.reasonCode,
        payload,
      }),
    )
    const digest = hasher.digest("hex")
    const finalized = ledger().finalizeOutcome({
      executionID: input.execution.executionID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      finish: "error",
      payload,
      digest,
      ...input.failure,
    })
    if (!finalized.finalized) throw new BudgetExceededError(finalized.reason, input.execution.executionID)
    stopLease(input.execution.executionID)
    return parseCompletion(finalized.completion)
  }

  export async function discardCompletion(input: { sessionID: string; execution: Context; digest: string }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) throw new BudgetExceededError("not_active", input.execution.executionID)
    const discarded = resolved.store.discardCompletion({
      executionID: input.execution.executionID,
      ownerID: input.execution.ownerID,
      fence: input.execution.fence,
      digest: input.digest,
    })
    if (!discarded.discarded) throw new BudgetExceededError(discarded.reason, input.execution.executionID)
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

  async function context(sessionID: string, supplied?: Context) {
    const config = await Config.get()
    const budget = config.execution_budget
    if (!budget && !supplied) return
    const executionContext =
      supplied ?? (await resolveInvocation({ sessionID, invocationID: await legacyInvocation(sessionID) }))
    const root = await Session.get(executionContext.rootSessionID)
    const store = ledger()
    store.start({
      id: executionContext.executionID,
      projectID: root.projectID,
      rootSessionID: executionContext.rootSessionID,
      fence: executionContext.fence,
      policy: budget ? policy(budget) : {},
    })
    if (executionContext.ownerID !== runID) {
      throw new BudgetExceededError("stale_fence", executionContext.executionID)
    }
    const activeInvocation = store.invocation(executionContext.invocationID)
    if (
      !activeInvocation ||
      activeInvocation.executionID !== executionContext.executionID ||
      !["accepted", "running", "waiting"].includes(activeInvocation.state)
    ) {
      throw new BudgetExceededError("not_active", executionContext.executionID)
    }
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

  export async function admitStep(input: { sessionID: string; stepID: string; execution?: Context }) {
    const resolved = await context(input.sessionID, input.execution)
    if (!resolved) return
    const admission = resolved.store.claimStep({
      stepID: input.stepID,
      executionID: resolved.executionContext.executionID,
      invocationID: resolved.executionContext.invocationID,
      ownerID: resolved.executionContext.ownerID,
      fence: resolved.executionContext.fence,
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
    const { budget, executionContext, store } = resolved
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
}
