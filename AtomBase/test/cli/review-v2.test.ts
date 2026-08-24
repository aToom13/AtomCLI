import "../preload"
import { describe, expect, test } from "bun:test"
import { CodeReview } from "@/interfaces/cli/cmd/review"

const DIFF = [
  "diff --git a/src/example.ts b/src/example.ts",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1,1 +1,2 @@",
  " export const stable = true",
  "+export const unsafe = input[0]",
].join("\n")

describe("CodeReview Review V2", () => {
  test("runs reviewers in parallel and deduplicates their validated findings", async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const result = await CodeReview.reviewDiff({
      diff: DIFF,
      pr: 42,
      provider: "github",
      reviewerCount: 2,
      execute: async (_assignment, index) => {
        calls++
        active++
        peak = Math.max(peak, active)
        await Bun.sleep(10)
        active--
        return {
          reviewer: `reviewer-${index + 1}`,
          output: {
            verdict: "rejected",
            summary: "Unchecked input found.",
            findings: [
              {
                file: "src/example.ts",
                startLine: 2,
                endLine: 2,
                severity: index === 0 ? "P2" : "P1",
                confidence: index === 0 ? 0.8 : 0.95,
                title: index === 0 ? "Unchecked input" : "Unchecked array input",
                evidence: "export const unsafe = input[0]",
                recommendation: "Validate input before indexing.",
              },
            ],
          },
        }
      },
    })

    expect(calls).toBe(2)
    expect(peak).toBe(2)
    expect(result.verdict).toBe("rejected")
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].severity).toBe("P1")
    expect(result.comments[0].reviewers).toHaveLength(2)
    expect(result.stats).toEqual({ total: 1, p0: 0, p1: 1, p2: 0, p3: 0, invalid: 0 })
  })

  test("reports failed or invalid reviewer output as inconclusive", async () => {
    const result = await CodeReview.reviewDiff({
      diff: DIFF,
      pr: 7,
      provider: "gitlab",
      reviewerCount: 2,
      execute: async (_assignment, index) =>
        index === 0
          ? { reviewer: "failed", error: "provider unavailable" }
          : { reviewer: "invalid", output: { verdict: "passed", summary: "missing findings" } },
    })

    expect(result.verdict).toBe("inconclusive")
    expect(result.comments).toHaveLength(0)
    expect(result.stats.invalid).toBe(1)
    expect(result.reviewers.every((reviewer) => reviewer.error)).toBe(true)
  })
})
