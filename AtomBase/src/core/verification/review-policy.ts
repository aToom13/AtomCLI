export namespace ReviewPolicy {
  export const MAX_REVIEW_TOOL_CALLS = 30
  export const MAX_REVIEW_STEPS = 12
  export const REVIEW_TIMEOUT_MS = 180_000
  type Impact = import("./change-impact").ChangeImpact.Report
  type ConfigReview = import("@/core/config/config").Config.Info["review"]
  export type Risk = "low" | "medium" | "high"
  export type Mode = "adaptive" | "always" | "off" | "fast" | "advisory" | "enforced"
  export type Snapshot = {
    policyVersion: 2
    auto: boolean
    enabled: boolean
    configuredPolicy: Exclude<Mode, "fast">
    effectivePolicy: Mode
    executionProfile: string
    reviewerCount: number
    attemptLimit: number
    highRiskPatterns: string[]
    policyDigest: string
  }
  export interface Input {
    editedFiles?: string[]
    prompt?: string
    retries?: number
    testsFailed?: boolean
    extraHighRiskPatterns?: string[]
    diff?: string
    impact?: Impact
    scope?: "direct" | "focused" | "coordinated"
    risk?: "low" | "elevated" | "critical"
  }

  const HIGH_RISK = [
    /(^|\/)auth/i,
    /security/i,
    /permission/i,
    /(^|\/)server\/routes\//i,
    /migration/i,
    /schema/i,
    /package\.json(?:$|\n)/i,
    /bun\.lock/i,
    /release/i,
    /\.github\/workflows/i,
  ]

  const FAST_PROFILE_HIGH_RISK = [
    /(^|\/)auth/i,
    /security/i,
    /permission/i,
    /credential/i,
    /secret/i,
    /(^|\/)server\/routes\//i,
    /migration/i,
    /schema/i,
    /release/i,
    /\.github\/workflows/i,
    /installer/i,
  ]

  function customPatterns(extra: string[] | undefined) {
    return (extra ?? []).flatMap((value) => {
      try {
        return [new RegExp(value, "i")]
      } catch {
        return []
      }
    })
  }

  export function assess(input: Input): Risk {
    if (input.risk === "critical") return "high"
    if (input.risk === "elevated" && input.scope === "coordinated") return "high"
    const files = input.editedFiles ?? []
    if (files.length === 0) return "low"
    if (input.testsFailed || (input.retries ?? 0) >= 2 || input.impact?.level === "high") return "high"
    const custom = customPatterns(input.extraHighRiskPatterns)
    const text = `${files.join("\n")}\n${input.prompt ?? ""}`
    if ([...HIGH_RISK, ...custom].some((pattern) => pattern.test(text))) return "high"
    if (/^-\s*(?:if|throw|return).*?(?:auth|permission|validate|sanitize|check)/im.test(input.diff ?? "")) return "high"
    return "medium"
  }

  export function snapshot(input: {
    auto?: boolean
    enabled: boolean
    configuredPolicy: Exclude<Mode, "fast">
    executionProfile?: string
    reviewerCount: number
    attemptLimit: number
    highRiskPatterns: string[]
  }): Snapshot {
    const executionProfile = input.executionProfile ?? "default"
    const effectivePolicy: Mode = !input.enabled
      ? "off"
      : input.configuredPolicy === "adaptive" && executionProfile === "companion-fast"
        ? "fast"
        : input.configuredPolicy
    const value = {
      policyVersion: 2 as const,
      auto: input.auto === true,
      enabled: input.enabled,
      configuredPolicy: input.configuredPolicy,
      effectivePolicy,
      executionProfile,
      reviewerCount: input.reviewerCount,
      attemptLimit: input.attemptLimit,
      highRiskPatterns: [...input.highRiskPatterns],
    }
    return {
      ...value,
      policyDigest: new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex"),
    }
  }

  /**
   * Single source of truth for turning a resolved `review` config block into a
   * policy snapshot.
   *
   * The review gate produces the completion's `reviewDecision`, and the
   * execution runtime independently re-derives the digest and rejects the
   * completion with `stale_policy` when the two disagree. Both sides must build
   * the snapshot here: a divergent fallback default makes every root-session
   * completion fail.
   *
   * `review` is an optional config object, so when the block is absent Zod never
   * applies the field defaults and the fallbacks below become the effective
   * configuration. They must mirror the schema in `config.ts`.
   */
  export function snapshotFromConfig(input: { review?: Partial<ConfigReview>; executionProfile?: string }): Snapshot {
    return snapshot({
      auto: input.review?.auto === true,
      enabled: input.review?.enabled !== false,
      configuredPolicy: input.review?.policy ?? "adaptive",
      executionProfile: input.executionProfile,
      reviewerCount: input.review?.reviewer_count ?? 1,
      attemptLimit: input.review?.max_attempts ?? 3,
      highRiskPatterns: input.review?.high_risk_patterns ?? [],
    })
  }

  export function requiresIndependentReview(policy: Mode, input: Input) {
    if (policy === "off" || policy === "advisory") return false
    if ((input.editedFiles?.length ?? 0) === 0) return false
    if (input.risk === "critical") return true
    if (input.risk === "elevated" && input.scope === "coordinated") return true
    if (policy === "always") return true
    if (policy === "enforced") return assess(input) === "high"
    if (policy === "fast") {
      if ((input.editedFiles?.length ?? 0) === 0) return false
      if (input.testsFailed || (input.retries ?? 0) >= 2) return true
      const text = `${(input.editedFiles ?? []).join("\n")}\n${input.prompt ?? ""}`
      // Configured high-risk patterns apply in every mode; a user who marks a
      // path as high risk must not have it silently dropped by the fast profile.
      return [...FAST_PROFILE_HIGH_RISK, ...customPatterns(input.extraHighRiskPatterns)].some((pattern) =>
        pattern.test(text),
      )
    }
    return assess(input) === "high"
  }
}
