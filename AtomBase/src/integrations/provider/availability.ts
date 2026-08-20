import { BusEvent } from "@/core/bus/bus-event"
import z from "zod"

export namespace ModelAvailability {
  export const Info = z.object({
    status: z.literal("rate_limited"),
    retryAt: z.number().optional(),
    source: z.enum(["retry-after", "rate-limit-reset", "daily-window"]).optional(),
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "provider.model.availability.updated",
      z.object({
        providerID: z.string(),
        modelID: z.string(),
        availability: Info.optional(),
      }),
    ),
  }

  function retryAfter(value: string | null, now: number) {
    if (!value) return
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000
    const date = Date.parse(value)
    if (Number.isFinite(date) && date > now) return date
  }

  function rateLimitReset(value: string | null, now: number) {
    if (!value) return
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return
    if (parsed > 1_000_000_000_000) return parsed
    if (parsed > 1_000_000_000) return parsed * 1000
    return now + parsed * 1000
  }

  function nextUTCWindow(now: number) {
    const date = new Date(now)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  }

  export function fromResponse(response: Response, now = Date.now()): Info | undefined {
    if (response.status !== 429) return

    const headerRetry = retryAfter(response.headers.get("retry-after"), now)
    if (headerRetry) return { status: "rate_limited", retryAt: headerRetry, source: "retry-after" }

    const reset = rateLimitReset(response.headers.get("x-ratelimit-reset"), now)
    if (reset) return { status: "rate_limited", retryAt: reset, source: "rate-limit-reset" }

    // Zen's free limiter uses a UTC-day bucket when it omits reset headers.
    return { status: "rate_limited", retryAt: nextUTCWindow(now), source: "daily-window" }
  }

  export function active(value: Info | undefined, now = Date.now()) {
    if (!value) return
    if (value.retryAt !== undefined && value.retryAt <= now) return
    return value
  }

  export function retryLabel(value: Info | undefined, now = Date.now()) {
    const current = active(value, now)
    if (!current?.retryAt) return "retry time unknown"
    const seconds = Math.max(0, Math.ceil((current.retryAt - now) / 1000))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.ceil((seconds % 3600) / 60)
    if (hours > 0) return `retry in ~${hours}h ${minutes}m`
    return `retry in ~${Math.max(1, minutes)}m`
  }
}
