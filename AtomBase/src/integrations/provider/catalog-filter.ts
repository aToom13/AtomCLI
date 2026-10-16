import { Flag } from "@/interfaces/flag/flag"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import type { Provider } from "./provider"

export function filterCatalog(input: {
  providers: Record<string, Provider.Info>
  config: Awaited<ReturnType<typeof import("@/core/config/config").Config.get>>
  disabled: Set<string>
  allowed: (id: string) => boolean
  log: (message: string, data: Record<string, unknown>) => void
}) {
  for (const [providerID, provider] of Object.entries(input.providers)) {
    if (!input.allowed(providerID)) {
      delete input.providers[providerID]
      continue
    }
    if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
      provider.models = mapValues(provider.models, (model) => ({ ...model, api: { ...model.api, npm: "@ai-sdk/github-copilot" } }))
    }
    const configProvider = input.config.provider?.[providerID]
    for (const [modelID, model] of Object.entries(provider.models)) {
      model.api.id = model.api.id ?? model.id ?? modelID
      if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat")) delete provider.models[modelID]
      if (model.status === "alpha" && !Flag.ATOMCLI_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
      if (model.status === "deprecated") delete provider.models[modelID]
      if (configProvider?.blacklist?.includes(modelID) || (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))) delete provider.models[modelID]
      const configVariants = configProvider?.models?.[modelID]?.variants
      if (configVariants && model.variants) {
        const merged = mergeDeep(model.variants, configVariants)
        model.variants = mapValues(pickBy(merged, (v) => !(v as any).disabled), (v) => omit(v as any, ["disabled"])) as any
      }
    }
    if (Object.keys(provider.models).length === 0) delete input.providers[providerID]
    else input.log("found", { providerID })
  }
}
