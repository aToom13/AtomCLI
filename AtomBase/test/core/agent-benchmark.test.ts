import { describe, expect, test } from "bun:test"
import { AgentBenchmark } from "@/core/eval/benchmark"
import { AgentEval } from "@/core/eval/harness"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("AgentBenchmark", () => {
  test("rejects duplicate case IDs that would alias observations", () => {
    expect(() =>
      AgentBenchmark.Suite.parse({
        name: "duplicate-cases",
        version: "1",
        cases: [
          { id: "same", category: "analysis", prompt: "first" },
          { id: "same", category: "coding", prompt: "second" },
        ],
      }),
    ).toThrow("duplicate benchmark case id")
  })

  test("checks observable task requirements", () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "smoke",
      version: "1",
      cases: [{ id: "fix", category: "coding", prompt: "fix", requiresTools: true, expectsTests: true }],
    })
    const result = AgentEval.score(
      AgentEval.Observation.parse({
        id: "fix",
        category: "coding",
        providerID: "p",
        modelID: "m",
        completed: true,
        toolCalls: 2,
        testsPassed: true,
        reviewerVerdict: "passed",
      }),
    )
    expect(AgentBenchmark.evaluate(suite, [result])).toMatchObject({ ready: true, passed: 1, passRate: 1 })
  })

  test("executes every case before collecting observations", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "smoke",
      version: "1",
      cases: [
        { id: "one", category: "analysis", prompt: "inspect one" },
        { id: "two", category: "analysis", prompt: "inspect two" },
      ],
    })
    const executed: string[] = []
    const progress: AgentBenchmark.Progress[] = []
    const results = suite.cases.map((item) =>
      AgentEval.score(
        AgentEval.Observation.parse({
          id: item.id,
          suite: "benchmark",
          category: item.category,
          providerID: "p",
          modelID: "m",
          completed: true,
        }),
      ),
    )
    const report = await AgentBenchmark.run(
      suite,
      async (item) => {
        executed.push(item.id)
        return { sessionID: `session-${item.id}` }
      },
      async () => results,
      (event) => progress.push(event),
    )
    expect(executed).toEqual(["one", "two"])
    expect(report).toMatchObject({ observed: 2, passed: 2 })
    expect(report.executions[0].sessionID).toBe("session-one")
    expect(progress.map((event) => `${event.type}:${event.id}`)).toEqual([
      "case_started:one",
      "case_finished:one",
      "case_started:two",
      "case_finished:two",
    ])
  })

  test("isolates suites and versions in stable storage buckets", () => {
    const first = AgentBenchmark.Suite.parse({
      name: "suite/a",
      version: "1",
      cases: [{ id: "x", category: "analysis", prompt: "x" }],
    })
    const second = AgentBenchmark.Suite.parse({
      name: "suite-a",
      version: "2",
      cases: [{ id: "x", category: "analysis", prompt: "x" }],
    })
    expect(AgentBenchmark.bucket(first)).toBe(AgentBenchmark.bucket(first))
    expect(AgentBenchmark.bucket(first)).not.toBe(AgentBenchmark.bucket(second))
  })

  test("stops after a provider-wide rate limit instead of retrying every case", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "limited",
      version: "1",
      cases: [
        { id: "one", category: "analysis", prompt: "inspect one" },
        { id: "two", category: "analysis", prompt: "inspect two" },
      ],
    })
    const executed: string[] = []
    const report = await AgentBenchmark.run(
      suite,
      async (item) => {
        executed.push(item.id)
        throw new Error("429 Rate limit exceeded")
      },
      async () => [],
    )
    expect(executed).toEqual(["one"])
    expect(report.executions).toEqual([{ id: "one", ok: false, error: "429 Rate limit exceeded" }])
  })

  test("recognizes provider quota exhaustion variants", () => {
    expect(AgentBenchmark.isRateLimitError("RESOURCE_EXHAUSTED")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("quota exceeded for this project")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("ordinary validation error")).toBe(false)
  })

  test("progress renderer failures never change benchmark executions", async () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "renderer-failure",
      version: "1",
      cases: [{ id: "one", category: "analysis", prompt: "inspect" }],
    })
    const report = await AgentBenchmark.run(
      suite,
      async () => ({ sessionID: "session-one" }),
      async () => [],
      () => {
        throw new Error("renderer failed")
      },
    )
    expect(report.executions).toEqual([{ id: "one", ok: true, sessionID: "session-one" }])
  })

  test("benchmark sessions disable transparent model fallback", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-benchmark-fallback"
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(true)
        AgentEval.registerBenchmark(sessionID, { suite: "suite", caseID: "case", runID: "run" })
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(false)
        expect(AgentEval.executionPolicy(sessionID)).toEqual({
          allowModelFallback: false,
          allowAuxiliarySummaries: false,
          allowMemoryLearning: false,
          maxRetries: 0,
        })
        AgentEval.unregisterBenchmark(sessionID)
        expect(AgentEval.allowsModelFallback(sessionID)).toBe(true)
      },
    })
  })

  test("evaluates failure constraints for tool errors, retries, duration, and missing observations", () => {
    const suite = AgentBenchmark.Suite.parse({
      name: "constraints-suite",
      version: "1",
      cases: [
        {
          id: "case-errors",
          category: "coding",
          prompt: "test errors",
          maxToolErrors: 1,
        },
        {
          id: "case-retries",
          category: "coding",
          prompt: "test retries",
          maxRetries: 1,
        },
        {
          id: "case-duration",
          category: "coding",
          prompt: "test duration",
          maxDurationMs: 500,
        },
        {
          id: "case-missing",
          category: "analysis",
          prompt: "test missing",
        },
      ],
    })

    const results = [
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-errors",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          toolErrors: 2,
          timestamp: 1000,
        }),
      ),
      // For case-retries, provide two observations; evaluate should choose the latest timestamp (2000)
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-retries",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          retries: 0,
          timestamp: 1000,
        }),
      ),
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-retries",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          retries: 2,
          timestamp: 2000,
        }),
      ),
      AgentEval.score(
        AgentEval.Observation.parse({
          id: "case-duration",
          category: "coding",
          providerID: "p",
          modelID: "m",
          completed: true,
          durationMs: 750,
          timestamp: 1000,
        }),
      ),
    ]

    const evaluation = AgentBenchmark.evaluate(suite, results)
    expect(evaluation.ready).toBe(false)
    expect(evaluation.observed).toBe(3)
    expect(evaluation.total).toBe(4)
    expect(evaluation.passed).toBe(0)

    const errorsCase = evaluation.cases.find((c) => c.id === "case-errors")!
    expect(errorsCase.passed).toBe(false)
    expect(errorsCase.failures).toContain("tool errors 2 > 1")

    const retriesCase = evaluation.cases.find((c) => c.id === "case-retries")!
    expect(retriesCase.passed).toBe(false)
    expect(retriesCase.failures).toContain("retries 2 > 1")
    expect(retriesCase.observation?.timestamp).toBe(2000)

    const durationCase = evaluation.cases.find((c) => c.id === "case-duration")!
    expect(durationCase.passed).toBe(false)
    expect(durationCase.failures).toContain("duration 750ms > 500ms")

    const missingCase = evaluation.cases.find((c) => c.id === "case-missing")!
    expect(missingCase.passed).toBe(false)
    expect(missingCase.failures).toContain("missing observation")
  })

  test("recognizes all standard quota and rate limit exception patterns", () => {
    expect(AgentBenchmark.isRateLimitError(new Error("FreeUsageLimitError: free tier limit exceeded"))).toBe(true)
    expect(AgentBenchmark.isRateLimitError("Error: 429 Too Many Requests")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("HTTP status 429")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("insufficient quota for model usage")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("usage limit reached for token bucket")).toBe(true)
    expect(AgentBenchmark.isRateLimitError("Unhandled TypeError: null is not an object")).toBe(false)
  })
})
