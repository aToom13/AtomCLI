import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ModelsDev } from "@/integrations/provider/models"
import { Provider } from "@/integrations/provider/provider"
import { ProviderTransform } from "@/integrations/provider/transform"
import { Auth } from "@/services/auth"
import { Env } from "@/core/env"
import { Installation } from "@/services/installation"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ModelVerification } from "@/integrations/provider/verification"
import { SessionRetry } from "@/core/session/retry"
import { MessageV2 } from "@/core/session/message-v2"
import { Config } from "@/core/config/config"

const model = {
  id: "free-model",
  name: "Free model",
  release_date: "2026-01-01",
  attachment: false,
  reasoning: false,
  tool_call: true,
  cost: { input: 0, output: 0 },
  limit: { context: 32000, output: 1000 },
  modalities: { input: ["text"], output: ["text"] },
}
const catalog = ModelsDev.Provider.parse({
  id: "opencode",
  name: "OpenCode Zen",
  env: ["FAKE_ZEN_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: "https://zen.invalid/openai/v1",
  models: {
    "free-model": model,
    "paid-model": { ...model, id: "paid-model", cost: { input: 1, output: 1 } },
    "anthropic-model": {
      ...model,
      id: "anthropic-model",
      provider: { npm: "@ai-sdk/anthropic", api: "https://zen.invalid/anthropic/v1" },
    },
  },
})

const freeTierBody = JSON.stringify({
  error: { message: "OpenCode's free tier can only be used from within OpenCode." },
})
const completion = () =>
  Response.json({
    id: "fake-completion",
    object: "chat.completion",
    created: 1,
    model: "free-model",
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })

for (const scenario of ["recover", "exhaust", "authentication", "abort"] as const) {
  test(`Zen free-tier retries: ${scenario}`, async () => {
    const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
      database: { opencode: structuredClone(catalog) },
      revision: ModelsDev.revision(),
    })
    const requests: any[] = []
    const controller = new AbortController()
    const transport = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      expect(String(input)).toStartWith("https://zen.invalid/")
      requests.push(init)
      if (scenario === "recover" && requests.length === 3) return completion()
      if (scenario === "abort") setTimeout(() => controller.abort(), 25)
      return new Response(scenario === "authentication" ? '{"error":"Invalid API key"}' : freeTierBody, { status: 403 })
    }) as typeof fetch)
    try {
      await using tmp = await tmpdir({
        config: { disabled_providers: ["ollama"], provider: { atomcli: { options: { modelDiscovery: false } } } },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = await Provider.getModel("atomcli", "free-model")
          const language = await Provider.getLanguage(model)
          const call = language.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
            abortSignal: controller.signal,
          })
          if (scenario === "recover") expect((await call).content).toContainEqual({ type: "text", text: "OK" })
          else await expect(call).rejects.toThrow()
          expect(requests).toHaveLength(scenario === "recover" ? 3 : scenario === "exhaust" ? 5 : 1)
          expect(new Set(requests.map((r) => r.body)).size).toBe(1)
          if (scenario === "exhaust") {
            const provider = (await Provider.getProvider("atomcli"))!
            expect((await ModelVerification.get(await ModelVerification.identity(model, provider)))?.reason).toBe(
              "request_context",
            )
          }
        },
      })
    } finally {
      transport.mockRestore()
      snapshot.mockRestore()
    }
  })
}

test("only the specific free-tier 403 permits session retry/fallback", () => {
  const error = (responseBody: string) =>
    new MessageV2.APIError({ message: "Forbidden", statusCode: 403, isRetryable: false, responseBody }).toObject()
  expect(SessionRetry.retryable(error(freeTierBody))).toBe("Free model temporarily unavailable")
  expect(SessionRetry.retryable(error('{"error":"Invalid API key"}'))).toBeUndefined()
  expect(ModelVerification.classify(Object.assign(new Error("403 Forbidden"), { responseBody: freeTierBody }))).toBe(
    "request_context",
  )
})

test("Zen model-unavailable cooldown survives a fresh provider instance and expires", async () => {
  const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
    database: { opencode: structuredClone(catalog) },
    revision: ModelsDev.revision(),
  })
  const transport = spyOn(globalThis, "fetch").mockImplementation((async (_input, _init) =>
    Response.json(
      { error: { message: "Upstream request failed: Endpoint is unavailable." } },
      { status: 429 },
    )) as typeof fetch)
  const config = { disabled_providers: ["ollama"], provider: { atomcli: { options: { modelDiscovery: false } } } }
  let key: string
  try {
    await using first = await tmpdir({ config })
    await Instance.provide({
      directory: first.path,
      fn: async () => {
        const model = await Provider.getModel("atomcli", "free-model")
        const language = await Provider.getLanguage(model)
        await expect(
          language.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }] }),
        ).rejects.toThrow()
        key = await ModelVerification.identity(model, (await Provider.getProvider("atomcli"))!)
        expect((await ModelVerification.get(key))?.reason).toBe("model_unavailable")
      },
    })
    await using second = await tmpdir({ config })
    await Instance.provide({
      directory: second.path,
      fn: async () => {
        expect((await Provider.list()).atomcli.models["free-model"].availability?.status).toBe("unavailable")
        const provider = (await Provider.list()).atomcli
        await ModelVerification.observe(provider.models["free-model"], provider, ["text"], undefined, {
          effectiveParams: { temperature: 0.2 },
        })
        expect((await Provider.list()).atomcli.models["free-model"].availability).toBeUndefined()
        expect(await ModelVerification.get(key)).toBeUndefined()
        const attempt = await ModelVerification.begin({ key, providerID: "atomcli", modelID: "free-model" })
        await ModelVerification.failed(attempt, "model_unavailable", { now: 1, retryAt: 2 })
      },
    })
    await using third = await tmpdir({ config })
    await Instance.provide({
      directory: third.path,
      fn: async () => {
        expect((await Provider.list()).atomcli.models["free-model"].availability).toBeUndefined()
      },
    })
  } finally {
    transport.mockRestore()
    snapshot.mockRestore()
  }
})

