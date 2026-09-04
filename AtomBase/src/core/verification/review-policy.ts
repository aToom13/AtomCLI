export namespace ReviewPolicy {
  type Impact = import("./change-impact").ChangeImpact.Report
  export type Risk = "low" | "medium" | "high"
  export interface Input {
    editedFiles?: string[]
    prompt?: string
    retries?: number
    testsFailed?: boolean
    extraHighRiskPatterns?: string[]
    diff?: string
    impact?: Impact
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

  export function requiresIndependentReview(policy: "adaptive" | "always" | "off" | "fast", input: Input) {
    if (policy === "off") return false
    if (policy === "always") return (input.editedFiles?.length ?? 0) > 0
    if (policy === "fast") {
      if ((input.editedFiles?.length ?? 0) === 0) return false
      if (input.testsFailed || (input.retries ?? 0) >= 2) return true
      const text = `${(input.editedFiles ?? []).join("\n")}\n${input.prompt ?? ""}`
      return FAST_PROFILE_HIGH_RISK.some((pattern) => pattern.test(text))
    }
    return assess(input) === "high"
  }
}
