import { describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { ModelsDev } from "@/integrations/provider/models"
import { Provider } from "@/integrations/provider/provider"
import { ProviderTransform } from "@/integrations/provider/transform"
import { ModelAvailability } from "@/integrations/provider/availability"
import { Plugin } from "@/integrations/plugin"
import { AuthLogin } from "@/interfaces/cli/cmd/auth"
import { Auth } from "@/services/auth"
import { tmpdir } from "../fixture/fixture"

const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
const fixture = (await Bun.file(fixturePath).json()) as Record<string, ModelsDev.Provider>
const entries = Object.entries(fixture).sort(([left], [right]) => left.localeCompare(right))
const live = process.env["ATOMCLI_PROVIDER_LIVE_TEST"] === "1"
const anonymous = process.env["ATOMCLI_PROVIDER_ANONYMOUS_TEST"] === "1"
const atomcliAudit = process.env["ATOMCLI_PROVIDER_ATOMCLI_TEST"] === "1"
const providerLiveAudit = live || anonymous || atomcliAudit

const dynamicPackages = new Set([
  "@ai-sdk/github-copilot",
  "@aihubmix/ai-sdk-provider",
  "@mymediset/sap-ai-provider",
  "workers-ai-provider",
])

const bundledPackages = new Set([
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/gateway",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/perplexity",
  "@ai-sdk/togetherai",
  "@ai-sdk/vercel",
  "@ai-sdk/xai",
  "@openrouter/ai-sdk-provider",
])

function packageName(provider: ModelsDev.Provider, model: ModelsDev.Model) {
  return model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"
}

function probeModel(provider: ModelsDev.Provider) {
  return Object.values(provider.models)
    .filter((model) => model.status !== "deprecated" && model.status !== "alpha")
    .filter((model) => model.limit.context > 0 && model.limit.output > 0)
    .filter((model) => model.modalities?.output?.includes("text") ?? true)
    .sort((left, right) => {
      const leftScore = Number(left.tool_call) + Number(left.modalities?.input?.includes("text") ?? true)
      const rightScore = Number(right.tool_call) + Number(right.modalities?.input?.includes("text") ?? true)
      return rightScore - leftScore || left.id.localeCompare(right.id)
    })[0]
}

function providerConfig() {
  return Object.fromEntries(
    entries.map(([providerID, provider]) => {
      const model = probeModel(provider)
      return [
        providerID,
        {
          whitelist: model ? [model.id] : undefined,
          options: {
            apiKey: "atomcli-provider-contract-test",
            baseURL: "https://provider.invalid/v1",
            project: "atomcli-provider-contract-test",
            location: "us-central1",
          },
        },
      ]
    }),
  )
}

function liveProbeModels(providerID: string, provider: Provider.Info) {
  const candidates = Object.values(provider.models)
    .filter((model) => model.status === "active" || model.status === "beta")
    .filter((model) => model.limit.context > 0 && model.limit.output > 0)
    .filter((model) => model.capabilities.input.text && model.capabilities.output.text)

  const preferred: Record<string, string[]> = {
    atomcli: ["atomcli-free", "atomcli-auto"],
    antigravity: ["gemini-2.5-pro", "gemini-3-flash"],
  }
  for (const modelID of preferred[providerID] ?? []) {
    const match = candidates.find((model) => model.id === modelID)
    if (match) return [match, ...candidates.filter((model) => model !== match)].slice(0, 3)
  }

  if (providerID === "kilocode") {
    const free = candidates.find((model) => model.id.includes(":free") || model.id.includes("/free"))
    if (free) return [free, ...candidates.filter((model) => model !== free)].slice(0, 3)
  }

  return candidates
    .sort(
      (left, right) =>
        right.release_date.localeCompare(left.release_date) ||
        Number(right.capabilities.toolcall) - Number(left.capabilities.toolcall) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3)
}

function providerAbortSignal(provider: Provider.Info) {
  const timeout = Provider.requestTimeout(provider.options)
  return timeout === false ? undefined : AbortSignal.timeout(timeout)
}

describe("provider catalog contracts", () => {
  test("fixture contains a broad provider catalog", () => {
    expect(entries.length).toBeGreaterThanOrEqual(70)
    expect(entries.reduce((total, [, provider]) => total + Object.keys(provider.models).length, 0)).toBeGreaterThan(
      2_000,
    )
  })

  for (const [providerID, rawProvider] of entries) {
    test(`${providerID}: metadata and every model satisfy AtomCLI contracts`, () => {
      const parsedProvider = ModelsDev.Provider.parse(rawProvider)
      const provider = Provider.fromModelsDevProvider(parsedProvider)

      expect(parsedProvider.id).toBe(providerID)
      expect(parsedProvider.name.trim().length).toBeGreaterThan(0)
      expect(Object.keys(parsedProvider.models).length).toBeGreaterThan(0)
      expect(Provider.Info.safeParse(provider).success).toBe(true)

      for (const [modelID, rawModel] of Object.entries(parsedProvider.models)) {
        const model = provider.models[modelID]
        expect(rawModel.id).toBe(modelID)
        expect(model.id).toBe(modelID)
        expect(model.providerID).toBe(providerID)
        expect(model.api.id.trim().length).toBeGreaterThan(0)
        expect(model.api.npm.trim().length).toBeGreaterThan(0)
        expect(model.name.trim().length).toBeGreaterThan(0)
        expect(Number.isFinite(model.limit.context)).toBe(true)
        expect(Number.isFinite(model.limit.output)).toBe(true)
        expect(model.limit.context).toBeGreaterThanOrEqual(0)
        expect(model.limit.output).toBeGreaterThanOrEqual(0)
        expect(Provider.Model.safeParse(model).success).toBe(true)
      }

      expect(probeModel(parsedProvider)).toBeDefined()
    })
  }

  test("every advertised model maps to a supported runtime adapter", () => {
    const unsupported: string[] = []

    for (const [providerID, provider] of entries) {
      for (const model of Object.values(provider.models)) {
        const npm = providerID === "github-copilot" ? "@ai-sdk/github-copilot" : packageName(provider, model)
        if (!bundledPackages.has(npm) && !dynamicPackages.has(npm))
          unsupported.push(`${providerID}/${model.id}: ${npm}`)
      }
    }

    expect(unsupported).toEqual([])
  })

  test("auth login exposes every catalog and plugin-auth provider", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugins = await Plugin.list()
        const options = AuthLogin.providers(fixture, plugins, {})
        const optionIDs = new Set(options.map((provider) => provider.id))
        const pluginAuth = plugins.filter((plugin) => plugin.auth)

        for (const [providerID] of entries) expect(optionIDs.has(providerID)).toBe(true)
        for (const plugin of pluginAuth) {
          const auth = plugin.auth!
          expect(optionIDs.has(auth.provider)).toBe(true)
          expect(auth.provider.trim().length).toBeGreaterThan(0)
          expect(auth.methods.length).toBeGreaterThan(0)
          expect(typeof auth.loader).toBe("function")

          for (const method of auth.methods) {
            expect(["api", "oauth"]).toContain(method.type)
            expect(method.label.trim().length).toBeGreaterThan(0)
            if (method.type === "oauth") expect(typeof method.authorize).toBe("function")
          }
        }

        expect(new Set(options.map((provider) => provider.id)).size).toBe(options.length)
      },
    })
  })

  test("auth login applies enabled and disabled provider filters", () => {
    const plugins: Array<{ auth?: any }> = [{ auth: { provider: "plugin-only" } }]
    expect(
      AuthLogin.providers(fixture, plugins, { enabled_providers: ["openai", "plugin-only"] }).map((x) => x.id),
    ).toEqual(["openai", "plugin-only"])
    expect(
      AuthLogin.providers(fixture, plugins, { disabled_providers: ["openai", "plugin-only"] }).some(
        (x) => x.id === "openai" || x.id === "plugin-only",
      ),
    ).toBe(false)
  })

  test("auth login never advertises a provider without a credential path", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plugins = await Plugin.list()
        const pluginAuth = new Set(plugins.filter((plugin) => plugin.auth).map((plugin) => plugin.auth!.provider))
        const unsupported = AuthLogin.providers(fixture, plugins, {})
          .filter((provider) => provider.env.length === 0 && !pluginAuth.has(provider.id))
          .map((provider) => provider.id)

        expect(unsupported).toEqual([])
      },
    })
  })

})

