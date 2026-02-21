import type { NamedError } from "@atomcli/util/error"
import { MessageV2 } from "./message-v2"

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000
  export const RETRY_BACKOFF_FACTOR = 2
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
  export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(
        () => {
          signal.removeEventListener("abort", abortHandler)
          resolve()
        },
        Math.min(ms, RETRY_MAX_DELAY),
      )
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  export function delay(attempt: number, error?: MessageV2.APIError) {
    if (error) {
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfterMs = headers["retry-after-ms"]
        if (retryAfterMs) {
          const parsedMs = Number.parseFloat(retryAfterMs)
          if (!Number.isNaN(parsedMs)) {
            return parsedMs
          }
        }

        const retryAfter = headers["retry-after"]
        if (retryAfter) {
          const parsedSeconds = Number.parseFloat(retryAfter)
          if (!Number.isNaN(parsedSeconds)) {
            // convert seconds to milliseconds
            return Math.ceil(parsedSeconds * 1000)
          }
          // Try parsing as HTTP date format
          const parsed = Date.parse(retryAfter) - Date.now()
          if (!Number.isNaN(parsed) && parsed > 0) {
            return Math.ceil(parsed)
          }
        }

        return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
      }
    }

    return Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)
  }

  // HTTP status codes that should trigger retry/fallback
  const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504]

  // Message patterns that indicate retryable errors
  const RETRYABLE_PATTERNS = [
    { pattern: /rate limit|too many requests/i, message: "Rate Limited" },
    { pattern: /timeout|timed out|time out/i, message: "Request Timeout" },
    { pattern: /overload|capacity|exhausted/i, message: "Provider Overloaded" },
    { pattern: /service unavailable|internal server error/i, message: "Server Error" },
    { pattern: /connection reset|econnreset|econnrefused/i, message: "Connection Error" },
    { pattern: /network error|socket hang up/i, message: "Network Error" },
    // Model capability errors - trigger fallback to different model
    { pattern: /reasoning is not supported/i, message: "Model Capability Error (reasoning not supported)" },
    { pattern: /does not support.*model|not supported by this model/i, message: "Model Capability Error" },
  ]

  export function retryable(error: ReturnType<NamedError["toObject"]>) {
    if (MessageV2.APIError.isInstance(error)) {
      // Check isRetryable flag from AI SDK
      if (error.data.isRetryable) {
        return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
      }

      // Check HTTP status code - even if isRetryable is false
      if (error.data.statusCode && RETRYABLE_STATUS_CODES.includes(error.data.statusCode)) {
        return `HTTP ${error.data.statusCode} error`
      }

      // Check message patterns for retryable errors
      const msg = error.data.message.toLowerCase()
      for (const { pattern, message } of RETRYABLE_PATTERNS) {
        if (pattern.test(msg)) {
          return message
        }
      }

      // Check response headers for retry-after
      const headers = error.data.responseHeaders
      if (headers) {
        const retryAfter = headers["retry-after"] || headers["retry-after-ms"]
        if (retryAfter) {
          return "Rate Limited (retry-after header present)"
        }
      }
    }

    if (typeof error.data?.message === "string") {
      try {
        const json = JSON.parse(error.data.message)
        if (json.type === "error" && json.error?.type === "too_many_requests") {
          return "Too Many Requests"
        }
        if (json.code?.includes("exhausted") || json.code?.includes("unavailable")) {
          return "Provider is overloaded"
        }
        if (json.type === "error" && json.error?.code?.includes("rate_limit")) {
          return "Rate Limited"
        }
        if (
          json.error?.message?.includes("no_kv_space") ||
          (json.type === "error" && json.error?.type === "server_error") ||
          !!json.error
        ) {
          return "Provider Server Error"
        }
      } catch { }
    }

    return undefined
  }
}
