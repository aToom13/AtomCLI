import { mergeDeep, mapValues, pickBy, omit } from "remeda"
import { Log } from "../util/log"
import type { Info, Model } from "./types"
import { Flag } from "../flag/flag"

const log = Log.create({ service: "provider:filter" })

export function filterProviders(
    providers: Record<string, Info>,
    config: any,
    disabled: Set<string>,
    enabled: Set<string> | null
) {
    for (const [providerID, provider] of Object.entries(providers)) {
        if (enabled && !enabled.has(providerID)) {
            delete providers[providerID]
            continue
        }
        if (disabled.has(providerID)) {
            delete providers[providerID]
            continue
        }

        // Special case for GitHub Copilot aliases
        if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
            provider.models = mapValues(provider.models, (model) => ({
                ...model,
                api: { ...model.api, npm: "@ai-sdk/github-copilot" },
            }))
        }

        const configProvider = config.provider?.[providerID]
        for (const [modelID, model] of Object.entries(provider.models)) {
            model.api.id = model.api.id ?? model.id ?? modelID

            // Filter out specific models (system logic)
            if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
                delete provider.models[modelID]
            if (model.status === "alpha" && !Flag.ATOMCLI_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
            if (model.status === "deprecated") delete provider.models[modelID]

            // Config filters
            if (
                (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
                (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
            )
                delete provider.models[modelID]

            // Variants merging
            const configVariants = configProvider?.models?.[modelID]?.variants
            if (configVariants && model.variants) {
                const merged = mergeDeep(model.variants, configVariants)
                model.variants = mapValues(pickBy(merged, (v) => !v.disabled), (v) => omit(v, ["disabled"]))
            }
        }

        if (Object.keys(provider.models).length === 0) {
            delete providers[providerID]
            continue
        }
        log.info("found", { providerID })
    }
}