describe("provider SDK compatibility", () => {
  test.skipIf(providerLiveAudit)(
    "every bundled provider constructs an AI SDK v2 language model",
    async () => {
      await using tmp = await tmpdir({
        config: {
          provider: providerConfig(),
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const providers = await Provider.list()
          const failures: string[] = []
          let checked = 0

          for (const [providerID, provider] of Object.entries(providers)) {
            const parsed = Provider.Info.safeParse(provider)
            if (!parsed.success) failures.push(`${providerID}: runtime provider does not satisfy Provider.Info`)
          }

          for (const [providerID, rawProvider] of entries) {
            const candidate = probeModel(rawProvider)
            if (!candidate) continue

            const npm = providerID === "github-copilot" ? "@ai-sdk/github-copilot" : packageName(rawProvider, candidate)
            if (!bundledPackages.has(npm)) continue

            try {
              const model = await Provider.getModel(providerID, candidate.id)
              const language = await Provider.getLanguage(model)
              expect(language.specificationVersion).toBe("v2")
              expect(language.modelId).toBe(model.api.id)
              expect(typeof language.doGenerate).toBe("function")
              expect(typeof language.doStream).toBe("function")
              checked++
            } catch (error) {
              failures.push(`${providerID}/${candidate.id} (${npm}): ${(error as Error).message}`)
            }
          }

          expect(checked).toBeGreaterThanOrEqual(65)
          expect(failures).toEqual([])
          expect(Config.get).toBeDefined()
          expect(Object.keys(providers).length).toBeGreaterThanOrEqual(entries.length)
        },
      })
    },
    30_000,
  )
})

