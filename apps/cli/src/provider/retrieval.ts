import fuzzysort from "fuzzysort"
import { sortBy } from "remeda"
import type { Info, Model } from "./types"
import { ModelNotFoundError, InitError } from "./types"
import { state } from "./state"
import { Config } from "../config/config"

export async function list(): Promise<Record<string, Info>> {
    const { providers } = await state()
    return providers
}

export async function getProvider(providerID: string): Promise<Info | undefined> {
    const { providers } = await state()
    return providers[providerID]
}

export async function getModel(providerID: string, modelID: string): Promise<Model> {
    const provider = await getProvider(providerID)
    if (!provider) {
        const suggestions = await closestProvider(providerID)
        throw new ModelNotFoundError({
            providerID,
            modelID,
            suggestions,
        })
    }

    const model = provider.models[modelID]
    if (!model) {
        const result = await closest(providerID, [modelID])
        throw new ModelNotFoundError({
            providerID,
            modelID,
            suggestions: result ? [result.modelID] : undefined,
        })
    }

    return model
}

export async function closestProvider(providerID: string): Promise<string[]> {
    const { database } = await state()
    const ids = Object.keys(database)
    const results = fuzzysort.go(providerID, ids, { limit: 5 })
    return results.map((r) => r.target)
}

export async function closest(providerID: string, query: string[]): Promise<{ providerID: string; modelID: string } | undefined> {
    const provider = await getProvider(providerID)
    if (!provider) return undefined

    const models = Object.keys(provider.models)
    if (models.length === 0) return undefined

    // First try combined query
    const combined = query.join(" ")
    const results = fuzzysort.go(combined, models, { limit: 1 })
    if (results.length > 0) {
        return {
            providerID,
            modelID: results[0].target,
        }
    }

    // Try individual terms if combined fails
    for (const term of query) {
        const termResults = fuzzysort.go(term, models, { limit: 1 })
        if (termResults.length > 0) {
            return {
                providerID,
                modelID: termResults[0].target,
            }
        }
    }

    return undefined
}

export async function getSmallModel(providerID: string): Promise<Model | undefined> {
    const config = await Config.get()
    if (config.small_model) {
        const parsed = parseModel(config.small_model)
        if (parsed.providerID === providerID) {
            const provider = await getProvider(providerID)
            const model = provider?.models[parsed.modelID]
            if (model) return model
        }
    }

    const provider = await getProvider(providerID)
    if (!provider) return undefined

    const models = Object.values(provider.models)
    const priority = ["gpt-4o-mini", "claude-3-haiku", "gemini-1.5-flash", "llama-3-8b"]

    const candidates = priority
        .map((p) => models.find((m) => m.modelID.includes(p)))
        .filter((m): m is Model => m !== undefined)

    if (candidates.length > 0) return candidates[0]

    // Fallback to least expensive model
    return sortBy(models, (m) => m.cost.input + m.cost.output)[0]
}

const priority = ["claude-sonnet-4", "gpt-5", "big-pickle", "gemini-3-pro"]

export function sort(models: Model[]): Model[] {
    return sortBy(models, (m) => {
        const index = priority.findIndex((p) => (m.modelID ?? m.id)?.includes(p))
        return index === -1 ? priority.length : index
    })
}

export async function defaultModel(): Promise<Model> {
    const config = await Config.get()
    if (config.model) {
        const parsed = parseModel(config.model)
        const model = await getModel(parsed.providerID, parsed.modelID).catch(() => undefined)
        if (model) return model
    }

    const providers = await list()
    const allModels = Object.values(providers).flatMap((p) => Object.values(p.models))
    const sorted = sort(allModels)

    if (sorted.length === 0) {
        throw new Error("No models available")
    }

    return sorted[0]
}

export function parseModel(model: string): { providerID: string; modelID: string } {
    const [providerID, ...rest] = model.split("/")
    return {
        providerID,
        modelID: rest.join("/"),
    }
}
