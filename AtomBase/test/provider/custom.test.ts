import "../preload"
import { test, expect, spyOn } from "bun:test"
import { parseDiscoveredModel, fetchOpenAICompatibleModels } from "@/integrations/provider/custom"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/services/project/instance"
import { Provider } from "@/integrations/provider/provider"
import path from "path"
import fs from "fs/promises"
import { ModelsDev } from "@/integrations/provider/models"
import { Global } from "@/core/global"

test("parseDiscoveredModel detects reasoning and interleaved format for deepseek r1", () => {
  const model = parseDiscoveredModel({
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    context_length: 128000,
    max_tokens: 8192,
  })

  expect(model.id).toBe("deepseek/deepseek-r1")
  expect(model.name).toBe("DeepSeek R1")
  expect(model.reasoning).toBe(true)
  expect(model.interleaved).toEqual({ field: "reasoning_content" })
  expect(model.tool_call).toBe(true)
  expect(model.limit.context).toBe(128000)
  expect(model.limit.output).toBe(8192)
})

test("parseDiscoveredModel detects vision/multimodal capabilities for vision models", () => {
  const model = parseDiscoveredModel({
    id: "anthropic/claude-3-7-sonnet",
    context_length: 200000,
    max_tokens: 64000,
    pricing: {
      prompt: 0.000003,
      completion: 0.000015,
    },
  })

  expect(model.id).toBe("anthropic/claude-3-7-sonnet")
  expect(model.attachment).toBe(true)
  expect(model.modalities?.input).toContain("image")
  expect(model.limit.context).toBe(200000)
  expect(model.limit.output).toBe(64000)
  expect(model.cost?.input).toBe(3)
  expect(model.cost?.output).toBe(15)
})

test("parseDiscoveredModel disables tool calling for non-chat models like embeddings", () => {
  const model = parseDiscoveredModel({
    id: "text-embedding-3-small",
  })

  expect(model.tool_call).toBe(false)
})

test("fetchOpenAICompatibleModels queries /v1/models endpoint with auth and parses models", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    const headers = new Headers(init?.headers)

    if (url === "http://mock-custom-llm:20128/v1/models") {
      if (headers.get("Authorization") !== "Bearer test-secret-key") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
      }

      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "anthropic/claude-3.7-sonnet",
              object: "model",
              context_length: 200000,
              max_tokens: 8192,
            },
            {
              id: "deepseek/deepseek-r1",
              object: "model",
              context_length: 128000,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    return new Response("Not Found", { status: 404 })
  }) as typeof globalThis.fetch

  try {
    const result = await fetchOpenAICompatibleModels({
      baseURL: "http://mock-custom-llm:20128/v1",
      apiKey: "test-secret-key",
    })

    expect(result.ok).toBe(true)
    expect(result.models.length).toBe(2)
    expect(result.models[0].id).toBe("anthropic/claude-3.7-sonnet")
    expect(result.models[1].id).toBe("deepseek/deepseek-r1")
    expect(result.models[1].reasoning).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("custom provider loaded from atomcli.json works with Provider.list() and Provider.getModel()", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          provider: {
            "9route": {
              name: "9Route",
              npm: "@ai-sdk/openai-compatible",
              api: "http://localhost:20128/v1",
              options: {
                baseURL: "http://localhost:20128/v1",
                apiKey: "sk-test-key",
                modelDiscovery: false,
              },
              models: {
                "claude-3.7-sonnet": {
                  name: "Claude 3.7 Sonnet",
                  tool_call: true,
                  reasoning: true,
                  limit: {
                    context: 200000,
                    output: 8192,
                  },
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
      const providers = await Provider.list()
      expect(providers["9route"]).toBeDefined()
      expect(providers["9route"].name).toBe("9Route")
      expect(providers["9route"].models["claude-3.7-sonnet"]).toBeDefined()

      const model = await Provider.getModel("9route", "claude-3.7-sonnet")
      expect(model).toBeDefined()
      expect(model.providerID).toBe("9route")
      expect(model.id).toBe("claude-3.7-sonnet")
      expect(model.capabilities.toolcall).toBe(true)

      const lang = await Provider.getLanguage(model)
      expect(lang).toBeDefined()
    },
  })
})

test("custom provider discovery adds new models and treats missing prices as subscription access", async () => {
  const originalFetch = globalThis.fetch
  let now = Date.now()
  const clock = spyOn(Date, "now").mockImplementation(() => now)
  let catalog: Array<{ id: string; context_length?: number }> = [{ id: "existing-model" }]
  globalThis.fetch = (async (input) => {
    expect(input.toString()).toBe("https://router.example/v1/models")
    return Response.json({ data: catalog })
  }) as typeof fetch

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "atomcli.json"),
          JSON.stringify({
            provider: {
              "plan-router": {
                name: "Plan Router",
                npm: "@ai-sdk/openai-compatible",
                api: "https://router.example/v1",
                options: {
                  baseURL: "https://router.example/v1",
                  apiKey: "fake-test-key",
                  modelDiscovery: true,
                },
                models: {
                  "existing-model": { name: "Existing Model" },
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
        const provider = (await Provider.list())["plan-router"]
        expect(Object.keys(provider.models)).toEqual(["existing-model"])
        expect(provider.models["existing-model"].name).toBe("Existing Model")

        catalog = [{ id: "newly-linked-model", context_length: 64_000 }]
        now += 15_001
        const refreshed = (await Provider.list())["plan-router"]
        expect(Object.keys(refreshed.models)).toEqual(["newly-linked-model"])
        expect(refreshed.models["newly-linked-model"].options._billing).toBe("subscription")
        expect(refreshed.models["newly-linked-model"].options._catalogCostKnown).toBe(false)
        expect(Provider.isExplicitlyFree(refreshed.models["newly-linked-model"])).toBe(false)
      },
    })
  } finally {
    clock.mockRestore()
    globalThis.fetch = originalFetch
  }
})

test.each(["missing", "invalid"])(
  "%s models.dev cache does not rediscover providers on every dispatch",
  async (kind) => {
    const fixture = process.env.MODELS_DEV_API_JSON
    const cache = path.join(Global.Path.cache, "models.json")
    const previous = await fs.readFile(cache).catch(() => undefined)
    const refresh = spyOn(ModelsDev, "refresh").mockResolvedValue(false)
    const discovery = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://fallback.example/v1/models")
      return Response.json({ data: [{ id: "existing-model" }] })
    }) as typeof fetch)
    try {
      delete process.env.MODELS_DEV_API_JSON
      if (kind === "invalid") await Bun.write(cache, "not JSON")
      else await fs.rm(cache, { force: true })
      await using tmp = await tmpdir({
        config: {
          disabled_providers: ["ollama"],
          provider: {
            "fallback-router": {
              npm: "@ai-sdk/openai-compatible",
              api: "https://fallback.example/v1",
              models: { "existing-model": { name: "Existing" } },
            },
          },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Provider.list()
          for (let i = 0; i < 3; i++) {
            expect((await Provider.getModel("fallback-router", "existing-model")).id).toBe("existing-model")
          }
          expect(discovery).toHaveBeenCalledTimes(1)
        },
      })
    } finally {
      if (fixture === undefined) delete process.env.MODELS_DEV_API_JSON
      else process.env.MODELS_DEV_API_JSON = fixture
      if (previous) await Bun.write(cache, previous)
      else await fs.rm(cache, { force: true })
      discovery.mockRestore()
      refresh.mockRestore()
    }
  },
)

