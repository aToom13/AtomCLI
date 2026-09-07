import "../preload"
import { describe, expect, test } from "bun:test"
import { ModelVerification } from "@/integrations/provider/verification"

function identity(suffix: string) {
  return {
    key: `verification-${suffix}-${crypto.randomUUID()}`,
    providerID: "test-provider",
    modelID: `test-model-${suffix}`,
  }
}

describe("ModelVerification", () => {
  test("rechecks evidence after a cached cooldown result instead of retaining the settled probe", async () => {
    const input = identity("cached-cooldown")
    const attempt = await ModelVerification.begin(input)
    await ModelVerification.failed(attempt, "timeout")
    let calls = 0
    const run = async () => {
      calls++
      return { capabilities: ["text" as const] }
    }
    expect((await ModelVerification.probe(input, run)).status).toBe("inconclusive")
    expect(calls).toBe(0)
    const retry = await ModelVerification.begin(input)
    await ModelVerification.failed(retry, "timeout", { now: 1, retryAt: 2 })
    expect((await ModelVerification.probe(input, run)).status).toBe("verified")
    expect(calls).toBe(1)
  })

  test("binds evidence identity to the selected variant and its wire options", async () => {
    const model = {
      id: "reasoning-model",
      providerID: "test-provider",
      api: { id: "reasoning-model-api", npm: "@ai-sdk/openai-compatible" },
      options: {},
      headers: {},
      variants: {
        high: { reasoningEffort: "high" },
        max: { reasoningEffort: "max" },
      },
    } as any
    const provider = { id: "test-provider", key: "test-provider", options: { apiKey: "fake-key" } } as any

    const base = await ModelVerification.identity(model, provider)
    const high = await ModelVerification.identity(model, provider, { variant: "high" })
    const max = await ModelVerification.identity(model, provider, { variant: "max" })

    expect(high).not.toBe(base)
    expect(max).not.toBe(high)
    model.variants.high.reasoningEffort = "xhigh"
    expect(await ModelVerification.identity(model, provider, { variant: "high" })).not.toBe(high)
    expect(
      await ModelVerification.identity(model, provider, { variant: "max", effectiveParams: { topP: 0.5 } }),
    ).not.toBe(max)
    model.options = { _routePolicy: { mode: "free" }, _catalogCostKnown: true }
    expect(await ModelVerification.identity(model, provider)).toBe(base)
  })

  test("expires verified evidence without treating it as verified", async () => {
    const input = identity("ttl")
    const attempt = await ModelVerification.begin(input)
    await ModelVerification.verified(attempt, ["text"], { now: 1000, ttlMs: 50 })

    expect(ModelVerification.isVerified(await ModelVerification.get(input.key, 1049), "text", 1049)).toBe(true)
    expect((await ModelVerification.get(input.key, 1050))?.status).toBe("expired")
    expect(ModelVerification.isVerified(await ModelVerification.get(input.key, 1050), "text", 1050)).toBe(false)
  })

  test("a late success cannot overwrite a newer rate limit", async () => {
    const input = identity("generation")
    const oldAttempt = await ModelVerification.begin(input)
    const currentAttempt = await ModelVerification.begin(input)
    await ModelVerification.failed(currentAttempt, "rate_limited", { now: 2000, retryAt: 5000 })
    await ModelVerification.verified(oldAttempt, ["text"], { now: 2100 })

    const evidence = await ModelVerification.get(input.key, 2100)
    expect(evidence?.status).toBe("rate_limited")
    expect(evidence?.generation).toBe(currentAttempt.generation)
  })

  test("coalesces concurrent probes for the same identity", async () => {
    const input = identity("single-flight")
    let calls = 0
    const run = async () => {
      calls++
      await Bun.sleep(10)
      return { capabilities: ["text" as const] }
    }

    const [first, second] = await Promise.all([
      ModelVerification.probe(input, run),
      ModelVerification.probe(input, run),
    ])
    expect(calls).toBe(1)
    expect(first.status).toBe("verified")
    expect(second.generation).toBe(first.generation)
  })

  test("keeps text and tool evidence separate", async () => {
    const input = identity("capability")
    const attempt = await ModelVerification.begin(input)
    await ModelVerification.verified(attempt, ["tool"], { now: 3000, ttlMs: 100 })
    const evidence = await ModelVerification.get(input.key, 3001)

    expect(ModelVerification.isVerified(evidence, "tool", 3001)).toBe(true)
    expect(ModelVerification.isVerified(evidence, "text", 3001)).toBe(false)
  })

  test("serializes different capability probes without losing either proof", async () => {
    const input = identity("capability-queue")
    await Promise.all([
      ModelVerification.probe({ ...input, capability: "text" }, async () => ({ capabilities: ["text"] })),
      ModelVerification.probe({ ...input, capability: "tool" }, async () => ({ capabilities: ["tool"] })),
    ])
    const evidence = await ModelVerification.get(input.key)
    expect(ModelVerification.isVerified(evidence, "text")).toBe(true)
    expect(ModelVerification.isVerified(evidence, "tool")).toBe(true)
  })

  test("classifies cooldown failures without storing provider error text", async () => {
    const input = identity("failure")
    const result = await ModelVerification.probe(input, async () => {
      throw new Error("401 secret-token-must-not-be-persisted")
    })

    expect(result.status).toBe("failed")
    expect(result.reason).toBe("authentication")
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  test("keeps timeout and output-limit probe results inconclusive until their cooldown expires", async () => {
    for (const [suffix, message, reason] of [
      ["timeout", "Probe timed out after 100ms", "timeout"],
      ["output", "Probe output limit reached before visible text", "output_limit"],
    ] as const) {
      const input = identity(suffix)
      const result = await ModelVerification.probe(input, async () => {
        throw new Error(message)
      })
      expect(result.status).toBe("inconclusive")
      expect(result.reason).toBe(reason)
      expect(result.retryAt).toBeGreaterThan(result.checkedAt ?? 0)
    }
  })

  test("does not replace model evidence when a local execution budget rejects a probe", async () => {
    const input = identity("budget")
    const attempt = await ModelVerification.begin(input)
    const previous = await ModelVerification.verified(attempt, ["text"])
    const error = new Error("Execution budget blocked the request")
    error.name = "ExecutionBudgetExceededError"

    await expect(ModelVerification.probe({ ...input, force: true }, async () => Promise.reject(error))).rejects.toBe(
      error,
    )
    expect(await ModelVerification.get(input.key)).toEqual(previous)
  })

  test("fails closed when the persisted evidence schema is corrupt", async () => {
    await Bun.write(ModelVerification._internals.filepath, JSON.stringify({ version: 999, entries: {} }))

    expect(await ModelVerification.get(`missing-${crypto.randomUUID()}`)).toBeUndefined()
  })
})
