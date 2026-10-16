import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/integrations/provider/transform"

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral returns empty object", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns reliable reasoning params for all reasoning-capable models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      // none uses enabled: false (universally reliable across OpenRouter)
      expect(result.none).toEqual({ reasoning: { enabled: false } })
      // minimal and xhigh use max_tokens (universally reliable budget control)
      expect(result.minimal).toEqual({ reasoning: { max_tokens: 1024 } })
      expect(result.xhigh).toEqual({ reasoning: { max_tokens: 32768 } })
      // low/medium/high use effort (standard OpenRouter reasoning API)
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.medium).toEqual({ reasoning: { effort: "medium" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    test("gpt models return reasoning variants", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.none).toEqual({ reasoning: { enabled: false } })
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    test("gemini-3 returns reasoning variants", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    test("grok-4 returns reasoning variants", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/gateway", () => {
    test("returns OPENAI_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "gateway/gateway-model",
        providerID: "gateway",
        api: {
          id: "gateway-model",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/cerebras", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "cerebras/llama-4",
        providerID: "cerebras",
        api: {
          id: "llama-4-sc",
          url: "https://api.cerebras.ai",
          npm: "@ai-sdk/cerebras",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/togetherai", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "togetherai/llama-4",
        providerID: "togetherai",
        api: {
          id: "llama-4-sc",
          url: "https://api.togetherai.com",
          npm: "@ai-sdk/togetherai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/xai", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3",
        providerID: "xai",
        api: {
          id: "grok-3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/deepinfra", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "deepinfra/llama-4",
        providerID: "deepinfra",
        api: {
          id: "llama-4-sc",
          url: "https://api.deepinfra.com",
          npm: "@ai-sdk/deepinfra",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/azure", () => {
    test("o1-mini returns empty object", () => {
      const model = createMockModel({
        id: "o1-mini",
        providerID: "azure",
        api: {
          id: "o1-mini",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard azure models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "o1",
        providerID: "azure",
        api: {
          id: "o1",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5 adds minimal effort", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "azure",
        api: {
          id: "gpt-5",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
    })
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns empty object", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("models after 2025-12-04 include 'xhigh' effort", () => {
      const model = createMockModel({
        id: "openai/gpt-5-chat",
        providerID: "openai",
        api: {
          id: "gpt-5-chat",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-12-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/anthropic", () => {
    test("returns high and max with thinking config", () => {
      const model = createMockModel({
        id: "anthropic/claude-4",
        providerID: "anthropic",
        api: {
          id: "claude-4",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })
  })

  describe("@ai-sdk/amazon-bedrock", () => {
    test("does not invent unsupported effort controls", () => {
      const model = createMockModel({
        id: "bedrock/llama-4",
        providerID: "bedrock",
        api: {
          id: "llama-4-sc",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@ai-sdk/google", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google/gemini-2.5-pro",
        providerID: "google",
        api: {
          id: "gemini-2.5-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      })
      expect(result.max).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      })
    })

    test("other gemini models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google/gemini-2.0-pro",
        providerID: "google",
        api: {
          id: "gemini-2.0-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "low",
        },
      })
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      })
    })
  })

  describe("@ai-sdk/google-vertex", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.5-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.5-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
    })

    test("other vertex models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.0-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.0-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
    })
  })

  describe("@ai-sdk/cohere", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "cohere/command-r",
        providerID: "cohere",
        api: {
          id: "command-r",
          url: "https://api.cohere.com",
          npm: "@ai-sdk/cohere",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@ai-sdk/groq", () => {
    test("returns none and WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "groq/llama-4",
        providerID: "groq",
        api: {
          id: "llama-4-sc",
          url: "https://api.groq.com",
          npm: "@ai-sdk/groq",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "low", "medium", "high"])
      expect(result.none).toEqual({ reasoningEffort: "none" })
      expect(result.low).toEqual({ reasoningEffort: "low" })
    })
  })

  describe("catalog reasoning options", () => {
    test("combines toggle and effort controls without losing the disable option", () => {
      const model = createMockModel({
        providerID: "atomcli",
        api: { id: "hy3-free", url: "https://atomcli.ai/zen/v1", npm: "@ai-sdk/openai-compatible" },
      })
      const variants = ProviderTransform.reasoningVariants(
        {
          reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "medium", "high"] }],
        } as any,
        model,
      )!
      model.variants = variants

      expect(Object.keys(variants)).toEqual(["none", "high", "low", "medium"])
      expect(
        ProviderTransform.atomcliThinkingBody(model, {
          model: "hy3-free",
          reasoning_effort: variants.none.reasoningEffort,
        }),
      ).toEqual({ model: "hy3-free", thinking: { type: "disabled" } })
      expect(
        ProviderTransform.atomcliThinkingBody(model, {
          model: "hy3-free",
          reasoning_effort: variants.low.reasoningEffort,
        }),
      ).toEqual({ model: "hy3-free", reasoning_effort: "low", thinking: { type: "enabled" } })
    })

    test("maps toggle-only controls and keeps explicit unsupported declarations authoritative", () => {
      const supported = createMockModel({
        providerID: "atomcli",
        api: { id: "toggle", url: "https://atomcli.ai/zen/v1", npm: "@ai-sdk/openai-compatible" },
      })
      expect(
        ProviderTransform.reasoningVariants({ reasoning_options: [{ type: "toggle" }] } as any, supported),
      ).toMatchObject({ none: {}, high: {} })

      const unsupported = createMockModel({
        api: { id: "local", url: "http://localhost", npm: "unknown-provider" },
      })
      expect(
        ProviderTransform.reasoningVariants({ reasoning_options: [{ type: "toggle" }] } as any, unsupported),
      ).toEqual({})

      const genericCompatible = createMockModel({
        providerID: "custom",
        api: { id: "custom", url: "https://example.com/v1", npm: "@ai-sdk/openai-compatible" },
      })
      expect(
        ProviderTransform.reasoningVariants({ reasoning_options: [{ type: "toggle" }] } as any, genericCompatible),
      ).toEqual({})
    })

    test("maps token-budget declarations to the provider's supported wire shape", () => {
      const model = createMockModel({
        api: { id: "claude", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
        limit: { context: 128_000, output: 20_000 },
      })
      expect(
        ProviderTransform.reasoningVariants(
          { reasoning_options: [{ type: "budget_tokens", min: 4_000, max: 12_000 }] } as any,
          model,
        ),
      ).toEqual({
        high: { thinking: { type: "enabled", budgetTokens: 6_000 } },
        max: { thinking: { type: "enabled", budgetTokens: 12_000 } },
      })
    })

    test("does not reduce catalog budgets below their declared minimum", () => {
      const model = createMockModel({
        api: { id: "claude", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
        limit: { context: 128_000, output: 64_001 },
      })
      expect(
        ProviderTransform.reasoningVariants(
          { reasoning_options: [{ type: "budget_tokens", min: 40_000, max: 50_000 }] } as any,
          model,
        ),
      ).toEqual({
        high: { thinking: { type: "enabled", budgetTokens: 40_000 } },
        max: { thinking: { type: "enabled", budgetTokens: 50_000 } },
      })
    })

    test("uses only effort levels explicitly declared by the catalog", () => {
      const model = createMockModel({
        id: "atomcli/muse-spark-1.2-contributor-free",
        providerID: "atomcli",
        api: {
          id: "muse-spark-1.2-contributor-free",
          url: "https://atomcli.ai/zen/v1",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.reasoningVariants(
        {
          reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high", "xhigh"] }],
        } as any,
        model,
      )

      expect(Object.keys(result ?? {})).toEqual(["minimal", "low", "medium", "high", "xhigh"])
      expect(result?.xhigh).toEqual({
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("treats an explicitly empty declaration as non-configurable", () => {
      const model = createMockModel()
      expect(ProviderTransform.reasoningVariants({ reasoning_options: [] } as any, model)).toEqual({})
    })

    test("maps null effort to the none variant", () => {
      const model = createMockModel()
      expect(
        ProviderTransform.reasoningVariants(
          { reasoning_options: [{ type: "effort", values: [null, "high"] }] } as any,
          model,
        ),
      ).toMatchObject({
        none: { reasoningEffort: "none" },
        high: { reasoningEffort: "high" },
      })
    })
  })

  describe("applyVariant", () => {
    test("applies the selected variant last and preserves nested options", () => {
      const model = createMockModel({
        variants: {
          high: {
            thinkingConfig: { thinkingLevel: "high" },
            reasoningEffort: "high",
          },
        },
      })

      expect(
        ProviderTransform.applyVariant(
          model,
          "high",
          { thinkingConfig: { includeThoughts: true }, reasoningEffort: "low" },
          { custom: "model" },
          { custom: "agent" },
        ),
      ).toEqual({
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
        reasoningEffort: "high",
        custom: "agent",
      })
    })

    test("does not apply user variants to small-model calls", () => {
      const model = createMockModel({ variants: { high: { reasoningEffort: "high" } } })
      expect(ProviderTransform.applyVariant(model, "high", { reasoningEffort: "minimal" }, {}, {}, true)).toEqual({
        reasoningEffort: "minimal",
      })
    })

    test("does not send internal routing metadata to providers", () => {
      const model = createMockModel()
      expect(
        ProviderTransform.applyVariant(
          model,
          undefined,
          {},
          {
            public: "value",
            _routePolicy: { mode: "free" },
            _fallbackChain: { primary: "model" },
            _metaRouter: { modelID: "router" },
          },
        ),
      ).toEqual({ public: "value" })
    })

    test("rejects stale or unsupported variant names", () => {
      const model = createMockModel({ variants: { high: { reasoningEffort: "high" } } })
      expect(() => ProviderTransform.applyVariant(model, "xhigh", { reasoningEffort: "low" })).toThrow(
        'Unsupported variant "xhigh"',
      )
    })
  })

  describe("@ai-sdk/perplexity", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "perplexity/sonar-plus",
        providerID: "perplexity",
        api: {
          id: "sonar-plus",
          url: "https://api.perplexity.ai",
          npm: "@ai-sdk/perplexity",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("ProviderTransform.sseToChatCompletion", () => {
    test("aggregates streaming text chunks into chat completion JSON", () => {
      const sse = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world!"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ].join("\n\n")

      const result = ProviderTransform.sseToChatCompletion(sse, "test-model")
      expect(result).not.toBeNull()
      expect(result?.id).toBe("chatcmpl-1")
      expect(result?.model).toBe("test-model")
      expect(result?.choices[0].message.content).toBe("Hello world!")
      expect(result?.choices[0].finish_reason).toBe("stop")
    })

    test("aggregates reasoning content and usage", () => {
      const sse = [
        'data: {"id":"chatcmpl-2","choices":[{"delta":{"reasoning_content":"Thinking..."}}]}',
        'data: {"choices":[{"delta":{"content":"Answer"}}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      ].join("\n")

      const result = ProviderTransform.sseToChatCompletion(sse, "test-model")
      expect(result?.choices[0].message.reasoning_content).toBe("Thinking...")
      expect(result?.choices[0].message.content).toBe("Answer")
      expect(result?.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 })
    })

    test("aggregates streaming tool call chunks across indices", () => {
      const sse = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_","arguments":"{\\"city\\":"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"\\"Paris\\"}"}}]}}]}',
      ].join("\n")

      const result = ProviderTransform.sseToChatCompletion(sse, "test-model")
      expect(result?.choices[0].finish_reason).toBe("tool_calls")
      expect(result?.choices[0].message.tool_calls).toEqual([
        {
          id: "call_1",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"city":"Paris"}',
          },
        },
      ])
    })

    test("handles CRLF line endings and alternative reasoning fields", () => {
      const sse = [
        'data: {"choices":[{"delta":{"thinking":"Deep thought..."}}]}',
        'data: {"id":"chatcmpl-3","model":"model-override","choices":[{"delta":{"reasoning":" More thought."}}]}',
        'data: {"choices":[{"delta":{"content":"Final answer"}}]}',
      ].join("\r\n")

      const result = ProviderTransform.sseToChatCompletion(sse, "default-model")
      expect(result?.id).toBe("chatcmpl-3")
      expect(result?.model).toBe("model-override")
      expect(result?.choices[0].message.reasoning_content).toBe("Deep thought... More thought.")
      expect(result?.choices[0].message.content).toBe("Final answer")
    })

    test("generates fallback tool call IDs when omitted across all chunks", () => {
      const sse = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"calc","arguments":"{\\"x\\":1}"}}]}}]}',
      ].join("\n")

      const result = ProviderTransform.sseToChatCompletion(sse, "test-model")
      expect(result?.choices[0].finish_reason).toBe("tool_calls")
      expect(result?.choices[0].message.tool_calls?.[0]?.id).toMatch(/^call_0_\d+$/)
      expect(result?.choices[0].message.tool_calls?.[0]?.function.name).toBe("calc")
    })

    test("returns null for empty or non-data SSE stream", () => {
      expect(ProviderTransform.sseToChatCompletion("", "test-model")).toBeNull()
      expect(ProviderTransform.sseToChatCompletion("data: [DONE]", "test-model")).toBeNull()
      expect(ProviderTransform.sseToChatCompletion("invalid sse stream", "test-model")).toBeNull()
    })
  })
})
