/**
 * Model Fallback System
 * 
 * Automatic model switching when API errors occur (rate limits, downtime).
 * Fallback chain: Primary → Secondary → Tertiary models.
 * Seamless continuation without user intervention.
 * Cost/performance optimization across different providers.
 */

import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import { LLM } from "../session/llm"
import type { StreamTextResult, ToolSet } from "ai"

export namespace ModelFallback {
  const log = Log.create({ service: "fallback" })

  export interface FallbackChain {
    primary: Provider.Model
    secondary?: Provider.Model
    tertiary?: Provider.Model
    onError?: (error: Error, model: Provider.Model, attempt: number) => void
    onSwitch?: (from: Provider.Model, to: Provider.Model) => void
  }

  export interface FallbackResult {
    success: boolean
    model: Provider.Model
    result?: StreamTextResult<ToolSet, unknown>
    error?: Error
    attempts: number
    totalCost: number
  }

  export interface FallbackOptions {
    maxRetriesPerModel?: number
    totalTimeout?: number
    enableCostTracking?: boolean
    /** Per-model stream timeout in ms. Default: 20000 (20s) */
    streamTimeoutMs?: number
  }

  // Error types that trigger fallback
  const FALLBACK_ERROR_PATTERNS = [
    /rate limit/i,
    /too many requests/i,
    /429/i,
    /503/i,
    /service unavailable/i,
    /timeout/i,
    /connection error/i,
    /network error/i,
    /internal server error/i,
    /500/i,
    /502/i,
    /504/i,
    /overloaded/i,
    /capacity/i,
    // Model capability errors - trigger fallback to different model
    /reasoning is not supported/i,
    /does not support/i,
    /not supported by this model/i,
  ]

  /**
   * Default fallback models (atomcli provider - no API key needed)
   * These are used when no custom fallback is configured
   */
  export const DEFAULT_FALLBACK_MODELS = [
    "atomcli/minimax-m2.5-free",
    "atomcli/gpt-5-nano",
    "atomcli/big-pickle",
  ]

