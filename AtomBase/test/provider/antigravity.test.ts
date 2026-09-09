import "../preload"
import { describe, expect, test } from "bun:test"
import {
  getAntigravityHeaders,
  getAntigravityVersion,
  setAntigravityVersion,
  MODEL_MAPPING,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_SANDBOX,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
} from "@/integrations/provider/antigravity/constants"
import { ModelBilling } from "@/integrations/provider/billing"
import { AntigravityAuthPlugin } from "@/integrations/plugin/antigravity"

describe("Antigravity Constants & Versioning", () => {
  test("minimum version is at least 2.11.0 for Gemini 3.8 support", () => {
    const version = getAntigravityVersion()
    const [major, minor] = version.split(".").map((n) => parseInt(n, 10))
    expect(major > 2 || (major === 2 && minor >= 11)).toBe(true)
  })

  test("does not downgrade below 2.11.0 when setAntigravityVersion is called with older version", () => {
    setAntigravityVersion("1.18.3")
    const version = getAntigravityVersion()
    expect(version).toBe("2.11.0")

    setAntigravityVersion("2.0.6")
    expect(getAntigravityVersion()).toBe("2.11.0")
  })

  test("User-Agent header includes antigravity/ide/<version>", () => {
    const headers = getAntigravityHeaders()
    expect(headers["User-Agent"]).toMatch(/^antigravity\/ide\/2\.11\.0\s+(windows\/amd64|darwin\/arm64|darwin\/amd64)$/)
  })

  test("endpoints fallback list includes daily, sandbox, autopush, prod", () => {
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toContain(ANTIGRAVITY_ENDPOINT_DAILY)
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toContain(ANTIGRAVITY_ENDPOINT_SANDBOX)
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toContain(ANTIGRAVITY_ENDPOINT_AUTOPUSH)
    expect(ANTIGRAVITY_ENDPOINT_FALLBACKS).toContain(ANTIGRAVITY_ENDPOINT_PROD)
  })

  test("Gemini 3.8 models are mapped correctly", () => {
    expect(MODEL_MAPPING["gemini-3.8-flash"]).toBeDefined()
    expect(MODEL_MAPPING["gemini-3.8-flash"].backend).toBe("gemini-3.8-flash-medium")
    expect(MODEL_MAPPING["gemini-3.8-flash-high"].backend).toBe("gemini-3.8-flash-high")
    expect(MODEL_MAPPING["gemini-3.8-flash-medium"].backend).toBe("gemini-3.8-flash-medium")
    expect(MODEL_MAPPING["gemini-3.8-flash-low"].backend).toBe("gemini-3.8-flash-low")
    expect(MODEL_MAPPING["gemini-3.8-flash-tiered"].backend).toBe("gemini-3.8-flash-medium")
  })

  test("Gemini 3.7 models are mapped correctly", () => {
    expect(MODEL_MAPPING["gemini-3.7-flash"]).toBeDefined()
    expect(MODEL_MAPPING["gemini-3.7-flash"].backend).toBe("gemini-3.7-flash-medium")
    expect(MODEL_MAPPING["gemini-3.7-flash-high"].backend).toBe("gemini-3.7-flash-high")
    expect(MODEL_MAPPING["gemini-3.7-flash-tiered"].backend).toBe("gemini-3.7-flash-medium")
  })

  test("Gemini 3.6, 3.5, and 3.1 models have valid backend targets", () => {
    expect(MODEL_MAPPING["gemini-3.6-flash"].backend).toBe("gemini-3.6-flash-medium")
    expect(MODEL_MAPPING["gemini-3.6-flash-tiered"].backend).toBe("gemini-3.6-flash-medium")
    expect(MODEL_MAPPING["gemini-3.5-flash"].backend).toBe("gemini-3.5-flash-low")
    expect(MODEL_MAPPING["gemini-3.5-flash-lite"].backend).toBe("gemini-3.5-flash-lite")
    expect(MODEL_MAPPING["gemini-3.1-pro"].backend).toBe("gemini-3.1-pro-low")
    expect(MODEL_MAPPING["gemini-3.1-pro-high"].backend).toBe("gemini-pro-agent")
    expect(MODEL_MAPPING["gemini-3.1-flash-lite"].backend).toBe("gemini-3.1-flash-lite")
    expect(MODEL_MAPPING["gemini-2.5-flash"].backend).toBe("gemini-2.5-flash")
    expect(MODEL_MAPPING["gemini-2.5-flash-lite"].backend).toBe("gemini-2.5-flash-lite")
  })

  test("Claude and OSS models are defined in MODEL_MAPPING", () => {
    expect(MODEL_MAPPING["claude-sonnet-4-6"].family).toBe("claude")
    expect(MODEL_MAPPING["claude-opus-4-6-thinking"].family).toBe("claude")
    expect(MODEL_MAPPING["gpt-oss-120b-medium"].family).toBe("openweight")
  })

  test("classifies OAuth entitlement models as subscription access", async () => {
    const plugin = await AntigravityAuthPlugin({} as any)
    const provider = { models: {} } as any

    await plugin.auth!.loader(async () => ({ type: "oauth" }) as any, provider)

    expect(Object.keys(provider.models).length).toBeGreaterThan(0)
    for (const model of Object.values(provider.models) as any[]) {
      expect(model.options).toMatchObject({ _billing: "subscription", _catalogCostKnown: false })
      expect(ModelBilling.classify(model)).toBe("subscription")
    }
  })
})
