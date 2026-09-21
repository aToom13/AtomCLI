import z from "zod"

export namespace ExecutionCheckpoint {
  export const Decision = z.enum(["continue", "finish", "blocked"])
  export type Decision = z.infer<typeof Decision>

  export const Result = z
    .object({
      decision: Decision,
      // Harness clamps valid positive requests to MAX_SLICE_CALLS.
      requestedCalls: z.number().int().positive().optional(),
      finalResponse: z.string().max(50_000).optional(),
      objectiveAssessment: z.string().max(2000),
      progressSummary: z.string().max(2000),
      discoveries: z.string().array().max(100),
      completedWork: z.string().array().max(100),
      remainingWork: z.string().array().max(100),
      failures: z.string().array().max(100),
      blockers: z.string().array().max(100),
      routeAssessment: z.string().max(2000),
      planChanged: z.boolean(),
      routeChanged: z.boolean(),
      estimatedRemainingCalls: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      nextActions: z.string().array().max(100),
    })
    .superRefine((result, context) => {
      if (result.decision === "continue" && result.requestedCalls === undefined) {
        context.addIssue({ code: "custom", path: ["requestedCalls"], message: "Continue requires requestedCalls" })
      }
      if (result.decision === "finish" && !result.finalResponse?.trim()) {
        context.addIssue({ code: "custom", path: ["finalResponse"], message: "Finish requires finalResponse" })
      }
    })
  export type Result = z.infer<typeof Result>

  export const MAX_SLICE_CALLS = 50
  export const MIN_CHECKPOINT_CALLS = 10
  export const MAX_INVALID_RESPONSES = 3
  export const MAX_EXTENSIONS = 6
  export const MAX_NO_PROGRESS_SLICES = 2
  export const MAX_REASONING_CANDIDATE_CHARS = 50_000
  export const MAX_REASONING_CANDIDATES = 8

  export function normalizeCandidate(input: unknown): unknown {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input
    const obj = input as Record<string, unknown>
    const wrapperKey = ["checkpoint", "execution_checkpoint"].find(
      (k) => k in obj && typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k]),
    )
    const candidate = (wrapperKey ? obj[wrapperKey] : obj) as Record<string, unknown>
    if (!Decision.safeParse(candidate.decision).success) return candidate

    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 100) : []
    const integer = (value: unknown, fallback: number) => {
      const parsed = typeof value === "string" && value.trim() ? Number(value) : value
      return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
    }
    const decision = candidate.decision as Decision
    const estimatedRemainingCalls = integer(
      candidate.estimatedRemainingCalls,
      decision === "finish" ? 0 : MIN_CHECKPOINT_CALLS,
    )
    const requestedCalls = integer(candidate.requestedCalls, Math.max(MIN_CHECKPOINT_CALLS, estimatedRemainingCalls))
    return {
      ...candidate,
      decision,
      requestedCalls: decision === "continue" ? Math.max(1, requestedCalls) : undefined,
      finalResponse:
        decision === "finish"
          ? typeof candidate.finalResponse === "string"
            ? candidate.finalResponse
            : typeof candidate.final_response === "string"
              ? candidate.final_response
              : undefined
          : undefined,
      objectiveAssessment:
        typeof candidate.objectiveAssessment === "string"
          ? candidate.objectiveAssessment
          : "Objective remains unchanged.",
      progressSummary:
        typeof candidate.progressSummary === "string" ? candidate.progressSummary : "No summary provided.",
      discoveries: strings(candidate.discoveries),
      completedWork: strings(candidate.completedWork),
      remainingWork: strings(candidate.remainingWork),
      failures: strings(candidate.failures),
      blockers: strings(candidate.blockers),
      routeAssessment:
        typeof candidate.routeAssessment === "string" ? candidate.routeAssessment : "Keep the current route.",
      planChanged: candidate.planChanged === true,
      routeChanged: candidate.routeChanged === true,
      estimatedRemainingCalls,
      nextActions: strings(candidate.nextActions),
    }
  }

  export function conservativeContinue(objective?: string): Result {
    const remaining = objective?.trim() || "Complete the root user objective using verified evidence."
    return {
      decision: "continue",
      requestedCalls: MIN_CHECKPOINT_CALLS,
      objectiveAssessment:
        "The root objective remains active; malformed checkpoint responses provide no completion evidence.",
      progressSummary:
        "Checkpoint state could not be decoded after repeated attempts, so execution will continue conservatively.",
      discoveries: [],
      completedWork: [],
      remainingWork: [remaining],
      failures: ["Three checkpoint responses failed structured validation."],
      blockers: [],
      routeAssessment: "Keep the current route until durable evidence justifies a change.",
      planChanged: false,
      routeChanged: false,
      estimatedRemainingCalls: MIN_CHECKPOINT_CALLS,
      nextActions: ["Reconcile current durable state, perform the next verified action, and checkpoint again."],
    }
  }
}
