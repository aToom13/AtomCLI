export namespace ReviewPolicy {
  type Impact = import("./change-impact").ChangeImpact.Report
  export type Risk = "low" | "medium" | "high"
  export type Mode = "adaptive" | "always" | "off" | "fast"
  export type Snapshot = {
    policyVersion: 1
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
    /package\.json$/i,
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

  export function assess(input: Input): Risk {
    if (input.risk === "critical") return "high"
    if (input.risk === "elevated" && input.scope === "coordinated") return "high"
    const files = input.editedFiles ?? []
    if (files.length === 0) return "low"
    if (input.testsFailed || (input.retries ?? 0) >= 2 || input.impact?.level === "high") return "high"
    const custom = (input.extraHighRiskPatterns ?? []).flatMap((value) => {
      try {
        return [new RegExp(value, "i")]
      } catch {
        return []
      }
    })
    const text = `${files.join("\n")}\n${input.prompt ?? ""}`
    if ([...HIGH_RISK, ...custom].some((pattern) => pattern.test(text))) return "high"
    if (/^-\s*(?:if|throw|return).*?(?:auth|permission|validate|sanitize|check)/im.test(input.diff ?? "")) return "high"
    return "medium"
  }

  export function snapshot(input: {
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
      policyVersion: 1 as const,
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

  export function requiresIndependentReview(policy: Mode, input: Input) {
    if (policy === "off") return false
    if ((input.editedFiles?.length ?? 0) === 0) return false
    if (input.risk === "critical") return true
    if (input.risk === "elevated" && input.scope === "coordinated") return true
    if (policy === "always") return true
    if (policy === "fast") {
      if ((input.editedFiles?.length ?? 0) === 0) return false
      if (input.testsFailed || (input.retries ?? 0) >= 2) return true
      const text = `${(input.editedFiles ?? []).join("\n")}\n${input.prompt ?? ""}`
      return FAST_PROFILE_HIGH_RISK.some((pattern) => pattern.test(text))
    }
    return assess(input) === "high"
  }
}
