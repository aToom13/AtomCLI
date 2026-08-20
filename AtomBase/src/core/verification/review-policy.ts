export namespace ReviewPolicy {
  export type Risk = "low" | "medium" | "high"
  export interface Input {
    editedFiles?: string[]
    prompt?: string
    retries?: number
    testsFailed?: boolean
    extraHighRiskPatterns?: string[]
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

  export function assess(input: Input): Risk {
    const files = input.editedFiles ?? []
    if (files.length === 0) return "low"
    if (input.testsFailed || (input.retries ?? 0) >= 2) return "high"
    const custom = (input.extraHighRiskPatterns ?? []).flatMap((value) => {
      try { return [new RegExp(value, "i")] } catch { return [] }
    })
    const text = `${files.join("\n")}\n${input.prompt ?? ""}`
    if ([...HIGH_RISK, ...custom].some((pattern) => pattern.test(text))) return "high"
    return "medium"
  }

  export function requiresIndependentReview(policy: "adaptive" | "always" | "off", input: Input) {
    if (policy === "off") return false
    if (policy === "always") return (input.editedFiles?.length ?? 0) > 0
    return assess(input) === "high"
  }
}