  /**
   * Check if error should trigger fallback
   */
  export function shouldFallback(error: Error): boolean {
    const errorMessage = error.message.toLowerCase()
    return FALLBACK_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage))
  }

  /**
   * Get fallback chain from configuration
   */
  export async function getFallbackChain(
    primaryModelID: string,
    config?: {
      secondary?: string
      tertiary?: string
    }
  ): Promise<FallbackChain> {
    const parsed = Provider.parseModel(primaryModelID)
    const primary = await Provider.getModel(parsed.providerID, parsed.modelID)

    const chain: FallbackChain = { primary }

    if (config?.secondary) {
      const secondaryParsed = Provider.parseModel(config.secondary)
      try {
        chain.secondary = await Provider.getModel(secondaryParsed.providerID, secondaryParsed.modelID)
      } catch (e) {
        log.warn("secondary model not found", { secondary: config.secondary })
      }
    }

    if (config?.tertiary) {
      const tertiaryParsed = Provider.parseModel(config.tertiary)
      try {
        chain.tertiary = await Provider.getModel(tertiaryParsed.providerID, tertiaryParsed.modelID)
      } catch (e) {
        log.warn("tertiary model not found", { tertiary: config.tertiary })
      }
    }

    return chain
  }

  /**
   * Stream with automatic fallback
   */
  export async function streamWithFallback(
    chain: FallbackChain,
    input: LLM.StreamInput,
    options: FallbackOptions = {}
  ): Promise<FallbackResult> {
    const { maxRetriesPerModel = 1, streamTimeoutMs = 20_000 } = options
    const models = [chain.primary, chain.secondary, chain.tertiary].filter(Boolean) as Provider.Model[]

    let lastError: Error | undefined
    let attempts = 0
    let totalCost = 0

    for (const model of models) {
      for (let retry = 0; retry < maxRetriesPerModel; retry++) {
        attempts++

        try {
          log.info("attempting stream", {
            modelID: model.id,
            providerID: model.providerID,
            attempt: attempts,
            timeoutMs: streamTimeoutMs,
          })

          // Calculate cost estimate before streaming
          if (options.enableCostTracking) {
            totalCost += estimateCost(model, input)
          }

          // Race LLM stream against timeout — triggers fallback if model is too slow
          const result = await Promise.race([
            LLM.stream({ ...input, model }),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error(`Model response timed out after ${streamTimeoutMs}ms`)),
                streamTimeoutMs,
              )
            }),
          ])

          log.info("stream successful", {
            modelID: model.id,
            providerID: model.providerID,
            attempts,
          })

          // Notify switch callback if not primary
          if (model.id !== chain.primary.id && chain.onSwitch) {
            chain.onSwitch(chain.primary, model)
          }

          return {
            success: true,
            model,
            result,
            attempts,
            totalCost,
          }

        } catch (error) {
          lastError = error as Error

          log.warn("stream failed", {
            modelID: model.id,
            providerID: model.providerID,
            attempt: attempts,
            error: lastError.message,
          })

          if (chain.onError) {
            chain.onError(lastError, model, attempts)
          }

          // Check if we should try fallback
          if (!shouldFallback(lastError)) {
            log.error("non-recoverable error", { error: lastError.message })
            break // Don't retry this model, move to next
          }

          // Wait before retry (exponential backoff)
          if (retry < maxRetriesPerModel - 1) {
            const delay = Math.min(1000 * Math.pow(2, retry), 10000)
            log.info("retrying after delay", { delay })
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }
    }

    // All models failed
    log.error("all fallback models failed", { attempts })
    return {
      success: false,
      model: chain.primary,
      error: lastError,
      attempts,
      totalCost,
    }
  }

  /**
   * Estimate cost for a model request
   */
  function estimateCost(model: Provider.Model, input: LLM.StreamInput): number {
    // Rough estimate based on input tokens
    const estimatedInputTokens = JSON.stringify(input.messages).length / 4
    const estimatedOutputTokens = model.limit.output * 0.5 // Assume 50% of max output

    const inputCost = (estimatedInputTokens * model.cost.input) / 1_000_000
    const outputCost = (estimatedOutputTokens * model.cost.output) / 1_000_000

    return inputCost + outputCost
  }

  /**
   * Create fallback chain from model IDs
   */
  export async function createChain(
    primary: string,
    secondary?: string,
    tertiary?: string
  ): Promise<FallbackChain> {
    const primaryParsed = Provider.parseModel(primary)
    const chain: FallbackChain = {
      primary: await Provider.getModel(primaryParsed.providerID, primaryParsed.modelID),
    }

    if (secondary) {
      const secondaryParsed = Provider.parseModel(secondary)
      try {
        chain.secondary = await Provider.getModel(secondaryParsed.providerID, secondaryParsed.modelID)
      } catch (e) {
        log.warn("failed to load secondary model", { secondary })
      }
    }

    if (tertiary) {
      const tertiaryParsed = Provider.parseModel(tertiary)
      try {
        chain.tertiary = await Provider.getModel(tertiaryParsed.providerID, tertiaryParsed.modelID)
      } catch (e) {
        log.warn("failed to load tertiary model", { tertiary })
      }
    }

    return chain
  }

  /**
   * Get recommended fallback models for a primary model
   */
  export function getRecommendedFallbacks(primary: Provider.Model): string[] {
    const recommendations: Record<string, string[]> = {
      "claude": ["openai/gpt-4", "google/gemini-pro"],
      "gpt-4": ["anthropic/claude-sonnet", "google/gemini-pro"],
      "gemini": ["anthropic/claude-sonnet", "openai/gpt-4"],
    }

    for (const [pattern, fallbacks] of Object.entries(recommendations)) {
      if (primary.id.toLowerCase().includes(pattern)) {
        return fallbacks
      }
    }

    return ["anthropic/claude-sonnet", "openai/gpt-4"]
  }
}
