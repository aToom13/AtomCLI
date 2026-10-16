import "../preload"
import { describe, expect, test } from "bun:test"
import { ReviewV2 } from "@/core/verification/review-v2"
import { tmpdir } from "../fixture/fixture"
import { SubAgentRuntime } from "@/integrations/tool/subagent-runtime"

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
  test("HUD-only completion misses upfront 3D acceptance; changed requests invalidate review hashes", () => {
    const request = "Build a functional 3D browser game with camera and collision"
    const calls = [
      { tool: "browser" as const, input: { action: "click", selector: "#collect" }, output: "Clicked Collect" },
      { tool: "browser" as const, input: { action: "evaluate", script: "score" }, output: "score: 1" },
    ]
    const result = ReviewV2.aggregate({
      sources: new Map(),
      allowedFiles: ["index.html"],
      acceptance: { request, startedAt: 10 },
      results: [
        {
          reviewer: "qa",
          messages: [
            {
              parts: calls.map((call) => ({
                type: "tool",
                tool: call.tool,
                state: { status: "completed", ...call, metadata: {}, time: { start: 20, end: 21 } },
              })),
            },
          ] as any,
          output: {
            verdict: "passed",
            summary: "Score increased",
            findings: [],
            checks: [
              {
                criterion: request,
                setup: "Game open",
                action: "Click Collect",
                expected: "Score increases",
                observed: "score: 1",
                evidence: calls.map((call) => ({ ...call, input: JSON.stringify(call.input) })),
              },
            ],
          },
        },
      ],
    })
    expect(result.verdict).toBe("inconclusive")
    expect(result.rejectedChecks?.some((check) => check.criterion?.includes("projection"))).toBe(true)
    expect(result.rejectedChecks?.some((check) => check.criterion?.includes("Collision"))).toBe(true)
    expect(ReviewV2.acceptanceRequestHash(request)).not.toBe(
      ReviewV2.acceptanceRequestHash(`${request}; WebGL required`),
    )
  })
  test("native reviewer runtime accepts generated schema without dropping long criteria", () => {
    expect(SubAgentRuntime.parseSchema(ReviewV2.OutputSchema)).toEqual(ReviewV2.OutputSchema)
    const request = "x".repeat(10_000) + "y".repeat(10_000) + "z".repeat(5_001)
    expect(ReviewV2.acceptanceCriteria(request).join("")).toBe(request)
    expect(ReviewV2.acceptanceCriteria(request).every((criterion) => criterion.length <= 10_000)).toBe(true)
  })
  test("browser PASS needs current independent behavior evidence covering full request and listed criteria", () => {
    const request = "Two games must respond to input.\n- Game one responds to controls\n- Game two responds to controls"
    const criteria = ReviewV2.acceptanceCriteria(request)
    expect(criteria).toEqual([request, "Game one responds to controls", "Game two responds to controls"])
    const calls = [
      {
        tool: "browser",
        input: { action: "press", selector: "#one", key: "ArrowRight" },
        output: "Pressed ArrowRight for #one",
      },
      {
        tool: "browser",
        input: { action: "evaluate", script: "JSON.stringify(games.one.position)" },
        output: '{"x":4,"y":0,"z":1}',
      },
      {
        tool: "browser",
        input: { action: "press", selector: "#two", key: "ArrowRight" },
        output: "Pressed ArrowRight for #two",
      },
      {
        tool: "browser",
        input: { action: "evaluate", script: "JSON.stringify(games.two.position)" },
        output: '{"x":8,"y":0,"z":2}',
      },
    ]
    const evidence = calls.map((call) => ({
      ...call,
      input: JSON.stringify(call.input),
    })) as ReviewV2.AcceptanceCheck["evidence"]
    const checks = criteria.map(
      (criterion, index): ReviewV2.AcceptanceCheck => ({
        criterion,
        setup: "Open the requested game with its initial position",
        action: "Press ArrowRight",
        expected: "Game world position changes",
        observed: calls[index === 1 ? 1 : 3].output,
        evidence: index === 0 ? evidence : evidence.slice(index === 1 ? 0 : 2, index === 1 ? 2 : 4),
      }),
    )
    const messages = [
      {
        parts: calls.map((call, index) => ({
          type: "tool",
          tool: call.tool,
          state: {
            status: "completed",
            input: call.input,
            output: call.output,
            metadata: {},
            time: { start: 20 + index * 2, end: 21 + index * 2 },
          },
        })),
      },
    ] as never
    const review = (changed: Partial<ReviewV2.ReviewerResult> = {}, changedChecks: unknown = checks, startedAt = 10) =>
      ReviewV2.aggregate({
        sources: new Map(),
        allowedFiles: ["index.html"],
        acceptance: { request, startedAt },
        results: [
          {
            reviewer: "independent",
            messages,
            output: { verdict: "passed", summary: "Verified", findings: [], checks: changedChecks },
            ...changed,
          },
        ],
      })
    expect(review().verdict).toBe("passed")
    expect(review().checks).toHaveLength(3)
    expect(review({}, []).verdict).toBe("inconclusive")
    const partial = review({}, checks.slice(0, 2))
    expect(partial.verdict).toBe("inconclusive")
    expect(partial.rejectedChecks?.some((item) => item.criterion === criteria[2])).toBe(true)
    expect(review({ messages: [] }).verdict).toBe("inconclusive")
    expect(review({}, checks, 100).verdict).toBe("inconclusive")
    expect(
      review(
        {},
        checks.map((check) => ({ ...check, observed: "Invented movement" })),
      ).verdict,
    ).toBe("inconclusive")
    expect(
      review(
        {},
        checks.map((check) => ({ ...check, criterion: "Other game" })),
      ).verdict,
    ).toBe("inconclusive")
    expect(
      review(
        {},
        checks.map((check) => ({
          ...check,
          evidence: check.evidence.map((item) => ({ ...item, input: '{"action":"evaluate","script":"fabricated"}' })),
        })),
      ).verdict,
    ).toBe("inconclusive")
    expect(
      review({
        messages: [
          {
            parts: calls.map((call) => ({
              type: "tool",
              tool: call.tool,
              state: {
                status: "completed",
                input: call.input,
                output: call.output,
                metadata: { error: "Unavailable" },
                time: { start: 20, end: 21 },
              },
            })),
          },
        ] as never,
      }).verdict,
    ).toBe("inconclusive")
  })

  test.each(["rg game index.html", "bun run build", "echo 'bun test'", "bun test --help", "bun test || echo passed"])(
    "structural or disguised command cannot prove browser behavior: %s",
    (command) => {
      const input = { command, description: "Verify" }
      const check: ReviewV2.AcceptanceCheck = {
        criterion: "Two playable games",
        setup: "Project",
        action: "Run check",
        expected: "Game works",
        observed: "Game works",
        evidence: [{ tool: "bash", input: JSON.stringify(input), output: "Game works" }],
      }
      const report = ReviewV2.aggregate({
        sources: new Map(),
        allowedFiles: ["index.html"],
        acceptance: { request: check.criterion, startedAt: 10 },
        results: [
          {
            reviewer: "QA",
            output: {
              verdict: "passed",
              summary: "Verified",
              findings: [],
              checks: [check],
            },
            messages: [
              {
                parts: [
                  {
                    type: "tool",
                    tool: "bash",
                    state: {
                      status: "completed",
                      input,
                      output: "Game works",
                      metadata: { exit: 0 },
                      time: { start: 20, end: 21 },
                    },
                  },
                ],
              },
            ] as never,
          },
        ],
      })
      expect(report.verdict).toBe("inconclusive")
      expect(report.rejectedChecks?.[0].reason).toContain("behavior requires")
    },
  )

  test("successful direct test run can substantiate a criterion; failed run cannot", () => {
    const input = {
      command: "MODELS_DEV_API_JSON=test/fixtures.json bun test test/game.test.ts",
      description: "Verify movement",
    }
    const check: ReviewV2.AcceptanceCheck = {
      criterion: "Game movement",
      setup: "Initial world position",
      action: "Run movement regression",
      expected: "Position becomes 4",
      observed: "position=4",
      evidence: [{ tool: "bash", input: JSON.stringify(input), output: "position=4" }],
    }
    const report = (exit: number) =>
      ReviewV2.aggregate({
        sources: new Map(),
        allowedFiles: ["game.html"],
        acceptance: { request: check.criterion, startedAt: 10 },
        results: [
          {
            reviewer: "QA",
            output: {
              verdict: "passed",
              summary: "Verified",
              findings: [],
              checks: [check],
            },
            messages: [
              {
                parts: [
                  {
                    type: "tool",
                    tool: "bash",
                    state: {
                      status: "completed",
                      input,
                      output: "position=4",
                      metadata: { exit },
                      time: { start: 20, end: 21 },
                    },
                  },
                ],
              },
            ] as never,
          },
        ],
      })
    expect(report(0).verdict).toBe("passed")
    expect(report(1).verdict).toBe("inconclusive")
  })
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
