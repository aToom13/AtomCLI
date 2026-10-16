import "../preload"
import { test, expect, spyOn } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/services/project/instance"
import { Provider } from "@/integrations/provider/provider"
import { ModelVerification } from "@/integrations/provider/verification"
import { ProviderTransform } from "@/integrations/provider/transform"
import { Env } from "@/core/env"
import { Config } from "@/core/config/config"
import { ModelFallback } from "@/integrations/provider/fallback"
import { Installation } from "@/services/installation"

test("Auto and Free complete text and tool verification for one batch before probing more models", async () => {
  await using tmp = await tmpdir()
  const previousEvidence = await Bun.file(ModelVerification._internals.filepath)
    .text()
    .catch(() => '{"version":1,"entries":{}}')
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const provider = await Provider.getProvider("atomcli")
        for (const alias of ["atomcli-auto", "atomcli-free"]) {
          for (const model of Object.values(provider!.models)) {
            const key = await ModelVerification.identity(model, provider!)
            await ModelVerification.begin({ key, providerID: model.providerID, modelID: model.id })
          }
          const calls: string[] = []
          const probe = spyOn(ModelFallback, "probeModels").mockImplementation(async (specs, options) => {
            calls.push(options!.capability!)
            expect(specs.length).toBeLessThanOrEqual(2)
            for (const spec of specs) {
              const parsed = Provider.parseModel(spec)
              const model = await Provider.getModel(parsed.providerID, parsed.modelID)
              const key = await ModelVerification.identity(model, provider!)
              const attempt = await ModelVerification.begin({ key, providerID: model.providerID, modelID: model.id })
              await ModelVerification.verified(attempt, [options!.capability!])
            }
            return []
          })
          try {
            const selected = await Provider.getModel("atomcli", alias, {
              prompt: "Read the files and edit the code to fix a bug",
            })
            expect(selected.id).not.toBe(alias)
            expect(calls).toEqual(["text", "tool"])
          } finally {
            probe.mockRestore()
          }
        }
      },
    })
  } finally {
    await Bun.write(ModelVerification._internals.filepath, previousEvidence)
  }
})

test("provider requests have a finite default timeout", () => {
  expect(Provider.requestTimeout({})).toBe(300_000)
  expect(Provider.requestTimeout({ timeout: 12_000 })).toBe(12_000)
  expect(Provider.requestTimeout({ timeout: false })).toBe(false)
})

test("AtomCLI Zen requests use the current OpenCode client identity", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const headers = Provider._internals.openCodeHeaders({
        "x-opencode-session": "session",
        "x-opencode-request": "request",
        "User-Agent": "ai-sdk/default",
      })

      expect(headers.get("x-opencode-project")).toBeTruthy()
      expect(headers.get("x-opencode-session")).toBe("session")
      expect(headers.get("x-opencode-request")).toBe("request")
      expect(headers.get("x-opencode-client")).toBe("cli")
      expect(headers.get("User-Agent")).toBe(`opencode/${Installation.OPENCODE_VERSION}`)
      expect(Installation.OPENCODE_VERSION).toBe("1.18.31")
      expect(headers.has("x-atomcli-session")).toBe(false)
      const probeHeaders = Provider._internals.openCodeHeaders()
      expect(probeHeaders.get("x-opencode-session")).toMatch(/^ses_[a-zA-Z0-9]{26}$/)
      expect(probeHeaders.get("x-opencode-request")).toMatch(/^msg_[a-zA-Z0-9]{26}$/)
    },
  })
})

test("AtomCLI public catalog excludes deprecated and paid models", () => {
  const model = {
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    status: "active",
  } as unknown as Provider.Model

  expect(Provider._internals.isPublicAtomCLIModel(model)).toBe(true)
  expect(Provider._internals.isPublicAtomCLIModel({ ...model, status: "deprecated" })).toBe(false)
  expect(Provider._internals.isPublicAtomCLIModel({ ...model, cost: { input: 0, output: 0 } } as any)).toBe(false)
  expect(
    Provider._internals.isPublicAtomCLIModel({
      ...model,
      cost: { input: 0, output: 0, cache: { read: 0.01, write: 0 } },
    }),
  ).toBe(false)
  expect(
    Provider._internals.isPublicAtomCLIModel({
      ...model,
      cost: { input: 0.1, output: 0, cache: { read: 0, write: 0 } },
    }),
  ).toBe(false)
})

