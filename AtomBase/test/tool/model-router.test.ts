import { describe, test, expect } from "bun:test"
import {
  _internals as routerInternals,
  inferCategoryMulti,
  estimateComplexity,
  selectCandidates,
  modelStates,
  recordCallResult,
  finalScore,
  selectModel,
  MODE_WEIGHTS,
  selectModelInternal,
  buildFallbackChain,
  categoryHardOk,
  estimateRequiredContext,
  type TaskCategory,
} from "@/integrations/tool/model-router"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const { scoreModel, inferCategory, scoreAgainstPatterns, pickWithLoadBalancing } = routerInternals

const baseModel: Provider.Model = {
  id: "test-model-1",
  providerID: "atomcli",
  api: { id: "test-1", url: "http://test", npm: "test" },
  name: "Test Model 1",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 8192 },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2026-01-01",
  variants: {},
}

describe("model-router - inferCategoryMulti", () => {
  test("categorizes coding prompt with margin check", () => {
    const res = inferCategoryMulti("Write a function to refactor the database schema and fix the compiling bugs.")
    expect(res.category).toBe("coding")
    expect(res.confidence).toBeGreaterThan(0.5)
  })

  test("categorizes documentation prompt", () => {
    const res = inferCategoryMulti(
      "Prepare a markdown README file detailing the installation guide and project changelog.",
    )
    expect(res.category).toBe("documentation")
    expect(res.confidence).toBeGreaterThan(0.5)
  })

  test("falls back to general when categories are close (margin test)", () => {
    // Both coding (test: 1.5) and analysis (analyze: 2.0) are very close, margin is 0.5 < 2.0 * 0.3 = 0.6
    const res = inferCategoryMulti("Test this and analyze it.")
    expect(res.category).toBe("general")
    expect(res.confidence).toBe(0.4)
  })
})

describe("model-router - estimateComplexity", () => {
  test("low complexity for short simple prompt", () => {
    const score = estimateComplexity("hello")
    expect(score).toBeLessThan(3)
  })

  test("high complexity for prompt with code block and multiple terms", () => {
    const prompt = `Write a recursive concurrent algorithm to handle async session compaction.
    \`\`\`typescript
    function compact() {}
    \`\`\`
    How does it perform?`
    const score = estimateComplexity(prompt)
    expect(score).toBeGreaterThanOrEqual(5)
  })
})

describe("model-router - ModelState and recordCallResult", () => {
  test("records success and latency correctly", () => {
    const modelID = "test-model-stats"
    recordCallResult(modelID, true, 120)

    const state = modelStates.get(modelID)
    expect(state).toBeDefined()
    expect(state?.consecutiveFailures).toBe(0)
    expect(state?.recentLatenciesMs).toContain(120)
    expect(state?.usageCount).toBe(1)
  })

  test("records consecutive failures correctly", () => {
    const modelID = "test-model-failures"
    recordCallResult(modelID, false)
    recordCallResult(modelID, false)

    const state = modelStates.get(modelID)
    expect(state?.consecutiveFailures).toBe(2)
    expect(state?.lastError).not.toBeNull()
  })
})

describe("model-router - selectCandidates (Degradation Ladder)", () => {
  const modelWithToolcall: Provider.Model = { ...baseModel }
  const modelWithReasoning: Provider.Model = {
    ...baseModel,
    id: "reasoning-model",
    capabilities: {
      ...baseModel.capabilities,
      toolcall: false,
      reasoning: true,
    },
  }

  test("filters models strictly when criteria matches (Tier 0 / Tier 1)", () => {
    const candidates = selectCandidates(
      [
        ["test-model-1", modelWithToolcall],
        ["reasoning-model", modelWithReasoning],
      ],
      "coding",
    )
    // Only coding capable model (requires toolcall) should be picked
    expect(candidates).toHaveLength(1)
    expect(candidates[0][0]).toBe("test-model-1")
  })

  test("relaxes criteria when no candidate matches (Tier 3 fallback)", () => {
    const candidates = selectCandidates([["reasoning-model", modelWithReasoning]], "coding")
    // No model satisfies coding, so fallback returns all models
    expect(candidates).toHaveLength(1)
    expect(candidates[0][0]).toBe("reasoning-model")
  })
})

