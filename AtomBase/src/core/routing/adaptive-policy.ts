import z from "zod"
import type { Config } from "@/core/config/config"
import type { TaskProfile } from "./task-profile"

export namespace AdaptivePolicy {
  export const Defaults = {
    mode: "ask" as const,
    thinking: { mode: "ask" as const },
    base_models: [] as string[],
    expert_models: [] as string[],
    max_expert_episodes: 2,
    max_expert_calls: 3,
    max_expert_steps: 3,
    cooldown_steps: 3,
    proposal_ttl_ms: 120_000,
    return_to_base: true,
  }

  type Settings = NonNullable<Config.Info["adaptive_routing"]>
  export function withDefaults(
    input?: Partial<Omit<Settings, "thinking">> & { thinking?: Partial<Settings["thinking"]> },
  ) {
    return { ...Defaults, ...input, thinking: { ...Defaults.thinking, ...input?.thinking } }
  }

  export const Input = z.object({
    profile: z.custom<TaskProfile.Info>(),
    stage: z.enum(["implementation", "analysis", "design", "review"]),
    routine: z.boolean().default(false),
    highRiskEvidence: z.array(z.string()).default([]),
    concurrencyEvidence: z.array(z.string()).default([]),
    failedStrategies: z.array(z.object({ strategy: z.string(), assertion: z.string(), ref: z.string() })).default([]),
    higherThinkingVariant: z.string().optional(),
    thinkingEligible: z.boolean().default(false),
    expertRoute: z.string().optional(),
    expertEligible: z.boolean().default(false),
    explicitlyRequestedRoute: z.boolean().default(false),
    modelPinned: z.boolean().default(false),
    thinkingPinned: z.boolean().default(false),
    rejectedFingerprintMatches: z.boolean().default(false),
    cooldownStepsRemaining: z.number().int().nonnegative().default(0),
    scope: z.enum(["direct", "focused", "coordinated"]).optional(),
  })
  export type Input = z.input<typeof Input>

  export const Result = z.object({
    kind: z.enum(["none", "thinking", "expert"]),
    score: z.number().int().min(0).max(10),
    reasonCodes: z.array(
      z.enum([
        "explicit_user_request",
        "high_risk_change",
        "concurrency_or_persistence",
        "repeated_assertion_failure",
        "complex_analysis",
      ]),
    ),
    evidenceRefs: z.array(z.string()),
    targetVariant: z.string().optional(),
    targetRoute: z.string().optional(),
  })
  export type Result = z.infer<typeof Result>

  export function evaluate(raw: Input): Result {
    const input = Input.parse(raw)
    const reasonCodes: Result["reasonCodes"] = []
    const evidenceRefs = new Set<string>()
    let score = 0
    if (input.explicitlyRequestedRoute) {
      score = 10
      reasonCodes.push("explicit_user_request")
      evidenceRefs.add("user:route-request")
    }
    if (input.highRiskEvidence.length) {
      score += 3
      reasonCodes.push("high_risk_change")
      input.highRiskEvidence.forEach((ref) => evidenceRefs.add(ref))
    }
    if (input.concurrencyEvidence.length) {
      score += 3
      reasonCodes.push("concurrency_or_persistence")
      input.concurrencyEvidence.forEach((ref) => evidenceRefs.add(ref))
    }
    const repeated = input.failedStrategies.find((item, index, all) =>
      all.some(
        (other, otherIndex) =>
          otherIndex !== index && other.assertion === item.assertion && other.strategy !== item.strategy,
      ),
    )
    if (repeated) {
      score += 3
      reasonCodes.push("repeated_assertion_failure")
      input.failedStrategies
        .filter((item) => item.assertion === repeated.assertion)
        .forEach((item) => evidenceRefs.add(item.ref))
    }
    if (input.profile.complexity >= 7 && ["analysis", "design", "review"].includes(input.stage)) {
      score += 1
      reasonCodes.push("complex_analysis")
    }
    score = Math.min(10, score)

    const none = () => ({ kind: "none" as const, score, reasonCodes, evidenceRefs: [...evidenceRefs] })
    if (input.scope === "direct" && !input.explicitlyRequestedRoute) {
      return none()
    }
    if (input.explicitlyRequestedRoute && input.expertRoute && input.expertEligible && !input.modelPinned) {
      return { ...none(), kind: "expert", targetRoute: input.expertRoute }
    }
    if (
      input.routine ||
      evidenceRefs.size === 0 ||
      input.rejectedFingerprintMatches ||
      input.cooldownStepsRemaining > 0
    )
      return none()
    if (input.scope === "focused" && input.failedStrategies.length === 0) {
      if (score >= 4 && input.higherThinkingVariant && input.thinkingEligible && !input.thinkingPinned) {
        return { ...none(), kind: "thinking", targetVariant: input.higherThinkingVariant }
      }
      return none()
    }
    if (score >= 4 && input.higherThinkingVariant && input.thinkingEligible && !input.thinkingPinned) {
      return { ...none(), kind: "thinking", targetVariant: input.higherThinkingVariant }
    }
    if (score >= 6 && input.expertRoute && input.expertEligible && !input.modelPinned) {
      return { ...none(), kind: "expert", targetRoute: input.expertRoute }
    }
    return none()
  }
}