async function generateWithProvider(
  providerID: string,
  provider: Provider.Info,
  streamText: typeof import("ai").streamText,
) {
  const attempts: string[] = []
  for (const candidate of liveProbeModels(providerID, provider)) {
    try {
      const model = await Provider.getModel(providerID, candidate.id)
      const language = await Provider.getLanguage(model)
      const options = ProviderTransform.options(model, "provider-compatibility-test", provider.options)
      const isCodex = providerID === "openai" && (await Auth.get(providerID))?.type === "oauth"
      if (isCodex) options.store = false
      let streamError: unknown
      const result = streamText({
        model: language,
        prompt: "Reply with exactly ATOMCLI_OK",
        maxOutputTokens: isCodex ? undefined : 128,
        maxRetries: 0,
        providerOptions: ProviderTransform.providerOptions(model, { ...options, ...model.options }),
        abortSignal: providerAbortSignal(provider),
        onError(event) {
          streamError = event.error
        },
      })
      let text = ""
      try {
        text = await result.text
      } catch (error) {
        throw streamError ?? error
      }
      if (!text.trim()) throw streamError ?? new Error("provider returned empty text")
      return { passed: `${providerID}/${candidate.id}`, attempts }
    } catch (error) {
      attempts.push(`${candidate.id}: ${formatProviderError(error)}`)
    }
  }
  return { attempts }
}

function formatProviderError(error: unknown) {
  const value = error as {
    message?: string
    statusCode?: number
    responseBody?: string
    data?: { error?: { message?: string; type?: string } }
  }
  return [
    value?.message ?? String(error),
    value?.statusCode ? `status=${value.statusCode}` : undefined,
    value?.data?.error?.type ? `type=${value.data.error.type}` : undefined,
    value?.data?.error?.message,
    value?.responseBody?.slice(0, 500),
  ]
    .filter(Boolean)
    .join(" | ")
}

