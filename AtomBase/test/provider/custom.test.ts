import { test, expect } from "bun:test"
import { parseDiscoveredModel, fetchOpenAICompatibleModels } from "@/integrations/provider/custom"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/services/project/instance"
import { Provider } from "@/integrations/provider/provider"
import path from "path"

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
