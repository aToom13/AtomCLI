import { describe, expect, test } from "bun:test"
import { ModelAvailability } from "@/integrations/provider/availability"

describe("model availability", () => {
  const now = Date.UTC(2026, 7, 20, 12, 0, 0)

  test("uses Retry-After seconds when the gateway provides it", () => {
    const response = new Response(null, { status: 429, headers: { "Retry-After": "90" } })
    expect(ModelAvailability.fromResponse(response, now)).toEqual({
      status: "rate_limited",
      retryAt: now + 90_000,
      source: "retry-after",
    })
  })

  test("uses an absolute rate-limit reset timestamp", () => {
    const reset = now + 120_000
    const response = new Response(null, { status: 429, headers: { "X-RateLimit-Reset": String(reset / 1000) } })
    expect(ModelAvailability.fromResponse(response, now)).toEqual({
      status: "rate_limited",
      retryAt: reset,
      source: "rate-limit-reset",
    })
  })

  test("derives the next UTC daily window when Zen omits reset headers", () => {
    const response = new Response(null, { status: 429 })
    expect(ModelAvailability.fromResponse(response, now)).toEqual({
      status: "rate_limited",
      retryAt: Date.UTC(2026, 7, 21),
      source: "daily-window",
    })
  })

  test("does not mark successful requests and expires elapsed limits", () => {
    expect(ModelAvailability.fromResponse(new Response(null, { status: 200 }), now)).toBeUndefined()
    expect(ModelAvailability.active({ status: "rate_limited", retryAt: now - 1 }, now)).toBeUndefined()
    expect(ModelAvailability.retryLabel({ status: "rate_limited", retryAt: now + 5_400_000 }, now)).toBe(
      "retry in ~1h 30m",
    )
  })
})