describe("anonymous provider functionality", () => {
  test.skipIf(!anonymous)(
    "every provider visible without credentials returns generated text",
    async () => {
      const requested = new Set(
        (process.env["ATOMCLI_PROVIDER_ANONYMOUS_IDS"] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { streamText } = await import("ai")
          const credentials = await Auth.all()
          const currentCatalog = await ModelsDev.get()
          const plugins = await Plugin.list()
          const loginProviders = AuthLogin.providers(currentCatalog, plugins, {})
          const loginProviderIDs = new Set(loginProviders.map((provider) => provider.id))
          const pluginAuthIDs = new Set(plugins.filter((plugin) => plugin.auth).map((plugin) => plugin.auth!.provider))
          const missingFromLogin = Object.keys(currentCatalog).filter((providerID) => !loginProviderIDs.has(providerID))
          const withoutCredentialPath = loginProviders
            .filter((provider) => provider.env.length === 0 && !pluginAuthIDs.has(provider.id))
            .map((provider) => provider.id)
          const zeroCostProviders = Object.values(currentCatalog).filter((provider) =>
            Object.values(provider.models).some(
              (model) => (model.cost?.input ?? -1) === 0 && (model.cost?.output ?? -1) === 0,
            ),
          )
          const leakedEnv = Object.values(currentCatalog).flatMap((provider) =>
            provider.env.filter((name) => process.env[name]),
          )
          const providers = await Provider.list()
          const candidates = Object.entries(providers).filter(
            ([providerID]) => requested.size === 0 || requested.has(providerID),
          )
          const failures = [...requested]
            .filter((providerID) => !providers[providerID])
            .map((providerID) => `${providerID}: not available without credentials`)
          const passed: string[] = []

          expect(credentials).toEqual({})
          expect(leakedEnv).toEqual([])
          expect(Object.keys(currentCatalog).length).toBeGreaterThan(150)
          expect(missingFromLogin).toEqual([])
          expect(withoutCredentialPath).toEqual([])
          expect(zeroCostProviders.length).toBeGreaterThan(0)
          expect(candidates.length, "no provider is available without credentials").toBeGreaterThan(0)

          for (const [providerID, provider] of candidates) {
            const result = await generateWithProvider(providerID, provider, streamText)
            if (result.passed) passed.push(result.passed)
            else failures.push(`${providerID}: ${result.attempts.join(" | ") || "no text generation model found"}`)
          }

          expect(failures, `anonymous providers that generated text: ${passed.join(", ") || "none"}`).toEqual([])
          expect(passed.length).toBe(candidates.length)
          console.info(
            `anonymous provider audit: catalog=${Object.keys(currentCatalog).length}, zero-cost-with-login=${zeroCostProviders.length}, anonymous=${passed.length}/${candidates.length} passed (${passed.join(", ")})`,
          )
        },
      })
    },
    10 * 60_000,
  )
})