test("AtomCLI Auto limits routing candidates to attachment-capable models", () => {
  const required = Provider._internals.requiredInputModalities([
    { type: "text" },
    { type: "file", mime: "image/png" },
    { type: "file", mime: "application/pdf" },
  ])
  const model = (image: boolean, pdf: boolean) =>
    ({ capabilities: { input: { image, pdf, audio: false, video: false } } }) as Provider.Model

  expect(Array.from(required).sort()).toEqual(["image", "pdf"])
  expect(Provider._internals.supportsInputModalities(model(true, true), required)).toBe(true)
  expect(Provider._internals.supportsInputModalities(model(true, false), required)).toBe(false)
})

test("models.dev reasoning declarations replace guessed thinking variants", () => {
  const provider = Provider.fromModelsDevProvider({
    id: "atomcli",
    name: "AtomCLI Zen",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    api: "https://atomcli.ai/zen/v1",
    models: {
      fixed: {
        id: "fixed",
        name: "Fixed Reasoning",
        reasoning: true,
        reasoning_options: [],
        tool_call: true,
        attachment: false,
        release_date: "2026-01-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 128_000, output: 32_000 },
      },
      adjustable: {
        id: "adjustable",
        name: "Adjustable Reasoning",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        tool_call: true,
        attachment: false,
        release_date: "2026-01-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 128_000, output: 32_000 },
      },
    },
  } as any)

  expect(provider.models.fixed.variants).toEqual({})
  expect(provider.models.adjustable.variants).toEqual({
    low: { reasoningEffort: "low" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "max" },
  })
})

test("config overrides invalidate catalog variants when reasoning or transport changes", () => {
  const existing = {
    id: "model",
    api: { id: "model", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning: true },
    variants: { high: { reasoningEffort: "high" } },
  } as unknown as Provider.Model

  expect(
    Provider._internals.configuredVariants(existing, {
      ...existing,
      capabilities: { ...existing.capabilities, reasoning: false },
    }),
  ).toEqual({})

  expect(
    Provider._internals.configuredVariants(existing, {
      ...existing,
      api: { ...existing.api, npm: "@ai-sdk/amazon-bedrock" },
    }),
  ).toEqual({})

  expect(
    Provider._internals.configuredVariants(existing, {
      ...existing,
      api: { ...existing.api, url: "https://other.example/v1" },
    }),
  ).toEqual({})
})

test("shared provider fetch resolves thinking behavior from the request model", () => {
  const plain = {
    id: "plain",
    providerID: "atomcli",
    api: { id: "plain-api", npm: "@ai-sdk/openai-compatible", url: "https://atomcli.ai/zen/v1" },
    variants: {},
  } as unknown as Provider.Model
  const toggle = {
    ...plain,
    id: "toggle",
    api: { ...plain.api, id: "toggle-api" },
    variants: {},
  } as Provider.Model
  toggle.variants = ProviderTransform.reasoningVariants({ reasoning_options: [{ type: "toggle" }] } as any, toggle)
  const provider = { models: { plain, toggle } } as unknown as Provider.Info

  const toggleBody = { model: "toggle-api", reasoning_effort: toggle.variants!.none.reasoningEffort }
  const toggleTarget = Provider._internals.requestModel(provider, plain, toggleBody)
  expect(ProviderTransform.atomcliThinkingBody(toggleTarget, toggleBody)).toEqual({
    model: "toggle-api",
    thinking: { type: "disabled" },
  })

  const plainBody = { model: "plain-api", reasoning_effort: "high" }
  const plainTarget = Provider._internals.requestModel(provider, toggle, plainBody)
  expect(ProviderTransform.atomcliThinkingBody(plainTarget, plainBody)).toEqual(plainBody)
  expect(Provider._internals.requestModel(provider, plain, { model: "missing" })).toBe(plain)
})

test("atomcli-auto persists the selected provider catalog key", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = await Provider.getProvider("atomcli")
      expect(provider).toBeDefined()
      const candidate = Object.entries(provider!.models).find(
        ([id, model]) => id !== "atomcli-auto" && id !== "atomcli-free" && Provider.isExplicitlyFree(model),
      )
      expect(candidate).toBeDefined()
      const [candidateID, candidateModel] = candidate!
      const key = await ModelVerification.identity(candidateModel, provider!)
      const attempt = await ModelVerification.begin({ key, providerID: "atomcli", modelID: candidateID })
      await ModelVerification.verified(attempt, ["text"])

      const model = await Provider.getModel("atomcli", "atomcli-auto", {
        session: { id: "ses_alias_resolution" },
        prompt: "",
      })
      const primary = (model.options as any)?._fallbackChain?.primary

      expect(primary).toBeDefined()
      expect({ providerID: model.providerID, modelID: model.id }).toEqual(primary)
      expect(model.id).not.toContain("atomcli-auto /")
    },
  })
})

