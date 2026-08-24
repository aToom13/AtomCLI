import { GlobalBus } from "@/core/bus/global"
import { SessionStatus } from "@/core/session/status"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { Instance } from "@/services/project/instance"

const MAX_LIFECYCLE_ENTRIES = 500

export namespace SubAgentLifecycle {
  export type Status = {
    sessionId: string
    runtime: string
    status: "running" | "waiting" | "failed" | "cancelled"
    startedAt: number
    updatedAt: number
    error?: string
  }

  const lifecycle = Instance.state(() => new Map<string, Status>())

  export function update(value: Status) {
    const entries = lifecycle()
    entries.delete(value.sessionId)
    entries.set(value.sessionId, value)
    while (entries.size > MAX_LIFECYCLE_ENTRIES) entries.delete(entries.keys().next().value!)
  }

  export function status(sessionID: string): Status {
    const known = lifecycle().get(sessionID)
    if (known) return { ...known }
    const fallback = SessionStatus.get(sessionID)
    const now = Date.now()
    return {
      sessionId: sessionID,
      runtime: "atom-inprocess",
      status: fallback.type === "idle" ? "waiting" : "running",
      startedAt: now,
      updatedAt: now,
    }
  }

  export async function wait(
    sessionID: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<Status> {
    const current = status(sessionID)
    if (current.status !== "running") return current
    const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30_000, 1), 10 * 60_000)
    return new Promise<Status>((resolve, reject) => {
      let settled = false
      const finish = (value: Status) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        GlobalBus.off("event", listener)
        options.signal?.removeEventListener("abort", aborted)
        resolve(value)
      }
      const listener = (event: { payload?: { type?: string; properties?: { sessionId?: string } } }) => {
        const properties = event.payload?.properties
        if (properties?.sessionId !== sessionID) return
        if (event.payload?.type === TuiEvent.SubAgentRemove.type) {
          const previous = status(sessionID)
          update({ ...previous, status: "cancelled", updatedAt: Date.now() })
        }
        if (
          event.payload?.type === TuiEvent.SubAgentDone.type ||
          event.payload?.type === TuiEvent.SubAgentFailed.type ||
          event.payload?.type === TuiEvent.SubAgentRemove.type
        ) {
          finish(status(sessionID))
        }
      }
      const aborted = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        GlobalBus.off("event", listener)
        reject(options.signal?.reason ?? new Error("Sub-agent wait cancelled"))
      }
      const timer = setTimeout(() => finish(status(sessionID)), timeoutMs)
      GlobalBus.on("event", listener)
      options.signal?.addEventListener("abort", aborted, { once: true })
    })
  }
}
