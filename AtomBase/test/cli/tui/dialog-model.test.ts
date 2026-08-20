import { describe, expect, test } from "bun:test"
import { ModelDialog } from "@tui/component/dialog-model"
import type { Provider } from "@/integrations/provider/provider"

function model(overrides: Partial<Provider.Model> = {}) {
  return {
    id: "reasoner-pro",
    providerID: "example",
    name: "Reasoner Pro",
    family: "reasoner",
    api: { id: "reasoner-pro", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, output: 32_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: {},
    ...overrides,
  } as Provider.Model
}

describe("model dialog presentation", () => {
  const provider = { id: "example" } as Provider.Info

  test("formats model limits compactly", () => {
    expect(ModelDialog.formatTokens(0)).toBe("—")
    expect(ModelDialog.formatTokens(128_000)).toBe("128K")
    expect(ModelDialog.formatTokens(1_500_000)).toBe("1.5M")
  })

  test("shows clear per-million-token pricing", () => {
    expect(ModelDialog.formatPrice(0)).toBe("Free")
    expect(ModelDialog.formatPrice(0.0025)).toBe("$0.0025/M")
    expect(ModelDialog.formatPrice(2.5)).toBe("$2.50/M")
  })

  test("requires both input and output pricing to be zero for free models", () => {
    expect(ModelDialog.isFree(provider, model())).toBe(true)
    expect(ModelDialog.isFree(provider, model({ cost: { input: 0, output: 1, cache: { read: 0, write: 0 } } }))).toBe(
      false,
    )
  })

  test("treats Codex OAuth models as subscription access instead of free", () => {
    const codex = model({
      providerID: "openai",
      api: {
        id: "gpt-5.6-luna",
        npm: "@ai-sdk/openai",
        url: "https://chatgpt.com/backend-api/codex",
      },
    })
    const openai = { id: "openai" } as Provider.Info

    expect(ModelDialog.billing(openai, codex)).toBe("subscription")
    expect(ModelDialog.isFree(openai, codex)).toBe(false)
    expect(ModelDialog.statusLabel(openai, codex)).toBe("SUBSCRIPTION")
  })

  test("falls back to active when runtime model status is missing", () => {
    const paid = model({
      cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
      status: undefined as unknown as Provider.Model["status"],
    })

    expect(ModelDialog.statusLabel(provider, paid)).toBe("ACTIVE")
    expect(ModelDialog.statusLabel(provider, model())).toBe("FREE")
  })

  test("shows upstream rate-limited AtomCLI models without hiding them", () => {
    const atomcli = { id: "atomcli", name: "AtomCLI" } as Provider.Info
    const limited = model({
      id: "big-pickle",
      providerID: "atomcli",
      availability: { status: "rate_limited", retryAt: Date.now() + 60_000, source: "retry-after" },
    })

    expect(ModelDialog.statusLabel(atomcli, limited)).toBe("RATE LIMITED")
    expect(ModelDialog.keywords(atomcli, limited)).toContain("rate limited")
  })

  test("indexes IDs, providers and capabilities for search", () => {
    const provider = {
      id: "example",
      name: "Example Cloud",
      source: "api",
      env: [],
      options: {},
      models: {},
    } as Provider.Info
    const value = model()

    expect(ModelDialog.capabilities(value)).toEqual(["reasoning", "tools", "images", "pdf"])
    expect(ModelDialog.keywords(provider, value)).toContain("example Example Cloud reasoner-pro Reasoner Pro")
    expect(ModelDialog.keywords(provider, value)).toContain("reasoning tools images pdf free ücretsiz 200K context")
  })

  test("distinguishes model choices from provider actions", () => {
    expect(ModelDialog.isValue({ providerID: "openai", modelID: "gpt-5" })).toBe(true)
    expect(ModelDialog.isValue("openai")).toBe(false)
    expect(ModelDialog.isValue({ providerID: "openai" })).toBe(false)
  })
})