test("atomcli-free execution selects only a model with fresh verification evidence", async () => {
  await using tmp = await tmpdir({
    config: {
      experimental: {
        auto_router: {
          allowed_providers: ["atomcli"],
          allow_paid_models: false,
          allow_paid_probes: false,
          exploration_rate: 0,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = await Provider.getProvider("atomcli")
      expect(provider).toBeDefined()
      const candidate = Object.entries(provider!.models).find(
        ([id, model]) => id !== "atomcli-auto" && id !== "atomcli-free" && Provider.isExplicitlyFree(model),
      )
      expect(candidate).toBeDefined()
      const [candidateID, candidateModel] = candidate!
      const key = await ModelVerification.identity(candidateModel, provider!)
      const attempt = await ModelVerification.begin({ key, providerID: "atomcli", modelID: candidateID })
      await ModelVerification.verified(attempt, ["text"])

      const selected = await Provider.getModel("atomcli", "atomcli-free", {
        session: { id: "ses_verified_alias" },
        prompt: "",
        verify: true,
      })

      expect(selected.id).toBe(candidateID)
      expect((selected.options as any)._routePolicy).toEqual({
        requested: "atomcli/atomcli-free",
        mode: "free",
        allowedProviders: ["atomcli"],
        excluded: [],
        requiredCapabilities: ["text"],
        freeOnly: true,
        requireVerification: true,
      })
    },
  })
})

test("atomcli-auto considers a verified paid model only with explicit paid routing permission", async () => {
  await using tmp = await tmpdir({
    config: {
      experimental: {
        auto_router: {
          allowed_providers: ["paid-test"],
          allow_paid_models: true,
          allow_paid_probes: false,
        },
      },
      provider: {
        "paid-test": {
          name: "Paid Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "paid-model": {
              name: "Paid Model",
              tool_call: true,
              reasoning: true,
              cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
              limit: { context: 128_000, output: 16_000 },
            },
          },
          options: { apiKey: "fake-paid-test-key", baseURL: "https://paid.invalid/v1" },
        },
      },
    } as any,
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = await Provider.getProvider("paid-test")
      const candidate = provider?.models["paid-model"]
      expect(candidate).toBeDefined()
      expect(Provider.isExplicitlyFree(candidate!)).toBe(false)

      const key = await ModelVerification.identity(candidate!, provider!)
      const attempt = await ModelVerification.begin({ key, providerID: "paid-test", modelID: "paid-model" })
      await ModelVerification.verified(attempt, ["text"])

      const selected = await Provider.getModel("atomcli", "atomcli-auto", {
        session: { id: "ses_verified_paid_alias" },
        prompt: "Explain this architecture.",
      })

      expect({ providerID: selected.providerID, modelID: selected.id }).toEqual({
        providerID: "paid-test",
        modelID: "paid-model",
      })
      expect((selected.options as any)._routePolicy).toMatchObject({
        mode: "auto",
        allowedProviders: ["paid-test"],
        freeOnly: false,
        requireVerification: true,
      })
    },
  })
})

test("atomcli-free never inherits AtomCLI Auto's paid model permission", async () => {
  await using tmp = await tmpdir({
    config: {
      experimental: {
        auto_router: {
          allowed_providers: ["paid-test"],
          allow_paid_models: true,
          allow_paid_probes: true,
        },
      },
      provider: {
        "paid-test": {
          name: "Paid Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "paid-model": {
              name: "Paid Model",
              tool_call: true,
              cost: { input: 1, output: 2 },
              limit: { context: 128_000, output: 16_000 },
            },
          },
          options: { apiKey: "fake-paid-test-key", baseURL: "https://paid.invalid/v1" },
        },
      },
    } as any,
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        Provider.getModel("atomcli", "atomcli-free", {
          session: { id: "ses_paid_free_alias" },
          prompt: "Say hello.",
        }),
      ).rejects.toThrow("atomcli-free: no eligible model is configured")
    },
  })
})

test("provider loaded from env variable", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      // Note: source becomes "custom" because CUSTOM_LOADERS run after env loading
      // and anthropic has a custom loader that merges additional options
      expect(providers["anthropic"].source).toBe("custom")
    },
  })
})

test("provider loaded from config with apiKey option", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            anthropic: {
              options: {
                apiKey: "config-api-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
    },
  })
})

test("disabled_providers excludes provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          disabled_providers: ["anthropic"],
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeUndefined()
    },
  })
})

