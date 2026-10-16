import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"

export type ExecutionState = {
  contract: ExecutionContract.Info
  policy: ExecutionPolicy.PolicyInfo
  evidence: ExecutionPolicy.RuntimeEvidence
  promotionReasons: string[]
  classifierFallback: boolean
  extensionCount: number
  sliceLimit: number
  sliceStartCalls: number
  sliceUsedCalls: number
  lastTouchedAt: number
}

type Ledger = Pick<
  ReturnType<typeof import("../ledger").ExecutionLedger.open>,
  "getPolicyState" | "savePolicyState" | "view"
>

const MAX_EXECUTION_STATES = 500
const EXECUTION_STATE_TTL_MS = 30 * 60 * 1000

export function createExecutionStateStore(input: { ledger: () => Ledger; warn(message: string, data: unknown): void }) {
  const states = new Map<string, ExecutionState>()

  function get(executionID: string) {
    let current = states.get(executionID)
    try {
      const persisted = input.ledger().getPolicyState(executionID)
      if (persisted) {
        current = {
          ...persisted,
          extensionCount: persisted.extensionCount ?? 0,
          sliceLimit: persisted.sliceLimit ?? 30,
          sliceStartCalls: persisted.sliceStartCalls ?? persisted.evidence?.toolCalls ?? 0,
          sliceUsedCalls: persisted.sliceUsedCalls ?? 0,
          lastTouchedAt: Date.now(),
        }
        states.set(executionID, current)
      }
    } catch (error) {
      input.warn("failed to load policy state from ledger", { executionID, error })
    }
    if (current) current.lastTouchedAt = Date.now()
    return current
  }

  function set(
    executionID: string,
    state: Omit<
      ExecutionState,
      "lastTouchedAt" | "extensionCount" | "sliceLimit" | "sliceStartCalls" | "sliceUsedCalls"
    > &
      Partial<Pick<ExecutionState, "extensionCount" | "sliceLimit" | "sliceStartCalls" | "sliceUsedCalls">>,
  ) {
    const previous = states.get(executionID)
    const entry: ExecutionState = {
      ...state,
      extensionCount: state.extensionCount ?? previous?.extensionCount ?? 0,
      sliceLimit: state.sliceLimit ?? previous?.sliceLimit ?? 30,
      sliceStartCalls: state.sliceStartCalls ?? previous?.sliceStartCalls ?? 0,
      sliceUsedCalls: state.sliceUsedCalls ?? previous?.sliceUsedCalls ?? 0,
      lastTouchedAt: Date.now(),
    }
    states.set(executionID, entry)
    try {
      input.ledger().savePolicyState({ executionID, ...entry })
    } catch (error) {
      input.warn("failed to persist policy state to ledger", { executionID, error })
    }
    prune()
  }

  function prune(now = Date.now()) {
    let evicted = 0
    for (const [executionID, entry] of states) {
      if (now - entry.lastTouchedAt >= EXECUTION_STATE_TTL_MS) {
        states.delete(executionID)
        evicted++
      }
    }
    if (states.size <= MAX_EXECUTION_STATES) return evicted
    for (const executionID of states.keys()) {
      if (states.size <= MAX_EXECUTION_STATES) break
      if (input.ledger().view(executionID)?.lifecycle === "terminal") {
        states.delete(executionID)
        evicted++
      }
    }
    return evicted
  }

  return {
    get,
    set,
    delete: (executionID: string) => states.delete(executionID),
    update: (executionID: string, state: ExecutionState) => states.set(executionID, state),
    prune,
    limits: { maxEntries: MAX_EXECUTION_STATES, ttlMs: EXECUTION_STATE_TTL_MS },
  }
}
