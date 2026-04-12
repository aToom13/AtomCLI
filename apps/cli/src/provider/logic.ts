import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { iife } from "@/util/iife"
import type { ModelsDev } from "./models"
import { ProviderTransform } from "./transform"
import type { Model, Info } from "./types"

export function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const parsedModel: Model = {
        id: model.id,
        modelID: model.id,
        api: {
            id: model.id,
            npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
            url: provider.api ?? "",
        },
        status: (model.status as any) ?? "active",
        name: model.name,
        family: model.family,
        providerID: provider.id,
        capabilities: {
            temperature: model.temperature ?? false,
            reasoning: model.reasoning ?? false,
            attachment: model.attachment ?? false,
            toolcall: model.tool_call ?? true,
            interleaved: model.interleaved ?? false,
            input: {
                text: model.modalities?.input?.includes("text") ?? true,
                audio: model.modalities?.input?.includes("audio") ?? false,
                image: model.modalities?.input?.includes("image") ?? false,
                video: model.modalities?.input?.includes("video") ?? false,
                pdf: model.modalities?.input?.includes("pdf") ?? false,
            },
            output: {
                text: model.modalities?.output?.includes("text") ?? true,
                audio: model.modalities?.output?.includes("audio") ?? false,
                image: model.modalities?.output?.includes("image") ?? false,
                video: model.modalities?.output?.includes("video") ?? false,
                pdf: model.modalities?.output?.includes("pdf") ?? false,
            },
        },
        cost: {
            input: model.cost?.input ?? 0,
            output: model.cost?.output ?? 0,
            cache: {
                read: model.cost?.cache_read ?? 0,
                write: model.cost?.cache_write ?? 0,
            },
            experimentalOver200K: model.cost?.context_over_200k
                ? {
                    input: model.cost.context_over_200k.input,
                    output: model.cost.context_over_200k.output,
                    cache: {
                        read: model.cost.context_over_200k.cache_read ?? 0,
                        write: model.cost.context_over_200k.cache_write ?? 0,
                    },
                }
                : undefined,
        },
        limit: {
            context: model.limit.context,
            output: model.limit.output,
        },
        options: model.options ?? {},
        headers: model.headers ?? {},
        release_date: model.release_date ?? "",
        variants: {},
    }

    const variants = ProviderTransform.variants(parsedModel)
    parsedModel.variants = mapValues(
        pickBy(variants, (v) => !v.disabled),
        (v) => omit(v, ["disabled"]),
    )

    return parsedModel
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
        id: provider.id,
        name: provider.name,
        source: "api",
        env: provider.env,
        npm: provider.npm,
        options: (provider as any).options ?? {},
        models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
}