test("enabled_providers restricts to only listed providers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          enabled_providers: ["anthropic"],
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
      Env.set("OPENAI_API_KEY", "test-openai-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      expect(providers["openai"]).toBeUndefined()
    },
  })
})

test("model whitelist filters models for provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            anthropic: {
              whitelist: ["claude-sonnet-4-20250514"],
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      const models = Object.keys(providers["anthropic"].models)
      expect(models).toContain("claude-sonnet-4-20250514")
      expect(models.length).toBe(1)
    },
  })
})

test("model blacklist excludes specific models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            anthropic: {
              blacklist: ["claude-sonnet-4-20250514"],
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      const models = Object.keys(providers["anthropic"].models)
      expect(models).not.toContain("claude-sonnet-4-20250514")
    },
  })
})

test("custom model alias via config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            anthropic: {
              models: {
                "my-alias": {
                  id: "claude-sonnet-4-20250514",
                  name: "My Custom Alias",
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      expect(providers["anthropic"].models["my-alias"]).toBeDefined()
      expect(providers["anthropic"].models["my-alias"].name).toBe("My Custom Alias")
    },
  })
})

test("custom provider with npm package", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            "custom-provider": {
              name: "Custom Provider",
              npm: "@ai-sdk/openai-compatible",
              api: "https://api.custom.com/v1",
              env: ["CUSTOM_API_KEY"],
              models: {
                "custom-model": {
                  name: "Custom Model",
                  tool_call: true,
                  limit: {
                    context: 128000,
                    output: 4096,
                  },
                },
              },
              options: {
                apiKey: "custom-key",
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["custom-provider"]).toBeDefined()
      expect(providers["custom-provider"].name).toBe("Custom Provider")
      expect(providers["custom-provider"].models["custom-model"]).toBeDefined()
    },
  })
})

test("env variable takes precedence, config merges options", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            anthropic: {
              options: {
                timeout: 60000,
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "env-api-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["anthropic"]).toBeDefined()
      // Config options should be merged
      expect(providers["anthropic"].options.timeout).toBe(60000)
    },
  })
})

test("getModel returns model for valid provider/model", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const model = await Provider.getModel("anthropic", "claude-sonnet-4-20250514")
      expect(model).toBeDefined()
      expect(model.providerID).toBe("anthropic")
      expect(model.id).toBe("claude-sonnet-4-20250514")
      const language = await Provider.getLanguage(model)
      expect(language).toBeDefined()
    },
  })
})

test("getModel throws ModelNotFoundError for invalid model", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      expect(Provider.getModel("anthropic", "nonexistent-model")).rejects.toThrow()
    },
  })
})

test("getModel throws ModelNotFoundError for invalid provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Provider.getModel("nonexistent-provider", "some-model")).rejects.toThrow()
    },
  })
})

test("parseModel correctly parses provider/model string", () => {
  const result = Provider.parseModel("anthropic/claude-sonnet-4")
  expect(result.providerID).toBe("anthropic")
  expect(result.modelID).toBe("claude-sonnet-4")
})

test("parseModel handles model IDs with slashes", () => {
  const result = Provider.parseModel("openrouter/anthropic/claude-3-opus")
  expect(result.providerID).toBe("openrouter")
  expect(result.modelID).toBe("anthropic/claude-3-opus")
})

test("defaultModel returns first available model when no config set", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const model = await Provider.defaultModel()
      expect(model.providerID).toBeDefined()
      expect(model.modelID).toBeDefined()
    },
  })
})

test("defaultModel respects config model setting", async () => {
  await Config.clearCache()
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          model: "anthropic/claude-sonnet-4-20250514",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ANTHROPIC_API_KEY", "test-api-key")
    },
    fn: async () => {
      const model = await Provider.defaultModel()
      expect(model.providerID).toBe("anthropic")
      expect(model.modelID).toBe("claude-sonnet-4-20250514")
    },
  })
})

test("defaultModel recovers when the configured catalog model was removed", async () => {
  await Config.clearCache()
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          model: "atomcli/removed-free-model",
          provider: {
            atomcli: {
              models: {
                "removed-free-model": {
                  name: "Removed Free Model",
                  limit: { context: 128000, output: 8192 },
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = await Provider.getProvider("atomcli")
      expect(provider?.models["removed-free-model"]).toBeUndefined()
      const model = await Provider.defaultModel()
      expect(model).not.toEqual({ providerID: "atomcli", modelID: "removed-free-model" })
      expect(await Provider.getModel(model.providerID, model.modelID)).toBeDefined()
    },
  })
})
