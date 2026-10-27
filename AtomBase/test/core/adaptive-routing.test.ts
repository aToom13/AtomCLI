import "../preload"
import { describe, expect, test } from "bun:test"
import { AdaptivePolicy } from "@/core/routing/adaptive-policy"
import { RouteEligibility } from "@/core/routing/route-eligibility"
import { TaskProfile } from "@/core/routing/task-profile"

const model = {
  id: "model",
  providerID: "provider",
  capabilities: {
    input: { text: true, image: false, audio: false, video: false, pdf: false },
    output: { text: true },
    toolcall: true,
  },
  limit: { context: 32_000, output: 4_000 },
  variants: { high: { reasoningEffort: "high" } },
} as any

describe("adaptive routing policy", () => {
  test("defaults the engine and UI to ask mode when adaptive config is omitted", () => {
    expect(AdaptivePolicy.withDefaults()).toMatchObject({ mode: "ask", thinking: { mode: "ask" } })
    expect(AdaptivePolicy.withDefaults({ thinking: { mode: "off" as const } })).toMatchObject({
      mode: "ask",
      thinking: { mode: "off" },
    })
  })

  test("fails eligibility closed without relaxing Free, variant, or capability constraints", () => {
    const result = RouteEligibility.evaluate({
      model,
      connected: true,
      providerAllowed: true,
      freeOnly: true,
      price: "paid",
      requiredCapabilities: ["image"],
      variant: "max",
      paramsDigest: "params",
      verificationKey: "key",
    })
    expect(result.decision).toBe("ineligible")
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["free_model_required", "variant_unsupported", "modality_unsupported"]),
    )
  })

  test("distinguishes missing verification from an eligible current capability proof", () => {
    const missing = RouteEligibility.evaluate({
      model,
      connected: true,
      providerAllowed: true,
      price: "free",
      paramsDigest: "params",
      verificationKey: "key",
      now: 100,
    })
    expect(missing.decision).toBe("verification_required")
    const eligible = RouteEligibility.evaluate({
      model,
      connected: true,
      providerAllowed: true,
      price: "free",
      paramsDigest: "params",
      verificationKey: "key",
      now: 100,
      verification: { status: "verified", capabilities: { text: 200 } },
    })
    expect(eligible).toMatchObject({ decision: "eligible", expiresAt: 200 })
  })
})