test("background catalog refresh cannot stall model dispatch or duplicate in-flight discovery", async () => {
  let now = Date.now()
  const clock = spyOn(Date, "now").mockImplementation(() => now)
  const held = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  let calls = 0
  const response = () => Response.json({ data: [{ id: "existing-model" }] })
  const transport = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://latency.example/v1/models")
    calls++
    if (calls === 1) {
      now += 12_000 // Discovery consumes most of the old 15-second TTL.
      return response()
    }
    started.resolve()
    return held.promise
  }) as typeof fetch)
  try {
    await using tmp = await tmpdir({
      config: {
        disabled_providers: ["ollama"],
        provider: {
          "latency-router": {
            npm: "@ai-sdk/openai-compatible",
            api: "https://latency.example/v1",
            models: { "existing-model": { name: "Existing" } },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.list()
        now += 14_999
        await Provider.getModel("latency-router", "existing-model")
        expect(calls).toBe(1) // TTL starts after discovery completed.
        now += 2
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const dispatch = await Promise.race([
            Provider.getModel("latency-router", "existing-model"),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("catalog refresh blocked model dispatch")), 500)
            }),
          ])
          expect(dispatch.id).toBe("existing-model")
        } finally {
          clearTimeout(timer)
        }
        await started.promise
        await Promise.all(Array.from({ length: 10 }, () => Provider.getProvider("latency-router")))
        expect((await Provider.list(false))["latency-router"].models["existing-model"]).toBeDefined()
        expect(calls).toBe(2)
        let listed = false
        const listing = Provider.list().then((value) => {
          listed = true
          return value
        })
        const newModel = Provider.getModel("latency-router", "new-model")
        await Bun.sleep(10)
        expect(listed).toBe(false) // An explicit catalog listing waits for fresh results.
        held.resolve(Response.json({ data: [{ id: "new-model" }] }))
        expect(Object.keys((await listing)["latency-router"].models)).toEqual(["new-model"])
        expect((await newModel).id).toBe("new-model")

        now += 15_001
        const broken = spyOn(ModelsDev, "getWithRevision").mockRejectedValue(new Error("catalog unavailable"))
        try {
          await expect(Provider.list()).rejects.toThrow("catalog unavailable")
          expect((await Provider.getModel("latency-router", "new-model")).id).toBe("new-model")
          expect(broken).toHaveBeenCalledTimes(1)
        } finally {
          broken.mockRestore()
        }
      },
    })
  } finally {
    held.resolve(response())
    transport.mockRestore()
    clock.mockRestore()
  }
})
