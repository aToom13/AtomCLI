import z from "zod"
import { mapValues } from "remeda"
import { ModelsDev } from "./models"
import { ProviderTransform } from "./transform"
import { ModelAvailability } from "./availability"
import { ModelVerification } from "./verification"
import { ProviderSchema } from "./schema"
import { RouteEligibility } from "@/core/routing/route-eligibility"
import { ModelBilling } from "./billing"

export namespace ProviderModels {
  export const Model = ProviderSchema.Model
  export type Model = z.infer<typeof Model>

  export const Info = ProviderSchema.Info
  export type Info = z.infer<typeof Info>

  export const RoutePolicy = z.object({
    requested: z.string(),
    mode: z.enum(["explicit", "auto", "free"]),
    allowedProviders: z.array(z.string()),
    allowedModels: z.array(z.string()).optional(),
    excluded: z.array(z.string()).default([]),
    requiredCapabilities: z.array(ModelVerification.Capability).default(["text"]),
    freeOnly: z.boolean(),
    requireVerification: z.boolean(),
    variant: z.string().optional(),
  })
  export type RoutePolicy = z.infer<typeof RoutePolicy>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const result: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: {
        ...model.options,
        _catalogCostKnown: model.cost !== undefined,
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

    const declaredVariants = ProviderTransform.reasoningVariants(model, result)
    result.variants = mapValues(declaredVariants ?? ProviderTransform.variants(result), (variant) => variant)
    return result
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

  export function isExplicitlyFree(model: Pick<Model, "api" | "cost" | "options">): boolean {
    return ModelBilling.classify(model) === "free"
  }

  export function routePolicy(model: Model): RoutePolicy {
    const parsed = RoutePolicy.safeParse((model.options as any)?._routePolicy)
    if (parsed.success) return parsed.data
    return {
      requested: `${model.providerID}/${model.id}`,
      mode: "explicit",
      allowedProviders: [model.providerID],
      excluded: [],
      requiredCapabilities: ["text"],
      freeOnly: false,
      requireVerification: false,
    }
  }

  export function applyRoutePolicy(model: Model, policy: RoutePolicy): Model {
    return {
      ...model,
      options: { ...model.options, _routePolicy: policy },
    }
  }

  export async function isRouteEligible(
    model: Model,
    policy: RoutePolicy,
    capability: ModelVerification.Capability,
    getProvider: (providerID: string) => Promise<Info | undefined>,
    context?: { effectiveParams?: unknown },
  ) {
    const provider = await getProvider(model.providerID)
    const effectiveParams =
      context?.effectiveParams ??
      ({
        modelOptions: model.options,
        variantOptions: policy.variant ? model.variants?.[policy.variant] : undefined,
      } as const)
    const paramsDigest = await ModelVerification.paramsDigest(effectiveParams)
    if (!provider) return false
    const key = await ModelVerification.identity(model, provider, {
      variant: policy.variant,
      ...(context?.effectiveParams !== undefined ? { effectiveParams: context.effectiveParams } : {}),
    })
    const evidence = await ModelVerification.get(key)
    const price =
      !model.cost || model.options?._catalogCostKnown === false ? "unknown" : isExplicitlyFree(model) ? "free" : "paid"
    return (
      RouteEligibility.evaluate({
        model,
        connected: Boolean(provider),
        available: model.status !== "deprecated" && !ModelAvailability.active(model.availability),
        providerAllowed:
          (policy.mode !== "free" || model.providerID === "atomcli") &&
          policy.allowedProviders.includes(model.providerID),
        modelExcluded:
          policy.excluded.includes(model.id) ||
          policy.excluded.includes(`${model.providerID}/${model.id}`) ||
          (policy.allowedModels !== undefined && !policy.allowedModels.includes(`${model.providerID}/${model.id}`)),
        freeOnly: policy.freeOnly,
        price,
        requiredCapabilities: [capability],
        variant: policy.variant,
        paramsDigest,
        verificationKey: key,
        verification: evidence,
        requireVerification: policy.requireVerification,
      }).decision === "eligible"
    )
  }

  export function isPublicAtomCLIModel(model: Model): boolean {
    if (model.status === "deprecated") return false
    return isExplicitlyFree(model)
  }

  export type InputModality = "image" | "pdf" | "audio" | "video"

  export function requiredInputModalities(parts: { type?: string; mime?: string }[]): Set<InputModality> {
    const required = new Set<InputModality>()
    for (const part of parts) {
      if (part.type !== "file" || !part.mime) continue
      if (part.mime.startsWith("image/")) required.add("image")
      else if (part.mime === "application/pdf") required.add("pdf")
      else if (part.mime.startsWith("audio/")) required.add("audio")
      else if (part.mime.startsWith("video/")) required.add("video")
    }
    return required
  }

  export function supportsInputModalities(model: Model, required: Set<InputModality>): boolean {
    return Array.from(required).every((modality) => model.capabilities.input[modality])
  }
}
