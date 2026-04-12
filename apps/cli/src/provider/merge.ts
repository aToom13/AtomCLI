import { mergeDeep, mapValues, pickBy, omit } from "remeda"
import { iife } from "@/util/iife"
import { ProviderTransform } from "./transform"
import { Info, Model } from "./types"
import { ModelsDev } from "./models"

export function mergeConfigProvider(
    providerID: string,
    provider: any,
    database: Record<string, any>,
    modelsDev: Record<string, any>
): Info {
    const existing = database[providerID]
    const parsed: Info = {
        id: providerID,
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
    }

    for (const [modelID, model] of Object.entries(provider.models ?? {}) as [string, any][]) {
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
            if (model.name) return model.name
            if (model.id && model.id !== modelID) return modelID
            return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
            id: modelID,
            api: {
                id: model.id ?? existingModel?.api.id ?? modelID,
                npm:
                    model.provider?.npm ??
                    provider.npm ??
                    existingModel?.api.npm ??
                    modelsDev[providerID]?.npm ??
                    "@ai-sdk/openai-compatible",
                url: provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
            },
            status: model.status ?? existingModel?.status ?? "active",
            name,
            providerID,
            capabilities: {
                temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
                reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
                attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
                toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
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
                interleaved: model.interleaved ?? false,
            },
            cost: {
                input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
                output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
                cache: {
                    read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
                    write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
                },
            },
            options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
            limit: {
                context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
                output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
            },
            headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
            family: model.family ?? existingModel?.family ?? "",
            release_date: model.release_date ?? existingModel?.release_date ?? "",
            variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
    }
    return parsed
}
