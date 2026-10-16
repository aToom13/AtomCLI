import { Storage } from "@/core/storage/storage"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionRuntime } from "@/core/execution/runtime"

export namespace SessionScopeFloor {
  type Scope = ExecutionContract.Scope

  function higher(left: Scope, right: Scope): Scope {
    return ExecutionContract.SCOPE_RANK[left] >= ExecutionContract.SCOPE_RANK[right] ? left : right
  }

  async function load(sessionID: string): Promise<Scope | undefined> {
    const floor = ExecutionRuntime.scopeFloor(sessionID)
    // Migrate pre-ledger floors once; ledger remains authoritative afterward.
    const stored = await Storage.read<unknown>(["session_scope_floor", sessionID]).catch(() => undefined)
    const parsed = ExecutionContract.Scope.safeParse(stored)
    if (!parsed.success) return floor
    const migrated = ExecutionRuntime.raiseScopeFloor(sessionID, parsed.data)
    await Storage.remove(["session_scope_floor", sessionID])
    return migrated
  }

  export function get(sessionID: string): Scope | undefined {
    return ExecutionRuntime.scopeFloor(sessionID)
  }

  export async function merge(sessionID: string, scope: Scope): Promise<Scope> {
    const floor = await load(sessionID)
    return floor ? higher(floor, scope) : scope
  }

  export async function raise(input: { sessionID: string; scope: Scope }): Promise<Scope> {
    await load(input.sessionID)
    return ExecutionRuntime.raiseScopeFloor(input.sessionID, input.scope)
  }

  export async function reset(sessionID: string): Promise<void> {
    ExecutionRuntime.resetScopeFloor(sessionID)
    await Storage.remove(["session_scope_floor", sessionID])
  }

  export function clearCache(): void {
    // Ledger owns durable state; no session-local cache remains.
  }
}