describe("model-router - finalScore and selectModel", () => {
  test("adds complexity bonus to reasoning models", () => {
    const reasoningModel = {
      ...baseModel,
      capabilities: { ...baseModel.capabilities, reasoning: true },
    }
    const scoreNormal = finalScore("test-1", reasoningModel, "analysis", "balanced", 0)
    const scoreComplex = finalScore("test-1", reasoningModel, "analysis", "balanced", 8)
    expect(scoreComplex).toBe(scoreNormal + 40)
  })

  test("selectModel is backward compatible with fallback object", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fallback = { providerID: "atomcli", modelID: "gpt-5-nano" }
        // When smart routing is disabled:
        const result = await selectModel("coding", fallback)
        expect(result).toEqual(fallback)
      },
    })
  })
})

describe("model-router - pickWithLoadBalancing", () => {
  test("returns the only model when ranked has single entry", () => {
    const ranked = [{ id: "only-model", m: { ...baseModel }, score: 100 }]
    const result = pickWithLoadBalancing(ranked, 1)
    expect(result.id).toBe("only-model")
    expect(result.score).toBe(100)
  })

  test("returns a valid model from the ranked list", () => {
    const ranked = [
      { id: "lb-model-a", m: { ...baseModel }, score: 100 },
      { id: "lb-model-b", m: { ...baseModel, id: "lb-model-b" }, score: 80 },
    ]
    const result = pickWithLoadBalancing(ranked, 2)
    expect(ranked.map((r) => r.id)).toContain(result.id)
    expect(result.m).toBeDefined()
  })

  test("all models considered when pool is small (<=3)", () => {
    const ranked = [
      { id: "small-pool-a", m: { ...baseModel, id: "small-pool-a" }, score: 90 },
      { id: "small-pool-b", m: { ...baseModel, id: "small-pool-b" }, score: 80 },
    ]
    const result = pickWithLoadBalancing(ranked, 2)
    expect(["small-pool-a", "small-pool-b"]).toContain(result.id)
  })

  test("usageCount affects selection weights", () => {
    const modelA = "lb-usage-a"
    const modelB = "lb-usage-b"
    recordCallResult(modelB, true, 100)
    recordCallResult(modelB, true, 100)
    recordCallResult(modelB, true, 100)

    const stateB = modelStates.get(modelB)
    expect(stateB?.usageCount).toBe(3)

    const ranked = [
      { id: modelA, m: { ...baseModel }, score: 100 },
      { id: modelB, m: { ...baseModel, id: modelB }, score: 100 },
    ]
    const result = pickWithLoadBalancing(ranked, 2)
    expect([modelA, modelB]).toContain(result.id)
  })

  test("returns the top pick consistently when weights are heavily skewed", () => {
    // When one model has much higher score, it dominates the weighted random selection
    const ranked = [
      { id: "lb-skewed-high", m: { ...baseModel }, score: 9999 },
      { id: "lb-skewed-low", m: { ...baseModel, id: "lb-skewed-low" }, score: 1 },
    ]
    const results = new Array(20).fill(0).map(() => pickWithLoadBalancing(ranked, 2).id)
    const highCount = results.filter((id) => id === "lb-skewed-high").length
    expect(highCount).toBeGreaterThan(15)
  })
})

