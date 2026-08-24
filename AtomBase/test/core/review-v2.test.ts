import "../preload"
import { describe, expect, test } from "bun:test"
import { ReviewV2 } from "@/core/verification/review-v2"
import { tmpdir } from "../fixture/fixture"

const finding = (overrides: Partial<ReviewV2.Finding> = {}): ReviewV2.Finding => ({
  file: "src/example.ts",
  startLine: 2,
  endLine: 2,
  severity: "P1",
  confidence: 0.91,
  title: "Unchecked empty input",
  evidence: "return input[0]",
  recommendation: "Guard empty input before indexing.",
  ...overrides,
})

const output = (findings: ReviewV2.Finding[], verdict: ReviewV2.ReviewerOutput["verdict"] = "rejected") => ({
  verdict,
  summary: findings.length ? "Validated defects found." : "No defects found.",
  findings,
})

describe("ReviewV2", () => {
  test("validates findings against real file content and rejects forged paths, ranges, and evidence", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(`${dir}/example.ts`, "export function first(input: string[]) {\n  return input[0]\n}\n")
      },
    })
    const sources = await ReviewV2.loadWorkspaceSources(tmp.path, ["example.ts"])
    const report = ReviewV2.aggregate({
      sources,
      allowedFiles: ["example.ts"],
      results: [
        {
          reviewer: "correctness",
          output: output([
            finding({ file: "example.ts", evidence: "return input[0]" }),
            finding({ file: "../secret.ts" }),
            finding({ file: "example.ts", startLine: 99, endLine: 99 }),
            finding({ file: "example.ts", evidence: "eval(input)" }),
          ]),
        },
      ],
    })

    expect(report.verdict).toBe("rejected")
    expect(report.findings).toHaveLength(1)
    expect(report.rejectedFindings).toHaveLength(3)
    expect(report.rejectedFindings.map((item) => item.reason).join(" ")).toContain("outside the review scope")
    expect(report.rejectedFindings.map((item) => item.reason).join(" ")).toContain("file length")
    expect(report.rejectedFindings.map((item) => item.reason).join(" ")).toContain("does not match")
  })

  test("deduplicates overlapping findings and keeps strongest severity and confidence", () => {
    const sources = new Map<string, ReviewV2.SourceFile>([
      ["src/example.ts", { path: "src/example.ts", lineCount: 2, lines: new Map([[2, "return input[0]"]]) }],
    ])
    const report = ReviewV2.aggregate({
      sources,
      allowedFiles: ["src/example.ts"],
      results: [
        { reviewer: "correctness", output: output([finding({ severity: "P2", confidence: 0.7 })]) },
        {
          reviewer: "security",
          output: output([finding({ severity: "P1", confidence: 0.95, title: "Unchecked empty array input" })]),
        },
      ],
    })

    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].severity).toBe("P1")
    expect(report.findings[0].confidence).toBe(0.95)
    expect(report.findings[0].reviewers).toEqual(["correctness", "security"])
  })

  test("rejects findings outside changed diff ranges", () => {
    const diff = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,2 +1,2 @@",
      " export const stable = true",
      "+return input[0]",
    ].join("\n")
    const sources = ReviewV2.parseUnifiedDiff(diff)
    const report = ReviewV2.aggregate({
      sources,
      allowedFiles: ["src/example.ts"],
      results: [
        {
          reviewer: "diff",
          output: output([
            finding({ startLine: 1, endLine: 1, evidence: "export const stable = true" }),
            finding({ startLine: 2, endLine: 2, evidence: "return input[0]" }),
          ]),
        },
      ],
    })

    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].startLine).toBe(2)
    expect(report.rejectedFindings[0].reason).toContain("changed line")
  })

  test("chunks oversized diffs without dropping content", () => {
    const lines = Array.from({ length: 900 }, (_, index) => `+const value${index} = ${index}`)
    const diff = [
      "diff --git a/src/large.ts b/src/large.ts",
      "--- a/src/large.ts",
      "+++ b/src/large.ts",
      "@@ -0,0 +1,900 @@",
      ...lines,
    ].join("\n")
    const chunks = ReviewV2.chunkUnifiedDiff(diff)

    expect(chunks.length).toBeGreaterThan(1)
    const joined = chunks.map((chunk) => chunk.content).join("\n")
    expect(joined).toContain("const value0 = 0")
    expect(joined).toContain("const value899 = 899")
    expect(chunks.every((chunk) => Buffer.byteLength(chunk.content) <= 25_000)).toBe(true)
    expect(chunks.slice(1).every((chunk) => chunk.content.includes("@@ -0,0 +"))).toBe(true)
  })

  test("returns inconclusive when a rejected verdict has no validated finding", () => {
    const report = ReviewV2.aggregate({
      sources: new Map(),
      allowedFiles: ["src/example.ts"],
      results: [{ reviewer: "reviewer", output: output([finding({ evidence: "fabricated" })]) }],
    })
    expect(report.verdict).toBe("inconclusive")
    expect(report.findings).toHaveLength(0)
    expect(report.rejectedFindings).toHaveLength(1)
  })
})
