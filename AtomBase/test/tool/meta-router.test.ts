import { describe, test, expect } from "bun:test"
import { selectMetaRouter } from "@/integrations/tool/meta-router"
import { Provider } from "@/integrations/provider/provider"

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

describe("meta-router - selectMetaRouter", () => {
  test("selects model with both reasoning and toolcall first", () => {
    const models: Array<[string, Provider.Model]> = [
      [
        "both-model",
        {
          ...baseModel,
          id: "both-model",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
        },
      ],
      [
        "toolcall-only",
        {
          ...baseModel,
          id: "toolcall-only",
          capabilities: { ...baseModel.capabilities, reasoning: false, toolcall: true },
        },
      ],
      [
        "reasoning-only",
        {
          ...baseModel,
          id: "reasoning-only",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: false },
        },
      ],
    ]
    const result = selectMetaRouter(models)
    expect(result.providerID).toBe("atomcli")
    expect(result.modelID).toBe("both-model")
  })

  test("falls back to reasoning OR toolcall when no model has both", () => {
    const models: Array<[string, Provider.Model]> = [
      [
        "reasoning-only",
        {
          ...baseModel,
          id: "reasoning-only",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: false },
        },
      ],
      [
        "toolcall-only",
        {
          ...baseModel,
          id: "toolcall-only",
          capabilities: { ...baseModel.capabilities, reasoning: false, toolcall: true },
        },
      ],
    ]
    const result = selectMetaRouter(models)
    expect(["reasoning-only", "toolcall-only"]).toContain(result.modelID)
  })

  test("handles empty model list by throwing", () => {
    const models: Array<[string, Provider.Model]> = []
    expect(() => selectMetaRouter(models)).toThrow()
  })

  test("prefers higher context and output models in scoring", () => {
    const models: Array<[string, Provider.Model]> = [
      [
        "high-spec",
        {
          ...baseModel,
          id: "high-spec",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
          limit: { context: 1000000, output: 32000 },
        },
      ],
      [
        "low-spec",
        {
          ...baseModel,
          id: "low-spec",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
          limit: { context: 16000, output: 4096 },
        },
      ],
    ]
    const result = selectMetaRouter(models)
    expect(result.modelID).toBe("high-spec")
  })

  test("excludes non-active models from primary selection", () => {
    const activeBoth = {
      ...baseModel,
      id: "active-both",
      capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
      status: "active" as const,
    }
    const inactiveBoth = {
      ...baseModel,
      id: "inactive-both",
      capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
      status: "deprecated" as const,
    }
    const models: Array<[string, Provider.Model]> = [
      ["inactive-both", inactiveBoth],
      ["active-both", activeBoth],
    ]
    const result = selectMetaRouter(models)
    expect(result.modelID).toBe("active-both")
  })

  test("falls back via selectCandidates when no model has reasoning or toolcall", () => {
    const basicModel: Provider.Model = {
      ...baseModel,
      id: "basic-only",
      capabilities: { ...baseModel.capabilities, reasoning: false, toolcall: false },
    }
    const models: Array<[string, Provider.Model]> = [["basic-only", basicModel]]
    const result = selectMetaRouter(models)
    expect(result.providerID).toBe("atomcli")
    expect(result.modelID).toBe("basic-only")
  })

  test("returns valid providerID and modelID format", () => {
    const models: Array<[string, Provider.Model]> = [
      [
        "valid-format",
        {
          ...baseModel,
          id: "valid-format",
          capabilities: { ...baseModel.capabilities, reasoning: true, toolcall: true },
        },
      ],
    ]
    const result = selectMetaRouter(models)
    expect(result.providerID).toBe("atomcli")
    expect(result.modelID).toBe("valid-format")
    expect(typeof result.providerID).toBe("string")
    expect(typeof result.modelID).toBe("string")
  })
})