test("Auto and Free use independent qualified allowlists; Free cannot escape atomcli", async () => {
  const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
    database: { opencode: structuredClone(catalog) },
    revision: ModelsDev.revision(),
  })
  try {
    await using tmp = await tmpdir({
      config: {
        disabled_providers: ["ollama"],
        experimental: {
          auto_router: {
            mode: "speed",
            allowed_providers: ["outside"],
            allowed_models: ["outside/free-model"],
            excluded_models: ["atomcli/free-model"],
          },
          free_router: { mode: "quality", allowed_models: ["atomcli/free-model"] },
        },
        provider: {
          atomcli: { options: { modelDiscovery: false } },
          outside: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://outside.invalid/v1", apiKey: "fake-outside-key", modelDiscovery: false },
            models: { "free-model": { ...model } },
          },
        },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const id of ["outside", "atomcli"]) {
          const provider = (await Provider.getProvider(id))!
          const concrete = await Provider.getModel(id, "free-model")
          const key = await ModelVerification.identity(concrete, provider)
          await ModelVerification.verified(
            await ModelVerification.begin({ key, providerID: id, modelID: concrete.id }),
            ["text", "tool"],
          )
        }
        const auto = await Provider.getModel("atomcli", "atomcli-auto", { prompt: "" })
        const free = await Provider.getModel("atomcli", "atomcli-free", { prompt: "" })
        expect(auto.providerID).toBe("outside")
        expect(free.providerID).toBe("atomcli")
        expect(free.id).toBe("free-model")
        expect(Provider.routePolicy(free).allowedModels).toEqual(["atomcli/free-model"])
        expect(
          await Provider.isRouteEligible(
            auto,
            {
              ...Provider.routePolicy(free),
              allowedProviders: ["outside"],
              allowedModels: undefined,
              requireVerification: false,
            },
            "text",
          ),
        ).toBe(false)
        expect(
          await Provider.isRouteEligible(
            await Provider.getModel("atomcli", "anthropic-model"),
            { ...Provider.routePolicy(free), requireVerification: false },
            "text",
          ),
        ).toBe(false)
        await Config.update({ experimental: { free_router: { allowed_models: [], exploration_rate: 0 } } })
        await expect(Provider.getModel("atomcli", "atomcli-free", { prompt: "" })).rejects.toThrow(
          "no eligible model is configured",
        )
        expect((await Config.get()).experimental?.auto_router?.allowed_providers).toEqual(["outside"])
      },
    })
  } finally {
    snapshot.mockRestore()
  }
})

for (const source of ["anonymous", "env", "stored", "config"] as const) {
  test(`Zen ${source} credentials reach transport for both provider IDs`, async () => {
    const expected = source === "anonymous" ? "public" : `fake-zen-${source}-key`
    const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
      database: { opencode: structuredClone(catalog) },
      revision: ModelsDev.revision(),
    })
    const auth = spyOn(Auth, "get").mockImplementation(async (id) =>
      source === "stored" && ["atomcli", "opencode"].includes(id) ? { type: "api", key: expected } : undefined,
    )
    const allAuth = spyOn(Auth, "all").mockResolvedValue(
      source === "stored" ? { atomcli: { type: "api", key: expected }, opencode: { type: "api", key: expected } } : {},
    )
    const requests: Headers[] = []
    const transport = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
      if (String(_input).startsWith("https://zen.invalid/")) requests.push(new Headers(init?.headers))
      return Response.json({
        id: "fake-completion",
        object: "chat.completion",
        created: 1,
        model: "free-model",
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }) as typeof fetch)
    try {
      await using tmp = await tmpdir({
        config: {
          disabled_providers: ["ollama"],
          provider: Object.fromEntries(
            ["atomcli", "opencode"].map((id) => [
              id,
              { options: { modelDiscovery: false, ...(source === "config" ? { apiKey: expected } : {}) } },
            ]),
          ),
        },
      })
      await Instance.provide({
        directory: tmp.path,
        init: async () => {
          Env.set("FAKE_ZEN_API_KEY", source === "env" ? expected : "")
        },
        fn: async () => {
          for (const id of ["atomcli", "opencode"]) {
            const provider = await Provider.getProvider(id)
            expect(provider).toBeDefined()
            expect(Boolean(provider!.models["paid-model"])).toBe(id === "opencode" && source !== "anonymous")
            const language = await Provider.getLanguage(await Provider.getModel(id, "free-model"))
            const result = await language.doGenerate({
              prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
            })
            expect(result.content).toContainEqual({ type: "text", text: "OK" })
          }
        },
      })
      expect(requests).toHaveLength(2)
      for (const headers of requests) {
        expect(headers.get("authorization")).toBe(`Bearer ${expected}`)
        expect(headers.get("user-agent")).toBe(`opencode/${Installation.OPENCODE_VERSION}`)
      }
    } finally {
      transport.mockRestore()
      allAuth.mockRestore()
      auth.mockRestore()
      snapshot.mockRestore()
    }
  })
}

