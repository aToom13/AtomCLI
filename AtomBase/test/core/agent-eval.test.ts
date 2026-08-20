import { describe, expect, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"

describe("AgentEval", () => {
  test("rewards verified completion and penalizes correction loops", () => {
    const strong = AgentEval.score(AgentEval.Observation.parse({
      id: "strong",
      category: "coding",
      providerID: "provider",
      modelID: "model",
      completed: true,
      testsPassed: true,
      reviewerVerdict: "passed",
    }))
    const weak = AgentEval.score(AgentEval.Observation.parse({
      id: "weak",
      category: "coding",
      providerID: "provider",
      modelID: "model",
      completed: true,
      testsPassed: false,
      reviewerVerdict: "failed",
      userCorrections: 2,
      toolErrors: 3,
    }))

    expect(strong.success).toBe(true)
    expect(strong.score).toBe(90)
    expect(weak.success).toBe(false)
    expect(weak.score).toBe(0)
  })

  test("summarizes outcome, cost and efficiency signals", () => {
    const results = [
      AgentEval.score(AgentEval.Observation.parse({ id: "a", category: "analysis", providerID: "p", modelID: "m", completed: true, durationMs: 100, cost: 1, toolCalls: 2 })),
      AgentEval.score(AgentEval.Observation.parse({ id: "b", category: "analysis", providerID: "p", modelID: "m", completed: false, durationMs: 300, cost: 2, toolErrors: 1 })),
    ]
    expect(AgentEval.summarize(results)).toMatchObject({
      count: 2,
      successRate: 0.5,
      averageDurationMs: 200,
      totalCost: 3,
      totalToolCalls: 2,
      totalToolErrors: 1,
    })
  })
})
