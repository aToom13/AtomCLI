import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"

export namespace ModelQuality {
  export type Category = "coding" | "documentation" | "analysis" | "general"
  export type Signal = "request" | "test" | "review" | "user_correction" | "tool_schema" | "empty_response"

  export interface Outcome {
    providerID: string
    modelID: string
    category: Category
    quality: number
    success: boolean
    latencyMs?: number
    signal: Signal
    timestamp?: number
  }

  export interface CategoryStats {
    samples: number
    successes: number
    qualityEwma: number
    latencyEwmaMs?: number
    corrections: number
    lastUpdated: number
  }

  export interface ModelStats {
    key: string
    categories: Partial<Record<Category, CategoryStats>>
  }

  interface QualityState {
    loaded: boolean
    models: Record<string, ModelStats>
    pendingWrite?: Promise<void>
  }

  const log = Log.create({ service: "model-quality" })
  const ALPHA = 0.2
  const MAX_MODELS = 500
  const state = Instance.state<QualityState>(() => ({ loaded: false, models: {} }))
  const testState: QualityState = { loaded: false, models: {} }

  function current() {
    try {
      return state()
    } catch {
      return testState
    }
  }

  export function key(providerID: string, modelID: string) {
    return `${providerID}/${modelID}`
  }

  function storageKey(projectID: string) {
    return ["model-quality", projectID]
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
    value.models = await Storage.read<Record<string, ModelStats>>(storageKey(projectID)).catch(() => ({}))
    value.loaded = true
  }

  function persist() {
    const value = current()
    let projectID: string
    try { projectID = Instance.project.id } catch { return }
    const snapshot = structuredClone(value.models)
    value.pendingWrite = (value.pendingWrite ?? Promise.resolve())
      .catch(() => {})
      .then(() => Storage.write(storageKey(projectID), snapshot))
      .catch((error) => log.warn("failed to persist model quality", { error }))
  }

  export async function record(outcome: Outcome) {
    await initialize()
    const state = current()
    const modelKey = key(outcome.providerID, outcome.modelID)
    const model = state.models[modelKey] ?? { key: modelKey, categories: {} }
    const previous = model.categories[outcome.category]
    const quality = Math.max(0, Math.min(1, outcome.quality))
    const now = outcome.timestamp ?? Date.now()
    const next: CategoryStats = {
      samples: (previous?.samples ?? 0) + 1,
      successes: (previous?.successes ?? 0) + (outcome.success ? 1 : 0),
      qualityEwma: previous ? previous.qualityEwma * (1 - ALPHA) + quality * ALPHA : quality,
      latencyEwmaMs:
        outcome.latencyMs === undefined
          ? previous?.latencyEwmaMs
          : previous?.latencyEwmaMs === undefined
            ? outcome.latencyMs
            : previous.latencyEwmaMs * (1 - ALPHA) + outcome.latencyMs * ALPHA,
      corrections: (previous?.corrections ?? 0) + (outcome.signal === "user_correction" ? 1 : 0),
      lastUpdated: now,
    }
    model.categories[outcome.category] = next
    state.models[modelKey] = model

    const overflow = Object.values(state.models)
      .sort((a, b) => Math.max(...Object.values(a.categories).map((x) => x.lastUpdated)) - Math.max(...Object.values(b.categories).map((x) => x.lastUpdated)))
      .slice(0, Math.max(0, Object.keys(state.models).length - MAX_MODELS))
    for (const item of overflow) delete state.models[item.key]
    persist()
    return next
  }

  export function get(providerID: string, modelID: string, category: Category) {
    return current().models[key(providerID, modelID)]?.categories[category]
  }

  export function bonus(providerID: string, modelID: string, category: Category) {
    const stats = get(providerID, modelID, category)
    if (!stats || stats.samples < 2) return 0
    const confidence = Math.min(1, stats.samples / 10)
    const correctionPenalty = Math.min(20, stats.corrections * 4)
    return (stats.qualityEwma - 0.5) * 80 * confidence - correctionPenalty
  }

  export function snapshot() {
    return structuredClone(current().models)
  }

  export function resetForTest() {
    testState.loaded = false
    testState.models = {}
    testState.pendingWrite = undefined
  }
}
