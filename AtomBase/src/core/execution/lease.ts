import { Instance } from "@/services/project/instance"

type Context = {
  executionID: string
  ownerID: string
  fence: number
}

type Ledger = {
  deadline(executionID: string): number | undefined
  renewOwner(input: { executionID: string; ownerID: string; fence: number; leaseMs: number }): {
    renewed: boolean
    reason?: string
  }
}

type Logger = {
  error(message: string, fields: Record<string, unknown>): void
  warn(message: string, fields: Record<string, unknown>): void
}

export function createLeaseManager(input: {
  ledger: Ledger
  log: Logger
  ownerLeaseMs: number
  heartbeatMs: number
  makeError(reason: string, executionID: string): Error
}) {
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

  function stopLease(executionID: string, reason?: string) {
    const current = leases.get(executionID)
    if (!current) return
    clearInterval(current.heartbeat)
    if (current.deadline) clearTimeout(current.deadline)
    leases.delete(executionID)
    if (reason && !current.controller.signal.aborted) {
      current.controller.abort(input.makeError(reason, executionID))
    }
  }

  const leaseScope = Instance.state(
    () => ({ directory: Instance.directory }),
    async ({ directory }) => {
      for (const [executionID, lease] of leases) {
        if (!lease.holders.delete(directory)) continue
        if (lease.holders.size === 0) stopLease(executionID, "not_active")
      }
    },
  )

  function renewLease(context: Context) {
    const current = leases.get(context.executionID)
    if (!current || current.ownerID !== context.ownerID || current.fence !== context.fence) return false
    const renewal = input.ledger.renewOwner({
      executionID: context.executionID,
      ownerID: context.ownerID,
      fence: context.fence,
      leaseMs: input.ownerLeaseMs,
    })
    if (renewal.renewed) return true
    input.log.warn("execution owner lease was lost", { executionID: context.executionID, reason: renewal.reason })
    stopLease(context.executionID, renewal.reason)
    return false
  }

  function ensureLease(context: Context) {
    const existing = leases.get(context.executionID)
    if (existing?.ownerID === context.ownerID && existing.fence === context.fence) return existing.controller.signal
    if (existing) stopLease(context.executionID, "stale_fence")

    const controller = new AbortController()
    const heartbeat = setInterval(() => {
      try {
        renewLease(context)
      } catch (error) {
        input.log.error("execution owner lease renewal failed", { executionID: context.executionID, error })
        stopLease(context.executionID, "lease_error")
      }
    }, input.heartbeatMs)
    heartbeat.unref?.()
    const expiresAt = input.ledger.deadline(context.executionID)
    const deadline =
      expiresAt === undefined
        ? undefined
        : setTimeout(() => stopLease(context.executionID, "deadline"), Math.max(0, expiresAt - Date.now()))
    deadline?.unref?.()
    leases.set(context.executionID, {
      ownerID: context.ownerID,
      fence: context.fence,
      controller,
      heartbeat,
      deadline,
      holders: new Map(),
    })
    return controller.signal
  }

  function leaseSignal(context: Context) {
    const current = leases.get(context.executionID)
    if (!current || current.ownerID !== context.ownerID || current.fence !== context.fence) {
      const controller = new AbortController()
      controller.abort(input.makeError("stale_fence", context.executionID))
      return controller.signal
    }
    return current.controller.signal
  }

  function holdLease(context: Context) {
    ensureLease(context)
    const current = leases.get(context.executionID)
    if (!current || current.ownerID !== context.ownerID || current.fence !== context.fence) {
      throw input.makeError("stale_fence", context.executionID)
    }
    const directory = leaseScope().directory
    current.holders.set(directory, (current.holders.get(directory) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const active = leases.get(context.executionID)
      if (active !== current) return
      const count = active.holders.get(directory) ?? 0
      if (count <= 1) active.holders.delete(directory)
      else active.holders.set(directory, count - 1)
      if (active.holders.size === 0) stopLease(context.executionID)
    }
  }

  return { stopLease, ensureLease, renewLease, leaseSignal, holdLease }
}
