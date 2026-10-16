import { Config } from "@/core/config/config"
import { Auth } from "@/services/auth"
import { Env } from "@/core/env"
import { Log } from "@/util/util/log"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { fetchOpenAICompatibleModels } from "./custom"
import type { Provider } from "./provider"

const log = Log.create({ service: "provider.catalog" })

export async function applyConfiguredProviders(input: {
  config: Awaited<ReturnType<typeof Config.get>>
  database: Record<string, Provider.Info>
  modelsDev: Record<string, any>
  configuredVariants: (existing: Provider.Model | undefined, parsed: Provider.Model) => Record<string, any>
}) {
  for (const [providerID, provider] of Object.entries(input.config.provider ?? {})) {
    const existing = input.database[providerID]
    let configuredModels = provider.models ?? {}
    const baseURL = provider.api ?? provider.options?.baseURL
    const npm = provider.npm ?? Object.values(existing?.models ?? {})[0]?.api.npm
    if (provider.options?.modelDiscovery !== false && npm === "@ai-sdk/openai-compatible" && baseURL) {
      const storedAuth = await Auth.get(providerID)
      const apiKey =
        storedAuth?.type === "api"
          ? storedAuth.key
          : (provider.options?.apiKey ?? provider.env?.map(Env.get).find(Boolean))
      const discovery = await fetchOpenAICompatibleModels({
        baseURL,
        apiKey,
        headers: provider.options?.headers,
        timeout: 10_000,
      })
      if (discovery.ok && discovery.models.length > 0) {
        configuredModels = Object.fromEntries(
          discovery.models.map((model) => [
            model.id,
            mergeDeep(
              {
                name: model.name,
                tool_call: model.tool_call,
                reasoning: model.reasoning,
                attachment: model.attachment,
                temperature: model.temperature,
                interleaved: model.interleaved,
                limit: model.limit,
                modalities: model.modalities,
                cost: model.cost,
                release_date: model.release_date,
                options: {
                  _modelDiscovery: true,
                  ...(model.cost ? {} : { _billing: apiKey ? "subscription" : "unknown" }),
                },
              },
              provider.models?.[model.id] ?? {},
            ),
          ]),
        )
        log.info("refreshed custom provider models", { providerID, count: discovery.models.length })
      } else
        log.warn("failed to refresh custom provider models; retaining configured catalog", {
          providerID,
          error: discovery.error ?? "empty model list",
        })
    }
    const parsed: Provider.Info = {
      id: providerID,
      name: provider.name ?? existing?.name ?? providerID,
      env: provider.env ?? existing?.env ?? [],
      options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
      source: "config",
      models: existing?.models ?? {},
    }
    for (const [modelID, model] of Object.entries(configuredModels)) {
      const existingModel = parsed.models[model.id ?? modelID]
      const parsedModel: Provider.Model = {
        id: modelID,
        api: {
          id: model.id ?? existingModel?.api.id ?? modelID,
          npm:
            model.provider?.npm ??
            provider.npm ??
            existingModel?.api.npm ??
            input.modelsDev[providerID]?.npm ??
            "@ai-sdk/openai-compatible",
          url: provider.api ?? existingModel?.api.url ?? input.modelsDev[providerID]?.api,
        },
        status: model.status ?? existingModel?.status ?? "active",
        name: model.name ?? (model.id && model.id !== modelID ? modelID : (existingModel?.name ?? modelID)),
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
          input: model.cost?.input ?? existingModel?.cost?.input ?? 0,
          output: model.cost?.output ?? existingModel?.cost?.output ?? 0,
          cache: {
            read: model.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
            write: model.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
          },
        },
        options: {
          ...(mergeDeep(existingModel?.options ?? {}, model.options ?? {}) as Record<string, any>),
          _catalogCostKnown: model.cost !== undefined || existingModel?.options?._catalogCostKnown === true,
        },
        limit: {
          context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
          output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
        },
        headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
        family: model.family ?? existingModel?.family ?? "",
        release_date: model.release_date ?? existingModel?.release_date ?? "",
        variants: {},
      }
      const merged = mergeDeep(input.configuredVariants(existingModel, parsedModel), model.variants ?? {})
      parsedModel.variants = mapValues(
        pickBy(merged, (v) => !(v as any).disabled),
        (v) => omit(v as any, ["disabled"]),
      ) as any
      parsed.models[modelID] = parsedModel
    }
    input.database[providerID] = parsed
  }
}