describe("model-router - selectModelInternal", () => {
  test("returns selected + ranked structure", () => {
    const models: Array<[string, Provider.Model]> = [["smi-struct-a", { ...baseModel }]]
    const result = selectModelInternal("general", models)
    expect(result.selected).toBeDefined()
    expect(result.selected.id).toBe("smi-struct-a")
    expect(result.ranked).toBeDefined()
    expect(result.ranked.length).toBe(1)
    expect(result.ranked[0].id).toBe("smi-struct-a")
  })

  test("context filtering works with session", () => {
    const smallModel: Provider.Model = {
      ...baseModel,
      id: "smi-small-ctx",
      limit: { ...baseModel.limit, context: 4000 },
    }
    const largeModel: Provider.Model = {
      ...baseModel,
      id: "smi-large-ctx",
      limit: { ...baseModel.limit, context: 128000 },
    }
    const models: Array<[string, Provider.Model]> = [
      ["smi-small-ctx", smallModel],
      ["smi-large-ctx", largeModel],
    ]
    // session with high token count that exceeds small model's context
    const session = {
      systemPromptTokenCount: 3000,
      toolSchemaTokenCount: 5000,
      cumulativeTokenCount: 10000,
    }
    const result = selectModelInternal("general", models, "balanced", 0, session, "hello")
    // small-ctx (4000) filtered out by estimateRequiredContext (~20002 required)
    expect(result.ranked.length).toBe(1)
    expect(result.selected.id).toBe("smi-large-ctx")
  })

  test("mode affects ranking scores", () => {
    const model: Provider.Model = {
      ...baseModel,
      id: "smi-mode-model",
      capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: false },
    }
    const models: Array<[string, Provider.Model]> = [["smi-mode-model", model]]

    const resultReasoning = selectModelInternal("general", models, "reasoning", 0)
    const resultSpeed = selectModelInternal("general", models, "speed", 0)

    // reasoning mode (weight 3.0) gives much higher score than speed mode (weight 0.0)
    expect(resultReasoning.ranked[0].score).toBeGreaterThan(resultSpeed.ranked[0].score)
  })

  test("complexity affects selection score for reasoning models", () => {
    const model: Provider.Model = {
      ...baseModel,
      id: "smi-complex-model",
      capabilities: { ...baseModel.capabilities, reasoning: true },
    }
    const models: Array<[string, Provider.Model]> = [["smi-complex-model", model]]

    const resultLow = selectModelInternal("analysis", models, "balanced", 2)
    const resultHigh = selectModelInternal("analysis", models, "balanced", 9)

    // High complexity (>=7) adds +40 bonus for reasoning models
    expect(resultHigh.ranked[0].score).toBeGreaterThan(resultLow.ranked[0].score)
  })

  test("throws on empty freeModels", () => {
    expect(() => selectModelInternal("general", [])).toThrow("NoFreeModelsError")
  })

  test("categoryHardOk filters effectively for coding category", () => {
    const withToolcall: Provider.Model = { ...baseModel, id: "smi-tc-model" }
    const noToolcall: Provider.Model = {
      ...baseModel,
      id: "smi-no-tc",
      capabilities: { ...baseModel.capabilities, toolcall: false },
    }
    const models: Array<[string, Provider.Model]> = [
      ["smi-no-tc", noToolcall],
      ["smi-tc-model", withToolcall],
    ]

    const result = selectModelInternal("coding", models, "balanced", 0)
    // noToolcall fails categoryHardOk for coding (no toolcall), but falls back via Tier 2 (general)
    const ids = result.ranked.map((r) => r.id)
    expect(ids).toContain("smi-tc-model")
  })
})

