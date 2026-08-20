import z from "zod"
import type { AgentEval } from "./harness"

export namespace AgentBenchmark {
  export const Case = z.object({
    id: z.string().min(1),
    category: z.enum(["coding", "documentation", "analysis", "general"]),
    prompt: z.string().min(1),
    requiresTools: z.boolean().default(false),
    expectsTests: z.boolean().default(false),
    maxToolErrors: z.number().int().nonnegative().default(0),
    maxRetries: z.number().int().nonnegative().default(1),
    maxDurationMs: z.number().positive().optional(),
  })
  export const Suite = z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      cases: z.array(Case).min(1),
    })
    .superRefine((suite, context) => {
      const seen = new Set<string>()
      for (const [index, testCase] of suite.cases.entries()) {
        if (seen.has(testCase.id)) {
          context.addIssue({
            code: "custom",
            path: ["cases", index, "id"],
            message: `duplicate benchmark case id: ${testCase.id}`,
          })
        }
        seen.add(testCase.id)
      }
    })
  export type Suite = z.infer<typeof Suite>

  export interface Execution {
    id: string
    ok: boolean
    sessionID?: string
    error?: string
  }

  export type Progress =
    | {
        type: "case_started"
        index: number
        total: number
        id: string
        category: z.infer<typeof Case>["category"]
        startedAt: number
      }
    | {
        type: "case_finished"
        index: number
        total: number
        id: string
        ok: boolean
        rateLimited: boolean
        durationMs: number
        sessionID?: string
        error?: string
      }

  export function isRateLimitError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return /rate[ _-]?limit|too many requests|\b429\b|FreeUsageLimitError|resource[_ -]?exhausted|quota\s+(?:exceeded|exhausted)|insufficient\s+quota|usage\s+limit/i.test(
      message,
    )
  }

  export function bucket(suite: Suite) {
    const label = `${suite.name}-${suite.version}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 80)
    const digest = new Bun.CryptoHasher("sha1").update(`${suite.name}\n${suite.version}`).digest("hex").slice(0, 12)
    return `benchmark-${label}-${digest}`
  }

  /** Execute every case sequentially so workspace mutations remain deterministic. */
  export async function run(
    suite: Suite,
    execute: (testCase: z.infer<typeof Case>) => Promise<{ sessionID?: string } | void>,
    collect: () => Promise<AgentEval.Result[]>,
    onProgress?: (event: Progress) => void,
  ) {
    const executions: Execution[] = []
    const emit = (event: Progress) => {
      try {
        onProgress?.(event)
      } catch {
        // Progress is presentation-only and must never affect benchmark results.
      }
    }
    for (const [offset, testCase] of suite.cases.entries()) {
      const index = offset + 1
      const startedAt = Date.now()
      emit({
        type: "case_started",
        index,
        total: suite.cases.length,
        id: testCase.id,
        category: testCase.category,
        startedAt,
      })
      try {
        const result = await execute(testCase)
        const execution = { id: testCase.id, ok: true, sessionID: result ? result.sessionID : undefined }
        executions.push(execution)
        emit({
          type: "case_finished",
          index,
          total: suite.cases.length,
          id: testCase.id,
          ok: true,
          rateLimited: false,
          durationMs: Date.now() - startedAt,
          sessionID: execution.sessionID,
        })
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1_000)
        const rateLimited = isRateLimitError(error)
        executions.push({
          id: testCase.id,
          ok: false,
          error: message,
        })
        emit({
          type: "case_finished",
          index,
          total: suite.cases.length,
          id: testCase.id,
          ok: false,
          rateLimited,
          durationMs: Date.now() - startedAt,
          error: message,
        })
        // A provider-wide limit will make every remaining case fail while consuming
        // retries. Leave untouched cases unobserved and end this run immediately.
        if (rateLimited) break
      }
    }
    return { executions, ...evaluate(suite, await collect()) }
  }

  export function evaluate(suite: Suite, results: AgentEval.Result[]) {
    const cases = suite.cases.map((testCase) => {
      const matches = results.filter((result) => result.id === testCase.id)
      const latest = matches.sort((a, b) => b.timestamp - a.timestamp)[0]
      const failures: string[] = []
      if (!latest) failures.push("missing observation")
      else {
        if (!latest.success) failures.push("task was not successful")
        if (testCase.requiresTools && latest.toolCalls === 0) failures.push("expected tool usage")
        if (testCase.expectsTests && latest.testsPassed !== true) failures.push("tests did not pass")
        if (latest.toolErrors > testCase.maxToolErrors)
          failures.push(`tool errors ${latest.toolErrors} > ${testCase.maxToolErrors}`)
        if (latest.retries > testCase.maxRetries) failures.push(`retries ${latest.retries} > ${testCase.maxRetries}`)
        if (testCase.maxDurationMs && latest.durationMs > testCase.maxDurationMs)
          failures.push(`duration ${latest.durationMs}ms > ${testCase.maxDurationMs}ms`)
      }
      return { id: testCase.id, passed: failures.length === 0, failures, observation: latest }
    })
    const observed = cases.filter((item) => !!item.observation).length
    const passed = cases.filter((item) => item.passed).length
    return {
      suite: suite.name,
      version: suite.version,
      total: cases.length,
      observed,
      passed,
      passRate: cases.length ? passed / cases.length : 0,
      ready: observed === cases.length,
      cases,
    }
  }
}