test("Zen models retain their protocol-specific endpoint through config overrides", async () => {
  const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
    database: { opencode: structuredClone(catalog) },
    revision: ModelsDev.revision(),
  })
  const requests: string[] = []
  const transport = spyOn(globalThis, "fetch").mockImplementation((async (input) => {
    if (String(input).startsWith("https://zen.invalid/")) requests.push(String(input))
    return Response.json({
      id: "fake-message",
      type: "message",
      role: "assistant",
      model: "anthropic-model",
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  }) as typeof fetch)
  try {
    await using tmp = await tmpdir({
      config: {
        disabled_providers: ["ollama"],
        provider: {
          opencode: {
            options: { modelDiscovery: false },
            models: { "anthropic-model": { name: "Renamed model" } },
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const id of ["atomcli", "opencode"]) {
          const resolved = await Provider.getModel(id, "anthropic-model")
          expect(resolved.api.url).toBe("https://zen.invalid/anthropic/v1")
          const language = await Provider.getLanguage(resolved)
          const result = await language.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
            maxOutputTokens: 8,
          })
          expect(result.content).toContainEqual({ type: "text", text: "OK" })
        }
      },
    })
    expect(requests).toEqual(["https://zen.invalid/anthropic/v1/messages", "https://zen.invalid/anthropic/v1/messages"])
  } finally {
    transport.mockRestore()
    snapshot.mockRestore()
  }
})

test("Zen client rejection shows a short actionable message after retries", async () => {
  const { APICallError } = await import("ai")
  const error = new APICallError({
    message: "Forbidden",
    url: "https://zen.invalid/openai/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 403,
    responseBody: JSON.stringify({ error: { message: "OpenCode's free tier can only be used from within OpenCode." } }),
  })
  expect(ProviderTransform.error("atomcli", error)).toContain("after automatic retries")
  expect(ProviderTransform.error("opencode", error)).toContain("Try another model")
  expect(ProviderTransform.error("other", error)).toBe("Forbidden")
})

test("Zen streaming tool calls without indexes survive fragmented UTF-8 and retain call identity", async () => {
  const snapshot = spyOn(ModelsDev, "getWithRevision").mockResolvedValue({
    database: { opencode: structuredClone(catalog) },
    revision: ModelsDev.revision(),
  })
  const chunks = [
    { tool_calls: [{ id: "fake-call-a", type: "function", function: { name: "read", arguments: '{"path":' } }] },
    { tool_calls: [{ index: 7, id: "fake-call-b", type: "function", function: { name: "read", arguments: "{}" } }] },
    { tool_calls: [{ id: "fake-call-a", type: "function", function: { arguments: '"örnek.txt"}' } }] },
  ]
  const sse =
    chunks
      .map(
        (delta) =>
          `data: ${JSON.stringify({
            id: "fake-completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "free-model",
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\r\n\r\n`,
      )
      .join("") + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
  const transport = spyOn(globalThis, "fetch").mockImplementation(
    (async (_input, _init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of new TextEncoder().encode(sse)) controller.enqueue(new Uint8Array([byte]))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )) as typeof fetch,
  )
  try {
    await using tmp = await tmpdir({ config: { disabled_providers: ["ollama"] } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const language = await Provider.getLanguage(await Provider.getModel("atomcli", "free-model"))
        const response = await language.doStream({
          prompt: [{ role: "user", content: [{ type: "text", text: "Read the files" }] }],
          tools: [{ type: "function", name: "read", inputSchema: { type: "object" } }],
        })
        const parts = []
        const reader = response.stream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          parts.push(value)
        }
        expect(parts.filter((part) => part.type === "error")).toEqual([])
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([
          { type: "tool-call", toolCallId: "fake-call-b", toolName: "read", input: "{}" },
          { type: "tool-call", toolCallId: "fake-call-a", toolName: "read", input: '{"path":"örnek.txt"}' },
        ])
      },
    })
  } finally {
    transport.mockRestore()
    snapshot.mockRestore()
  }
})
