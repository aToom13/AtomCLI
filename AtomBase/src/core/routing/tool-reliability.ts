import { Instance } from "@/services/project/instance"
import { Storage } from "@/core/storage/storage"
import { Log } from "@/util/util/log"

export namespace ToolReliability {
  export interface Stats {
    calls: number
    successes: number
    failures: number
    latencyEwmaMs: number
    lastError?: string
    lastUpdated: number
  }

  interface State {
    loaded: boolean
    entries: Record<string, Stats>
    loading?: Promise<void>
    pendingWrite?: Promise<void>
  }

  const MAX_ENTRIES = 2_000
  const ALPHA = 0.2
  const log = Log.create({ service: "tool-reliability" })
  const state = Instance.state<State>(() => ({ loaded: false, entries: {} }))
  const fallback: State = { loaded: false, entries: {} }

  function current() {
    try {
      return state()
    } catch {
      return fallback
    }
  }

  export function key(providerID: string, modelID: string, tool: string) {
    return `${providerID}/${modelID}:${tool}`
  }

  export async function initialize() {
    let projectID: string
    try {
      projectID = Instance.project.id
    } catch {
      return
    }
    const value = current()
    if (value.loaded) return
    if (value.loading) return value.loading
    value.loading = (async () => {
      const stored = await Storage.read<Record<string, Stats>>(["tool-reliability", projectID]).catch(() => ({}))
      // Preserve observations recorded after initialization was requested.
      value.entries = { ...stored, ...value.entries }
      value.loaded = true
    })().finally(() => {
      value.loading = undefined
    })
    return value.loading
  }

  function safeError(error: string | undefined) {
    if (!error) return undefined
    return error
      .split("\n", 1)[0]
      .replace(/\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*.*/gi, "$1=[redacted]")
      .slice(0, 500)
  }

  function persist() {
    const value = current()
    let projectID: string
    try {
      projectID = Instance.project.id
    } catch {
      return
    }
    const snapshot = structuredClone(value.entries)
    value.pendingWrite = (value.pendingWrite ?? Promise.resolve())
      .catch(() => {})
      .then(() => Storage.write(["tool-reliability", projectID], snapshot))
      .catch((error) => log.warn("failed to persist tool reliability", { error }))
  }

  export async function record(input: {
    providerID: string
    modelID: string
    tool: string
    ok: boolean
    latencyMs: number
    error?: string
  }) {
    await initialize()
    const value = current()
    const id = key(input.providerID, input.modelID, input.tool)
    const previous = value.entries[id]
    const latency = Math.max(0, input.latencyMs)
    value.entries[id] = {
      calls: (previous?.calls ?? 0) + 1,
      successes: (previous?.successes ?? 0) + (input.ok ? 1 : 0),
      failures: (previous?.failures ?? 0) + (input.ok ? 0 : 1),
      latencyEwmaMs: previous ? previous.latencyEwmaMs * (1 - ALPHA) + latency * ALPHA : latency,
      lastError: input.ok ? undefined : safeError(input.error),
      lastUpdated: Date.now(),
    }
    const overflow = Object.entries(value.entries)
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated)
      .slice(0, Math.max(0, Object.keys(value.entries).length - MAX_ENTRIES))
    for (const [entry] of overflow) delete value.entries[entry]
    persist()
    return value.entries[id]
  }

  export function get(providerID: string, modelID: string, tool: string) {
    return current().entries[key(providerID, modelID, tool)]
  }

  export function modelBonus(providerID: string, modelID: string, tools: string[]) {
    if (tools.length === 0) return 0
    const known = tools
      .map((tool) => get(providerID, modelID, tool))
      .filter((item): item is Stats => !!item && item.calls >= 2)
    if (known.length === 0) return 0
    return (
      known.reduce((total, item) => {
        const reliability = (item.successes / item.calls - 0.5) * 20
        const latencyPenalty = Math.min(10, item.latencyEwmaMs / 5_000)
        return total + reliability - latencyPenalty
      }, 0) / known.length
    )
  }

  export function snapshot() {
    return structuredClone(current().entries)
  }
}
