import { ModelsDev } from "./models"
import { Info, Model } from "./types"
import { ProviderTransform } from "./transform"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"

export function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
        id: model.id,
        providerID: provider.id,
        name: model.name,
        family: model.family,
        api: {
            id: model.id,
            url: provider.api!,
            npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
        },
        status: model.status ?? "active",
        headers: model.headers ?? {},
        options: model.options ?? {},
        cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cache: {
                read: model.cost?.cache_read ?? 0,
                write: model.cost?.cache_write ?? 0,
            },
            experimentalOver200K: model.cost?.context_over_200k
                ? {
                    cache: {
                        read: model.cost.context_over_200k.cache_read ?? 0,
                        write: model.cost.context_over_200k.cache_write ?? 0,
                    },
                    input: model.cost.context_over_200k.input,
                    output: model.cost.context_over_200k.output,
                }
                : undefined,
        },
        limit: {
            context: model.limit.context,
            output: model.limit.output,
        },
        capabilities: {
            temperature: model.temperature,
            reasoning: model.reasoning,
            attachment: model.attachment,
            toolcall: model.tool_call,
            input: {
                text: model.modalities?.input?.includes("text") ?? false,
                audio: model.modalities?.input?.includes("audio") ?? false,
                image: model.modalities?.input?.includes("image") ?? false,
                video: model.modalities?.input?.includes("video") ?? false,
                pdf: model.modalities?.input?.includes("pdf") ?? false,
            },
            output: {
                text: model.modalities?.output?.includes("text") ?? false,
                audio: model.modalities?.output?.includes("audio") ?? false,
                image: model.modalities?.output?.includes("image") ?? false,
                video: model.modalities?.output?.includes("video") ?? false,
                pdf: model.modalities?.output?.includes("pdf") ?? false,
            },
            interleaved: model.interleaved ?? false,
        },
        release_date: model.release_date,
        variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
        id: provider.id,
        source: "custom",
        name: provider.name,
        env: provider.env ?? [],
        options: {},
        models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
}
