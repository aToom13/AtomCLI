export namespace RepairPlanner {
  export type Kind =
    | "permission"
    | "rate_limit"
    | "timeout"
    | "schema"
    | "not_found"
    | "test_failure"
    | "dependency"
    | "transient"
    | "unknown"

  export interface Advice {
    kind: Kind
    retryable: boolean
    strategy: string
  }

  export function classify(error: unknown, tool = ""): Advice {
    const message = String(error instanceof Error ? error.message : (error ?? "")).toLowerCase()
    if (/permission|denied|not allowed|rejected/.test(message))
      return {
        kind: "permission",
        retryable: false,
        strategy: "Do not repeat the call. Explain the required permission or choose a permitted read-only path.",
      }
    if (/429|rate.?limit|too many requests|quota/.test(message))
      return {
        kind: "rate_limit",
        retryable: true,
        strategy: "Respect retry-after when present; otherwise switch to a healthy fallback model/provider.",
      }
    if (/timeout|timed out|deadline/.test(message))
      return {
        kind: "timeout",
        retryable: true,
        strategy: "Split the operation into smaller bounded steps and preserve completed state before retrying.",
      }
    if (/invalid.*(input|argument|schema)|validation|expected.*received|json/.test(message))
      return {
        kind: "schema",
        retryable: true,
        strategy: `Re-read the ${tool || "tool"} schema and repair only the invalid arguments before retrying.`,
      }
    if (/module not found|missing dependency|command not found|executable.*not found/.test(message))
      return {
        kind: "dependency",
        retryable: true,
        strategy:
          "Inspect the project manifest and documented setup; use the repository package manager to restore the missing dependency.",
      }
    if (/not found|no such file|cannot find|does not exist/.test(message))
      return {
        kind: "not_found",
        retryable: true,
        strategy:
          "Refresh the relevant file/resource list, resolve the exact target, then retry with verified identifiers.",
      }
    if (/test.*fail|assertion|expected.*actual|exit code [1-9]/.test(message))
      return {
        kind: "test_failure",
        retryable: true,
        strategy:
          "Inspect the first actionable failure and the related diff; fix the cause before running the narrowest relevant test again.",
      }
    if (/econnreset|econnrefused|network|temporar|503|502/.test(message))
      return {
        kind: "transient",
        retryable: true,
        strategy:
          "Retry once with backoff; if it repeats, use an alternate healthy endpoint or report the external blocker.",
      }
    return {
      kind: "unknown",
      retryable: false,
      strategy: "Gather new evidence and change strategy; never repeat the identical failed call blindly.",
    }
  }

  export function annotate(error: unknown, tool = "") {
    const message = String(error instanceof Error ? error.message : (error ?? ""))
    const advice = classify(error, tool)
    return `${message}\n\n[repair:${advice.kind}] ${advice.strategy}`
  }
}
