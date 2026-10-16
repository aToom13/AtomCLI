import type { Provider as SDK } from "ai"
import type { LanguageModelV2 } from "@openrouter/ai-sdk-provider"
import { Config } from "@/core/config/config"
import { getNoSuchModelError } from "@/util/util/ai-compat"
import { ProviderModels } from "./models-runtime"

export namespace ProviderSelection {
  export type Model = ProviderModels.Model
  export type Info = ProviderModels.Info
  export type State = {
    providers: Record<string, Info>
    models: Map<string, LanguageModelV2>
    modelLoaders: Record<string, (sdk: SDK, modelID: string, options?: Record<string, any>) => Promise<any>>
  }

  export async function language(
    model: Model,
    deps: {
      state: () => Promise<State>
      getSDK: (model: Model) => Promise<SDK>
      modelNotFoundError: any
    },
  ): Promise<LanguageModelV2> {
    const state = await deps.state()
    const key = `${model.providerID}/${model.id}`
    if (state.models.has(key)) return state.models.get(key)!

    const provider = state.providers[model.providerID]
    const sdk = await deps.getSDK(model)

    try {
      const language = state.modelLoaders[model.providerID]
        ? await state.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
        : sdk.languageModel(model.api.id)
      state.models.set(key, language)
      return language
    } catch (error) {
      const NoSuchModelError = await getNoSuchModelError()
      if (error instanceof NoSuchModelError) {
        throw new deps.modelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: error },
        )
      }
      throw error
    }
  }

  export async function closest(
    providerID: string,
    query: string[],
    state: () => Promise<State>,
  ) {
    const provider = (await state()).providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item)) return { providerID, modelID }
      }
    }
  }

  export async function smallModel(
    providerID: string,
    deps: {
      state: () => Promise<State>
      getModel: (providerID: string, modelID: string) => Promise<Model>
      parseModel: (model: string) => { providerID: string; modelID: string }
    },
  ) {
    const config = await Config.get()
    if (config.small_model) {
      const parsed = deps.parseModel(config.small_model)
      return deps.getModel(parsed.providerID, parsed.modelID)
    }

    const provider = (await deps.state()).providers[providerID]
    if (provider) {
      let priority = [
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "3-5-haiku",
        "3.5-haiku",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gpt-5-nano",
      ]
      if (providerID.startsWith("atomcli")) priority = ["gpt-5-nano"]
      if (providerID.startsWith("github-copilot")) priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return deps.getModel(providerID, model)
        }
      }
    }

    const atomcli = (await deps.state()).providers["atomcli"]
    if (atomcli && atomcli.models["gpt-5-nano"]) return deps.getModel("atomcli", "gpt-5-nano")
    return undefined
  }

  const priority = ["atomcli-auto", "atomcli/atomcli-auto", "atomcli/gpt-5-nano", "gpt-5-nano", "atomcli/big-pickle"]
  export function sort(models: Model[]) {
    return models.toSorted((a, b) => {
      const aPriority = priority.findIndex((filter) => a.id.includes(filter))
      const bPriority = priority.findIndex((filter) => b.id.includes(filter))
      if (aPriority !== bPriority) return bPriority - aPriority
      const aLatest = a.id.includes("latest") ? 0 : 1
      const bLatest = b.id.includes("latest") ? 0 : 1
      if (aLatest !== bLatest) return aLatest - bLatest
      return b.id.localeCompare(a.id)
    })
  }

  export async function defaultModel(
    deps: {
      state: () => Promise<State>
      getProvider: (providerID: string) => Promise<Info | undefined>
      getModel: (providerID: string, modelID: string) => Promise<Model>
      parseModel: (model: string) => { providerID: string; modelID: string }
      list: () => Promise<Record<string, Info>>
    },
  ) {
    const config = await Config.get()
    if (config.model) {
      const configured = deps.parseModel(config.model)
      const provider = await deps.getProvider(configured.providerID).catch(() => undefined)
      if (provider?.models[configured.modelID]) return configured
    }

    const atomcli = await deps.getProvider("atomcli").catch(() => undefined)
    if (atomcli) {
      if (atomcli.models["atomcli-auto"]) return { providerID: "atomcli", modelID: "atomcli-auto" }
      if (atomcli.models["gpt-5-nano"]) return { providerID: "atomcli", modelID: "gpt-5-nano" }
      if (atomcli.models["big-pickle"]) return { providerID: "atomcli", modelID: "big-pickle" }
      const [model] = sort(Object.values(atomcli.models))
      if (model) return { providerID: "atomcli", modelID: model.id }
    }

    const provider = Object.values(await deps.list()).find(
      (item) => !config.provider || Object.keys(config.provider).includes(item.id),
    )
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return { providerID: provider.id, modelID: model.id }
  }
}
