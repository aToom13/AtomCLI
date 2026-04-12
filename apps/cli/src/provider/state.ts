import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Config } from "../config/config"
import { ModelsDev } from "./models"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Auth } from "@/auth"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { iife } from "@/util/iife"
import { ProviderTransform } from "./transform"
import type { LanguageModel, Provider as SDK } from "ai"
import type { Info, Model, CustomModelLoader } from "./types"
import { fromModelsDevProvider } from "./logic"
import { CUSTOM_LOADERS } from "./loaders"

const log = Log.create({ service: "provider" })

export interface ProviderState {
    models: Map<string, LanguageModel>
    providers: Record<string, Info>
    database: Record<string, Info>
    sdk: Map<any, SDK>
    modelLoaders: Record<string, CustomModelLoader>
}

export const state = Instance.state(async (): Promise<ProviderState> => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

    const isProviderAllowed = (providerID: string): boolean => {
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null
        if (disabled.has(providerID)) return false
        if (enabled && !enabled.has(providerID)) return false
        return true
    }

    const providers: Record<string, Info> = {}
    const languages = new Map<string, LanguageModel>()
    const modelLoaders: Record<string, CustomModelLoader> = {}
    const sdkCache = new Map<any, SDK>()

    const mergeProvider = (providerID: string, provider: Partial<Info>) => {
        const existing = providers[providerID] ?? database[providerID]
        if (!existing) return
        providers[providerID] = {
            ...existing,
            ...provider,
            source: provider.source ?? existing.source,
            options: mergeDeep(existing.options || {}, provider.options || {}),
            models: {
                ...existing.models,
                ...(provider.models || {}),
            },
        }
        // Final key check: If we have an explicit key in provider, update it
        if (provider.key) {
            providers[providerID].key = provider.key
        }
    }

    // Handle GitHub Copilot special case
    const githubCopilot = database["github-copilot"]
    if (githubCopilot) {
        database["github-copilot-enterprise"] = {
            ...githubCopilot,
            id: "github-copilot-enterprise",
            name: "GitHub Copilot Enterprise",
            models: mapValues(githubCopilot.models, (model) => ({
                ...model,
                providerID: "github-copilot-enterprise",
            })),
        }
    }

    // Process config.provider entries
    const configProviders = Object.entries(config.provider ?? {})
    for (const [providerID, providerConfig] of configProviders) {
        const existing = database[providerID]
        const parsed: Info = {
            id: providerID,
            name: (providerConfig as any).name ?? existing?.name ?? providerID,
            env: (providerConfig as any).env ?? existing?.env ?? [],
            npm: (providerConfig as any).npm ?? existing?.npm,
            options: mergeDeep(existing?.options ?? {}, (providerConfig as any).options ?? {}),
            source: "config",
            models: existing?.models ?? {},
        }

        // Apply whitelist/blacklist
        const whitelist = new Set((providerConfig as any).whitelist ?? [])
        const blacklist = new Set((providerConfig as any).blacklist ?? [])

        if (whitelist.size > 0) {
            parsed.models = pickBy(parsed.models, (m) => whitelist.has(m.modelID))
        }
        if (blacklist.size > 0) {
            parsed.models = pickBy(parsed.models, (m) => !blacklist.has(m.modelID))
        }

        const providerModels = (providerConfig as any).models ?? {}
        for (const [modelID, model] of Object.entries(providerModels) as [string, any][]) {
            const existingModel = parsed.models[model.id ?? modelID]
            const name = iife(() => {
                if (model.name) return model.name
                if (model.id && model.id !== modelID) return modelID
                return existingModel?.name ?? modelID
            })

            const parsedModel: Model = {
                id: modelID,
                modelID: modelID,
                api: {
                    id: model.id ?? existingModel?.api.id ?? modelID,
                    npm: model.provider?.npm ?? (providerConfig as any).npm ?? parsed.npm ?? existingModel?.api.npm ?? "@ai-sdk/openai-compatible",
                    url: (providerConfig as any).api ?? existingModel?.api.url ?? modelsDev[providerID]?.api ?? "",
                },
                status: (model.status as any) ?? existingModel?.status ?? "active",
                name,
                providerID,
                capabilities: {
                    temperature: (model as any).temperature ?? existingModel?.capabilities.temperature ?? false,
                    reasoning: (model as any).reasoning ?? existingModel?.capabilities.reasoning ?? false,
                    attachment: (model as any).attachment ?? existingModel?.capabilities.attachment ?? false,
                    toolcall: (model as any).tool_call ?? (existingModel as any)?.capabilities.toolcall ?? true,
                    interleaved: (model as any).interleaved ?? existingModel?.capabilities.interleaved ?? false,
                    input: {
                        text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
                        audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
                        image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
                        video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
                        pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
                    },
                    output: {
                        text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
                        audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
                        image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
                        video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
                        pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
                    },
                },
                cost: {
                    input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
                    output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
                    cache: {
                        read: model?.cost?.cache_read ?? (existingModel as any)?.cost?.cache?.read ?? 0,
                        write: model?.cost?.cache_write ?? (existingModel as any)?.cost?.cache?.write ?? 0,
                    },
                },
                limit: {
                    context: model?.limit?.context ?? existingModel?.limit?.context ?? 0,
                    output: model?.limit?.output ?? existingModel?.limit?.output ?? 0,
                },
                headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
                family: model.family ?? existingModel?.family ?? "",
                release_date: model.release_date ?? existingModel?.release_date ?? "",
                options: model.options ?? existingModel?.options ?? {},
                variants: {},
            }

            const variants = ProviderTransform.variants(parsedModel)
            const mergedVariants = mergeDeep(variants as any, model.variants ?? {})
            parsedModel.variants = mapValues(
                pickBy(mergedVariants, (v: any) => !v.disabled),
                (v: any) => omit(v, ["disabled"]),
            )
            parsed.models[modelID] = parsedModel
        }
        database[providerID] = parsed
        if (isProviderAllowed(providerID)) {
            mergeProvider(providerID, { source: "config" })
        }
    }

    // Load from environment variables
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
        if (!isProviderAllowed(providerID)) continue
        if (provider.env.length === 1) {
            const apiKey = env[provider.env[0]]
            if (apiKey) {
                mergeProvider(providerID, {
                    source: "env",
                    key: apiKey,
                })
            }
        }
    }

    // Load custom providers from plugins
    for (const plugin of await Plugin.list()) {
        if (!plugin.auth) continue
        const providerID = plugin.auth.provider
        if (!isProviderAllowed(providerID)) continue

        const options = await iife(async () => {
            if (plugin.auth?.type === "custom") {
                const auth = await Auth.get(plugin.auth.provider)
                if (auth?.type === "api") return { apiKey: auth.key }
            }
            return undefined
        })

        if (options || plugin.auth.type === "api") {
            mergeProvider(plugin.auth.provider, {
                source: "custom",
                options: options,
            })
        }

        // Special case for GitHub Copilot enterprise
        if (providerID === "github-copilot") {
            const enterpriseProviderID = "github-copilot-enterprise"
            if (isProviderAllowed(enterpriseProviderID)) {
                const enterpriseAuth = await Auth.get(enterpriseProviderID)
                if (enterpriseAuth?.type === "api") {
                    mergeProvider(enterpriseProviderID, {
                        source: "custom",
                        options: { apiKey: enterpriseAuth.key },
                    })
                }
            }
        }
    }

    // Load from CUSTOM_LOADERS
    for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
        if (!isProviderAllowed(providerID)) continue
        const result = await fn(database[providerID])
        if (result && (result.autoload || providers[providerID])) {
            const partial: Partial<Info> = {
                source: "custom",
                models: result.models,
                options: result.options,
            }
            mergeProvider(providerID, partial)
            if (result.getModel) {
                modelLoaders[providerID] = result.getModel
            }
        }
    }

    // Final cleanup and validation
    for (const [providerID, provider] of Object.entries(providers)) {
        if (!isProviderAllowed(providerID)) {
            delete providers[providerID]
            continue
        }

        // Fix for github-copilot-enterprise npm package
        if (providerID === "github-copilot-enterprise") {
            provider.models = mapValues(provider.models, (model) => ({
                ...model,
                api: {
                    ...model.api,
                    npm: "@ai-sdk/github-copilot",
                },
            }))
        }

        for (const [modelID, model] of Object.entries(provider.models)) {
            model.api.id = model.api.id ?? model.modelID ?? modelID
            // GPT-5 spoofing logic
            if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat")) {
                const variants = ProviderTransform.variants(model)
                const mergedVariants = mergeDeep(variants as any, (config.provider?.[providerID]?.models?.[modelID] as any)?.variants ?? {})
                model.variants = mapValues(
                    pickBy(mergedVariants, (v: any) => !v.disabled),
                    (v: any) => omit(v, ["disabled"]),
                )
            }
        }

        if (Object.keys(provider.models).length === 0) {
            delete providers[providerID]
            continue
        }

        log.info("found", { providerID })
    }

    return {
        models: languages,
        providers,
        database,
        sdk: sdkCache,
        modelLoaders,
    }
})