describe("model-router - buildFallbackChain", () => {
  test("returns primary + fallbacks structure", () => {
    const models: Array<[string, Provider.Model]> = [
      ["bfc-struct-a", { ...baseModel }],
      ["bfc-struct-b", { ...baseModel, id: "bfc-struct-b" }],
    ]
    const result = buildFallbackChain("general", models)
    expect(result.primary).toBeDefined()
    expect(result.primary.providerID).toBe("atomcli")
    expect(typeof result.primary.modelID).toBe("string")
    expect(result.fallbacks).toBeDefined()
    expect(Array.isArray(result.fallbacks)).toBe(true)
    expect(result.reason).toBeDefined()
    expect(typeof result.reason).toBe("string")
  })

  test("fallback count is at most 2", () => {
    const models: Array<[string, Provider.Model]> = [
      ["bfc-multi-a", { ...baseModel }],
      ["bfc-multi-b", { ...baseModel, id: "bfc-multi-b" }],
      ["bfc-multi-c", { ...baseModel, id: "bfc-multi-c" }],
      ["bfc-multi-d", { ...baseModel, id: "bfc-multi-d" }],
    ]
    const result = buildFallbackChain("general", models)
    expect(result.fallbacks.length).toBeLessThanOrEqual(2)
  })

  test("primary is different from all fallbacks", () => {
    const models: Array<[string, Provider.Model]> = [
      ["bfc-diff-a", { ...baseModel }],
      ["bfc-diff-b", { ...baseModel, id: "bfc-diff-b" }],
    ]
    const result = buildFallbackChain("general", models)
    expect(result.fallbacks.length).toBeGreaterThan(0)
    for (const fb of result.fallbacks) {
      expect(fb.modelID).not.toBe(result.primary.modelID)
    }
  })

  test("reason string includes category, mode, and score", () => {
    const models: Array<[string, Provider.Model]> = [["bfc-reason-model", { ...baseModel }]]
    const result = buildFallbackChain("coding", models, "speed", 0)
    expect(result.reason).toContain("category=coding")
    expect(result.reason).toContain("mode=speed")
    expect(result.reason).toContain("finalScore=")
  })
})

describe("model-router - finalScore edge cases", () => {
  test("high complexity (>=7) gives +40 reasoning bonus", () => {
    const modelID = "fse-reasoning-bonus"
    const model: Provider.Model = {
      ...baseModel,
      capabilities: { ...baseModel.capabilities, reasoning: true },
    }
    const scoreNormal = finalScore(modelID, model, "analysis", "balanced", 0)
    const scoreComplex = finalScore(modelID, model, "analysis", "balanced", 8)
    expect(scoreComplex).toBe(scoreNormal + 40)
  })

  test("latency penalty reduces score proportionally", () => {
    const modelID = "fse-latency-penalty"
    const model: Provider.Model = { ...baseModel }
    // No recorded latency → uses context proxy (128k ctx → 1280ms default)
    const scoreNoData = finalScore(modelID, model, "general", "speed", 0)

    // Record low latency → decreases penalty
    recordCallResult(modelID, true, 50)
    const scoreLowLat = finalScore(modelID, model, "general", "speed", 0)

    expect(scoreLowLat).toBeGreaterThan(scoreNoData)
  })

  test("health penalty from consecutive failures reduces score", () => {
    const modelIDFail = "fse-health-fail"
    const modelIDClean = "fse-health-clean"
    const model: Provider.Model = { ...baseModel }

    recordCallResult(modelIDFail, false)
    recordCallResult(modelIDFail, false)

    const scoreWithFailures = finalScore(modelIDFail, model, "general", "balanced", 0)
    const scoreClean = finalScore(modelIDClean, model, "general", "balanced", 0)

    // 2 failures → 30 point penalty
    const diff = scoreClean - scoreWithFailures
    expect(diff).toBeGreaterThanOrEqual(25)
  })

  test("MODE_WEIGHTS affect scoring differently", () => {
    const modelID = "fse-mode-weights"
    const model: Provider.Model = {
      ...baseModel,
      capabilities: { ...baseModel.capabilities, reasoning: true },
    }

    const scoreSpeed = finalScore(modelID, model, "general", "speed", 0)
    const scoreReasoning = finalScore(modelID, model, "general", "reasoning", 0)

    // reasoning mode (weight 3.0) gives higher score than speed mode (weight 0.0)
    expect(scoreReasoning).toBeGreaterThan(scoreSpeed)
  })
})
