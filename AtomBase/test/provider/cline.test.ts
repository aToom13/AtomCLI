import "../preload"
import { describe, expect, test } from "bun:test"
import { Cline } from "@/integrations/provider/cline"
import type { Provider } from "@/integrations/provider/provider"
import { ClineOAuth } from "@/integrations/plugin/cline"

describe("provider.cline", () => {
  test("merges promoted and catalog-suffix free models", () => {
    const models = { stale: { id: "stale" } } as unknown as Provider.Info["models"]
    const count = Cline.applyModels(
      models,
      {
        data: [
          { id: "google/gemma-4-26b-a4b-it:free" },
          { id: "poolside/laguna-s-2.1:free" },
          { id: "paid/model" },
          { id: "paid/model:batch" },
        ],
      },
      {
        free: [
          { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark" },
          { id: "poolside/laguna-s-2.1:free" },
        ],
      },
    )

    expect(count).toBe(3)
    expect(Object.keys(models).sort()).toEqual([
      "cline-free/muse-spark-1.3-contributor",
      "google/gemma-4-26b-a4b-it:free",
      "poolside/laguna-s-2.1:free",
    ])
    expect(models.stale).toBeUndefined()
    expect(models["paid/model:batch"]).toBeUndefined()
    expect(models["cline-free/muse-spark-1.3-contributor"].name).toBe("Muse Spark")
    expect(models["google/gemma-4-26b-a4b-it:free"].options._clineFreeSource).toBe("catalog-suffix")
    expect(models["poolside/laguna-s-2.1:free"].options._clineFreeSource).toBe("both")
    for (const model of Object.values(models)) {
      expect(model.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } })
      expect(model.options._catalogCostKnown).toBe(true)
    }
  })

  test("enriches free models with OpenRouter reasoning controls", () => {
    const models = {} as Provider.Info["models"]

    Cline.applyModels(models, [{ id: "google/gemma-3-27b-it:free" }], { free: [] }, [
      {
        id: "google/gemma-3-27b-it:free",
        context_length: 131_072,
        top_provider: { max_completion_tokens: 32_768 },
        supported_parameters: ["reasoning", "include_reasoning"],
        architecture: { input_modalities: ["text", "image"] },
      },
    ])

    const model = models["google/gemma-3-27b-it:free"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
    expect(model.limit).toEqual({ context: 131_072, output: 32_768 })
    expect(model.variants).toEqual({
      none: { reasoning: { enabled: false } },
      low: { reasoning: { enabled: true, max_tokens: 2_048 } },
      medium: { reasoning: { enabled: true, max_tokens: 8_192 } },
      high: { reasoning: { enabled: true, max_tokens: 16_384 } },
      max: { reasoning: { enabled: true, max_tokens: 32_767 } },
    })
  })

  test("serializes selected thinking budget in Cline request body", async () => {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")
    const { generateText } = await import("ai")
    let body: Record<string, any> = {}
    const provider = createOpenAICompatible({
      name: "cline",
      apiKey: "fake-test-key",
      baseURL: Cline.API_BASE_URL,
      fetch: (async (_input, init) => {
        body = JSON.parse(init?.body as string)
        return Response.json({
          id: "chatcmpl-test",
          created: 1,
          model: "google/gemma-3-27b-it:free",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      }) as typeof fetch,
    })

    await generateText({
      model: provider.chatModel("google/gemma-3-27b-it:free"),
      prompt: "test",
      providerOptions: { cline: { reasoning: { enabled: true, max_tokens: 8_192 } } },
    })

    expect(body.reasoning).toEqual({ enabled: true, max_tokens: 8_192 })
  })

  test("builds required headers and keeps WorkOS prefix idempotent", () => {
    const first = Cline.buildHeaders("token", { "x-atomcli-session": "session-1" })
    const second = Cline.buildHeaders("workos:token", { "x-task-id": "task-2" })

    expect(first.get("authorization")).toBe("Bearer workos:token")
    expect(second.get("authorization")).toBe("Bearer workos:token")
    expect(first.get("x-task-id")).toBe("session-1")
    expect(second.get("x-task-id")).toBe("task-2")
    expect(first.get("x-client-type")).toBe("atomcli")
    expect(first.has("x-atomcli-session")).toBe(false)
  })

  test("rejects credential forwarding outside exact Cline API paths", () => {
    expect(Cline.resolveRequestUrl("https://api.cline.bot/api/v1/chat/completions").pathname).toBe(
      "/api/v1/chat/completions",
    )
    expect(() => Cline.resolveRequestUrl("https://attacker.example/api/v1/chat/completions")).toThrow("untrusted URL")
    expect(() => Cline.resolveRequestUrl("https://api.cline.bot.evil.example/api/v1/models")).toThrow("untrusted URL")
    expect(() => Cline.resolveRequestUrl("https://api.cline.bot/not-api/v1/models")).toThrow("untrusted URL")
  })

  test("decodes base64url callback tokens with trailing data", () => {
    const encoded = Buffer.from(
      `${JSON.stringify({ accessToken: "access", refreshToken: "refresh", expiresAt: "2030-01-01T00:00:00Z" })}ignored`,
    ).toString("base64url")

    expect(Cline.decodeAuthorizationCode(encoded)).toEqual({
      access: "access",
      refresh: "refresh",
      expires: Date.parse("2030-01-01T00:00:00Z"),
    })
  })

  test("uses Cline refresh contract and retains rotated tokens", async () => {
    let body: any
    const tokens = await Cline.refreshToken("old-refresh", (async (input, init) => {
      expect(input.toString()).toBe(Cline.REFRESH_URL)
      body = JSON.parse(init?.body as string)
      return Response.json({
        success: true,
        data: { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: "2030-01-01T00:00:00Z" },
      })
    }) as typeof fetch)

    expect(body).toEqual({ refreshToken: "old-refresh", grantType: "refresh_token", clientType: "extension" })
    expect(tokens.refresh).toBe("new-refresh")
    expect(tokens.access).toBe("new-access")
  })

  test("unwraps non-streaming Cline responses", async () => {
    const response = await Cline.normalizeResponse(
      Response.json({ data: { id: "chatcmpl-1", choices: [{ message: { content: "ok" } }] } }),
    )
    expect(await response.json()).toEqual({ id: "chatcmpl-1", choices: [{ message: { content: "ok" } }] })
  })

  test("surfaces errors delivered inside successful SSE responses", async () => {
    const response = await Cline.normalizeResponse(
      new Response('data: {"error":{"message":"upstream unavailable"}}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
    await expect(response.text()).rejects.toThrow("Cline stream error: upstream unavailable")
  })

  test("completes browser OAuth from encoded callback tokens", async () => {
    const flow = await ClineOAuth.beginAuthorization()
    const redirectUri = new URL(flow.url).searchParams.get("redirect_uri")!
    const callback = flow.callback()
    const code = Buffer.from(
      JSON.stringify({ accessToken: "access", refreshToken: "refresh", expiresAt: "2030-01-01T00:00:00Z" }),
    ).toString("base64url")

    const response = await fetch(`${redirectUri}?code=${encodeURIComponent(code)}`)
    expect(response.status).toBe(200)
    expect(await callback).toEqual({
      type: "success",
      access: "access",
      refresh: "refresh",
      expires: Date.parse("2030-01-01T00:00:00Z"),
    })
  })

  test("escapes OAuth errors rendered in callback pages", () => {
    const malicious = '<script>alert("oauth")</script>'
    const page = ClineOAuth.errorHtml(malicious)
    expect(page).not.toContain(malicious)
    expect(page).toContain("&lt;script&gt;")
  })
})