describe("AtomCLI model functionality", () => {
  test.skipIf(!atomcliAudit)(
    "every advertised anonymous AtomCLI model exists upstream and generates text",
    async () => {
      const requested = new Set(
        (process.env["ATOMCLI_PROVIDER_MODEL_IDS"] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { streamText } = await import("ai")
          expect(await Auth.all()).toEqual({})

          const provider = (await Provider.list())["atomcli"]
          expect(provider, "AtomCLI is not available without credentials").toBeDefined()
          if (!provider) return

          const aliases = new Set(["atomcli-auto", "atomcli-free"])
          const concrete = Object.values(provider.models)
            .filter((model) => !aliases.has(model.id))
            .filter((model) => model.status === "active" || model.status === "beta")
            .filter((model) => model.capabilities.input.text && model.capabilities.output.text)
            .filter((model) => requested.size === 0 || requested.has(model.id))
            .sort((left, right) => left.id.localeCompare(right.id))
          const missingRequested = [...requested].filter((modelID) => !provider.models[modelID])
          const failures = missingRequested.map((modelID) => `${modelID}: not advertised by AtomCLI`)
          const passed: string[] = []
          const limited: string[] = []

          expect(concrete.length, "AtomCLI advertises no concrete anonymous text model").toBeGreaterThan(0)
          const apiURL = concrete.find((model) => model.api.url)?.api.url
          expect(apiURL, "AtomCLI models do not declare an upstream API URL").toBeDefined()
          const response = await fetch(`${apiURL}/models`, { signal: AbortSignal.timeout(15_000) })
          expect(response.ok, `AtomCLI /models returned ${response.status}`).toBe(true)
          const upstream = (await response.json()) as { data?: Array<{ id?: string }> }
          const upstreamIDs = new Set((upstream.data ?? []).map((model) => model.id).filter(Boolean))

          for (const model of concrete) {
            if (!upstreamIDs.has(model.api.id)) {
              failures.push(`${model.id}: catalog model ${model.api.id} is absent from upstream /models`)
              continue
            }
            try {
              const selected = await Provider.getModel("atomcli", model.id)
              const language = await Provider.getLanguage(selected)
              const options = ProviderTransform.options(selected, "provider-compatibility-test", provider.options)
              let streamError: unknown
              const result = streamText({
                model: language,
                prompt: "Reply with exactly ATOMCLI_OK",
                maxOutputTokens: Math.min(model.limit.output, 2_048),
                maxRetries: 0,
                providerOptions: ProviderTransform.providerOptions(selected, { ...options, ...selected.options }),
                abortSignal: providerAbortSignal(provider),
                onError(event) {
                  streamError = event.error
                },
              })
              let text = ""
              try {
                text = await result.text
              } catch (error) {
                throw streamError ?? error
              }
              if (!text.trim()) throw streamError ?? new Error("provider returned empty text")
              passed.push(model.id)
            } catch (error) {
              const message = formatProviderError(error)
              if (ModelAvailability.active(model.availability) && /429|FreeUsageLimit|rate limit/i.test(message)) {
                limited.push(model.id)
              } else {
                failures.push(`${model.id}: ${message}`)
              }
            }
          }

          expect(
            failures,
            `AtomCLI models that generated text: ${passed.join(", ") || "none"}; rate limited: ${limited.join(", ") || "none"}`,
          ).toEqual([])
          expect(passed.length + limited.length).toBe(concrete.length)
          console.info(
            `AtomCLI model audit: ${passed.length}/${concrete.length} generated text (${passed.join(", ")}); ${limited.length} rate limited (${limited.join(", ")})`,
          )
        },
      })
    },
    10 * 60_000,
  )
})

describe("authenticated provider functionality", () => {
  test.skipIf(!live)(
    "providers configured by auth login or environment return generated text",
    async () => {
      const requested = new Set(
        (process.env["ATOMCLI_PROVIDER_LIVE_IDS"] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )

      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { streamText } = await import("ai")
          const providers = await Provider.list()
          const authenticated = new Set(Object.keys(await Auth.all()))
          const candidates = Object.entries(providers)
            .filter(([providerID]) => requested.size === 0 || requested.has(providerID))
            .filter(
              ([providerID, provider]) =>
                requested.size > 0 ||
                providerID === "atomcli" ||
                authenticated.has(providerID) ||
                provider.env.some((env) => Boolean(process.env[env])),
            )

          const failures = [...requested]
            .filter((providerID) => !providers[providerID])
            .map((providerID) => `${providerID}: credentials/configuration not detected`)
          const passed: string[] = []

          for (const [providerID, provider] of candidates) {
            if (!Provider.Info.safeParse(provider).success)
              failures.push(`${providerID}: authenticated runtime provider violates Provider.Info`)
            const result = await generateWithProvider(providerID, provider, streamText)
            if (result.passed) passed.push(result.passed)
            else failures.push(`${providerID}: ${result.attempts.join(" | ") || "no text generation model found"}`)
          }

          expect(failures, `authenticated providers that generated text: ${passed.join(", ") || "none"}`).toEqual([])
          expect(passed.length, "no configured provider completed a live request").toBeGreaterThan(0)
          console.info(
            `authenticated provider audit: ${passed.length}/${candidates.length} passed (${passed.join(", ")})`,
          )
        },
      })
    },
    10 * 60_000,
  )
})
