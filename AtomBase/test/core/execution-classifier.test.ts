import "../preload"
import { describe, expect, test, beforeEach } from "bun:test"
import { ExecutionClassifier } from "@/core/routing/execution-classifier"

describe("ExecutionClassifier", () => {
  beforeEach(() => {
    ExecutionClassifier.clearCache()
  })

  test("falls back cleanly when no model is provided", async () => {
    const result = await ExecutionClassifier.classify({
      prompt: "Explain what is recursion",
    })
    expect(result.fallback).toBe(true)
    expect(result.contract.scope).toBe("focused")
    expect(result.contract.risk).toBe("elevated")
    expect(result.contract.rationale).toBe("no_model_available")
  })

  test("caches results by invocationID or prompt", async () => {
    const prompt = "Inspect file test.ts"
    const first = await ExecutionClassifier.classify({ prompt })
    expect(first.cached).toBe(false)

    const second = await ExecutionClassifier.classify({ prompt })
    expect(second.cached).toBe(true)
    expect(second.contract).toEqual(first.contract)
  })

  test("cache can be cleared", async () => {
    const prompt = "Fix bug in auth"
    await ExecutionClassifier.classify({ prompt })
    ExecutionClassifier.clearCache()

    const third = await ExecutionClassifier.classify({ prompt })
    expect(third.cached).toBe(false)
  })

  test("handles signal timeout and returns fallback", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await ExecutionClassifier.classify({
      prompt: "Do something long",
      model: {} as any,
      signal: controller.signal,
    })

    expect(result.fallback).toBe(true)
    expect(result.contract.rationale).toContain("classifier_timeout_or_abort")
  })
})
