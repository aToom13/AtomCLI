import type { ExecutionLedger } from "../ledger"

type Store = ReturnType<typeof ExecutionLedger.open>
type RuntimeContext = ExecutionLedger.Context
type ResolvedContext = { store: Store; executionContext: RuntimeContext }
type RuntimeInput<T = object> = T & { sessionID: string; execution: RuntimeContext }
type BudgetError = new (reason: string, executionID?: string, detail?: string) => Error

export function createWorkRuntimeModule(input: {
  context: (
    sessionID: string,
    execution?: RuntimeContext,
    settleWork?: boolean,
  ) => Promise<ResolvedContext | undefined>
  BudgetExceededError: BudgetError
  publishUpdated: (sessionID: string, executionID: string) => void
}) {
  const { context, BudgetExceededError, publishUpdated } = input

  async function assertActive(value: RuntimeInput) {
    await context(value.sessionID, value.execution)
  }

  async function registerWork(
    value: RuntimeInput<{
      operationID: string
      kind: Parameters<Store["registerWork"]>[0]["kind"]
      mutating: boolean
    }>,
  ) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const registered = resolved.store.registerWork({ id: value.operationID, executionID: value.execution.executionID, invocationID: value.execution.invocationID, kind: value.kind, mutating: value.mutating, ownerID: value.execution.ownerID, fence: value.execution.fence })
    if (!registered.registered) throw new BudgetExceededError(registered.reason, value.execution.executionID)
    return registered
  }
  async function beginWork(value: RuntimeInput<{ operationID: string; expectedVersion: number }>) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const began = resolved.store.beginWork({ id: value.operationID, executionID: value.execution.executionID, invocationID: value.execution.invocationID, ownerID: value.execution.ownerID, fence: value.execution.fence, expectedVersion: value.expectedVersion })
    if (!began.began) throw new BudgetExceededError(began.reason, value.execution.executionID)
    return began
  }
  async function finishWork(
    value: RuntimeInput<{
      operationID: string
      expectedVersion: number
      state: Parameters<Store["finishWork"]>[0]["state"]
    }>,
  ) {
    // Cancellation marks the invocation draining before the tool's abort
    // handler returns. Closing already-started work must still be allowed;
    // admission of new work continues to use the stricter active check.
    const resolved = await context(value.sessionID, value.execution, true)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const finished = resolved.store.finishWork({ id: value.operationID, executionID: value.execution.executionID, ownerID: value.execution.ownerID, fence: value.execution.fence, expectedVersion: value.expectedVersion, state: value.state })
    if (!finished.finished) throw new BudgetExceededError(finished.reason, value.execution.executionID)
    if (value.state === "unknown") publishUpdated(value.sessionID, value.execution.executionID)
    return finished
  }
  async function reconcileWork(
    value: RuntimeInput<{
      operationID: string
      expectedVersion: number
      state: Parameters<Store["reconcileWork"]>[0]["state"]
      evidence: string
      resolutionCode: string
    }>,
  ) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const reconciled = resolved.store.reconcileWork({ id: value.operationID, executionID: value.execution.executionID, ownerID: value.execution.ownerID, fence: value.execution.fence, state: value.state, expectedVersion: value.expectedVersion, evidence: value.evidence, resolutionCode: value.resolutionCode })
    if (!reconciled.reconciled) throw new BudgetExceededError(reconciled.reason, value.execution.executionID)
    return reconciled
  }
  async function registerBlocker(
    value: RuntimeInput<{
      blockerID: string
      parentBlockerID?: string
      kind: Parameters<Store["registerBlocker"]>[0]["kind"]
      producerID: string
      resourceScope: string
      planRevision?: number
    }>,
  ) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const registered = resolved.store.registerBlocker({ id: value.blockerID, executionID: value.execution.executionID, invocationID: value.execution.invocationID, parentBlockerID: value.parentBlockerID, kind: value.kind, producerID: value.producerID, resourceScope: value.resourceScope, ownerID: value.execution.ownerID, fence: value.execution.fence, planRevision: value.planRevision })
    if (!registered.registered) throw new BudgetExceededError(registered.reason, value.execution.executionID)
    return registered.blocker
  }
  async function createPlan(value: RuntimeInput<{ items: Parameters<Store["createPlan"]>[0]["items"] }>) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const created = resolved.store.createPlan({ executionID: value.execution.executionID, invocationID: value.execution.invocationID, ownerID: value.execution.ownerID, fence: value.execution.fence, items: value.items })
    if (!created.created) throw new BudgetExceededError(created.reason, value.execution.executionID)
    return created
  }
  async function transitionBlocker(
    value: RuntimeInput<{
      blockerID: string
      expectedVersion: number
      state: Parameters<Store["transitionBlocker"]>[0]["state"]
      evidence?: string
      resolutionCode?: string
      authority?: Parameters<Store["transitionBlocker"]>[0]["authority"]
      planRevision?: number
    }>,
  ) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const transitioned = resolved.store.transitionBlocker({ id: value.blockerID, executionID: value.execution.executionID, ownerID: value.execution.ownerID, fence: value.execution.fence, expectedVersion: value.expectedVersion, state: value.state, evidence: value.evidence, resolutionCode: value.resolutionCode, authority: value.authority, planRevision: value.planRevision })
    if (!transitioned.transitioned) throw new BudgetExceededError(transitioned.reason, value.execution.executionID)
    return transitioned.blocker
  }
  async function recordMutation(value: RuntimeInput) {
    const resolved = await context(value.sessionID, value.execution)
    if (!resolved) throw new BudgetExceededError("not_active", value.execution.executionID)
    const recorded = resolved.store.recordMutation({ executionID: value.execution.executionID, ownerID: value.execution.ownerID, fence: value.execution.fence })
    if (!recorded.recorded) throw new BudgetExceededError(recorded.reason, value.execution.executionID)
    return recorded.revision
  }
  return {
    assertActive,
    registerWork,
    beginWork,
    finishWork,
    reconcileWork,
    registerBlocker,
    createPlan,
    transitionBlocker,
    recordMutation,
  }
}
