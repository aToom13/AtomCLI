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

  test("keeps routine work quiet and proposes supported thinking only with concrete evidence", () => {
    const profile = TaskProfile.infer("Format this file", "coding")
    expect(
      AdaptivePolicy.evaluate({ profile, stage: "implementation", routine: true, highRiskEvidence: ["diff:1"] }).kind,
    ).toBe("none")

    const proposal = AdaptivePolicy.evaluate({
      profile,
      stage: "implementation",
      highRiskEvidence: ["diff:auth"],
      concurrencyEvidence: ["test:race"],
      higherThinkingVariant: "high",
      thinkingEligible: true,
    })
    expect(proposal).toMatchObject({ kind: "thinking", score: 6, targetVariant: "high" })
  })

  test("does not turn operational failures or a repeated rejected fingerprint into escalation", () => {
    const profile = TaskProfile.infer("Fix the provider authentication error", "coding")
    expect(AdaptivePolicy.evaluate({ profile, stage: "implementation" }).kind).toBe("none")
    expect(
      AdaptivePolicy.evaluate({
        profile,
        stage: "implementation",
        highRiskEvidence: ["diff:auth"],
        concurrencyEvidence: ["test:race"],
        expertRoute: "p/expert",
        expertEligible: true,
        rejectedFingerprintMatches: true,
      }).kind,
    ).toBe("none")
  })

  test("uses execution scope to bound adaptive escalation", () => {
    const profile = TaskProfile.infer("Review concurrency and persistence risks", "coding")
    const evidence = {
      profile,
      stage: "review" as const,
      highRiskEvidence: ["diff:auth"],
      concurrencyEvidence: ["test:race"],
      higherThinkingVariant: "high",
      thinkingEligible: true,
      expertRoute: "p/expert",
      expertEligible: true,
    }

    expect(AdaptivePolicy.evaluate({ ...evidence, scope: "direct" }).kind).toBe("none")
    expect(AdaptivePolicy.evaluate({ ...evidence, scope: "focused" }).kind).toBe("thinking")
    expect(AdaptivePolicy.evaluate({ ...evidence, scope: "coordinated" }).kind).toBe("thinking")
    expect(
      AdaptivePolicy.evaluate({
        ...evidence,
        scope: "direct",
        explicitlyRequestedRoute: true,
      }).kind,
    ).toBe("expert")
  })

  test("turns an explicit user model request into an ask-mode proposal even without mutation evidence", () => {
    const profile = TaskProfile.infer("AtomCLI Auto modeline geçiş isteği gönder")
    expect(
      AdaptivePolicy.evaluate({
        profile,
        stage: "analysis",
        explicitlyRequestedRoute: true,
        expertRoute: "atomcli/verified-model",
        expertEligible: true,
      }),
    ).toMatchObject({
      kind: "expert",
      score: 10,
      reasonCodes: ["explicit_user_request"],
      targetRoute: "atomcli/verified-model",
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
