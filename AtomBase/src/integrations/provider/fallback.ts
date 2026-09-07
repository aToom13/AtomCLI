/**
 * Model Fallback System
 *
 * Automatic model switching when API errors occur (rate limits, downtime).
 * Fallback chain: Primary → Secondary → Tertiary models.
 * Seamless continuation without user intervention.
 * Cost/performance optimization across different providers.
 */

import { Log } from "@/util/util/log"
import { Provider } from "../provider/provider"
import { ModelAvailability } from "./availability"
import { ModelVerification } from "./verification"
import { LLM } from "@/core/session/llm"
import type { StreamTextResult, ToolSet } from "ai"
import z from "zod"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ProviderTransform } from "./transform"
import { Auth } from "@/services/auth"

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
   * Default fallback models for backward-compatibility or when provider list is not loaded.
   */
  export const DEFAULT_FALLBACK_MODELS = ["atomcli/minimax-m2.5-free", "atomcli/gpt-5-nano", "atomcli/big-pickle"]

  /**
   * Dynamically discovers available free fallback models from available providers.
   * Prioritizes atomcli provider free models, with capability/score filtering.
   */
  export async function getDynamicFallbackModels(options?: {
    excludeModelID?: string
    excludeProviderID?: string
    limit?: number
  }): Promise<string[]> {
    const limit = options?.limit ?? 5
    try {
      const providers = await Provider.list()
      const atomcli = providers["atomcli"]
      const candidateModels: Array<{ id: string; providerID: string; score: number }> = []

      if (atomcli && atomcli.models) {
        for (const [mID, m] of Object.entries(atomcli.models)) {
          if (mID === "atomcli-auto" || mID === "atomcli-free") continue
          if (m.status === "deprecated") continue
          if (ModelAvailability.active(m.availability)) continue
          // Must be free
          const isFree = (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0
          if (!isFree) continue

          // Skip excluded
          if (options?.excludeProviderID === "atomcli" && options?.excludeModelID === mID) {
            continue
          }

          let score = 0
          if (m.capabilities?.toolcall) score += 40
          if (m.capabilities?.reasoning) score += 20
          score += Math.min((m.limit?.context ?? 0) / 10000, 20)
          score += Math.min((m.limit?.output ?? 0) / 1000, 10)

          candidateModels.push({
            id: mID,
            providerID: "atomcli",
            score,
          })
        }
      }

      // If atomcli provider didn't have enough, check other providers for free models
      if (candidateModels.length < limit) {
        for (const [pID, p] of Object.entries(providers)) {
          if (pID === "atomcli") continue
          for (const [mID, m] of Object.entries(p.models || {})) {
            if (m.status === "deprecated") continue
            if (ModelAvailability.active(m.availability)) continue
            const isFree = (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0
            if (isFree) {
              if (options?.excludeProviderID === pID && options?.excludeModelID === mID) continue
              candidateModels.push({
                id: mID,
                providerID: pID,
                score: (m.capabilities?.toolcall ? 30 : 0) + Math.min((m.limit?.context ?? 0) / 10000, 10),
              })
            }
          }
        }
      }

      if (candidateModels.length > 0) {
        candidateModels.sort((a, b) => b.score - a.score)
        return candidateModels.slice(0, limit).map((c) => `${c.providerID}/${c.id}`)
      }
    } catch (e) {
      log.warn("failed to discover dynamic fallback models", { error: (e as Error).message })
    }

    return DEFAULT_FALLBACK_MODELS
  }

  export interface ModelProbeResult {
    model: string
    providerID: string
    modelID: string
    available: boolean
    latencyMs?: number
    error?: string
    verification?: ModelVerification.Status
    capability?: ModelVerification.Capability
    checkedAt?: number
    verifiedUntil?: number
  }

  function validateProbeText(result: unknown) {
    const response =
      result && typeof result === "object" ? (result as { text?: unknown; finishReason?: unknown }) : undefined
    const text = response?.text
    if (typeof text !== "string" || !text.trim()) {
      if (response?.finishReason === "length") throw new Error("Probe output limit reached before visible text")
      throw new Error("Probe returned empty output")
    }
  }

  function validateProbeTool(result: unknown) {
    const calls = result && typeof result === "object" ? (result as { toolCalls?: unknown }).toolCalls : undefined
    if (!Array.isArray(calls) || calls.length === 0) throw new Error("Probe returned no valid tool call")
    const valid = calls.some(
      (call) =>
        call &&
        typeof call === "object" &&
        (call as { toolName?: unknown }).toolName === "verification" &&
        (call as { input?: { value?: unknown } }).input?.value === "ok",
    )
    if (!valid) throw new Error("Probe returned an invalid tool call")
  }

  /**
   * Probe models by sending a minimal stream/completion test to check if they respond.
   */
  export async function probeModels(
    models: string[],
    options?: {
      timeoutMs?: number
      totalTimeoutMs?: number
      concurrency?: number
      capability?: "text" | "tool"
      force?: boolean
      /** Bind real verification requests to the originating root execution budget. */
      sessionID?: string
      signal?: AbortSignal
      execution?: ExecutionRuntime.Context
      /** Verify the same reasoning/thinking variant that the real request will use. */
      variant?: string
      agent?: any
      user?: any
      /** Already prepared dispatch parameters; do not rerun stateful parameter plugins. */
      effectiveParams?: Awaited<ReturnType<typeof LLM.prepareRouteParams>>["params"]
    },
  ): Promise<ModelProbeResult[]> {
    const timeoutMs = options?.timeoutMs ?? 7000
    const totalDeadline = Date.now() + (options?.totalTimeoutMs ?? timeoutMs * Math.ceil(models.length / 3))
    const concurrency = options?.concurrency ?? 3
    const capability = options?.capability ?? "text"
    const maxOutputTokens = capability === "tool" ? 512 : 256
    const results: ModelProbeResult[] = []

    const { getGenerateText, getTool } = await import("@/util/util/ai-compat")
    const generateText = await getGenerateText()
    const probeTool =
      capability === "tool"
        ? (await getTool())({
            description: "Return the supplied verification value without side effects.",
            inputSchema: z.object({ value: z.literal("ok") }),
          })
        : undefined

    const probeSingle = async (modelSpec: string): Promise<ModelProbeResult> => {
      const parsed = Provider.parseModel(modelSpec)
      const start = Date.now()
      const remaining = Math.min(timeoutMs, totalDeadline - start)
      if (remaining <= 0) {
        return {
          model: modelSpec,
          providerID: parsed.providerID,
          modelID: parsed.modelID,
          available: false,
          error: "Probe total deadline exceeded",
        }
      }
      try {
        const model = await Provider.getModel(parsed.providerID, parsed.modelID)
        const provider = await Provider.getProvider(model.providerID)
        if (!provider) throw new Error(`Provider not found: ${model.providerID}`)
        const isCodex = provider.id === "openai" && (await Auth.get(provider.id))?.type === "oauth"
        const concreteUser = options?.user
          ? { ...options.user, variant: options.variant ?? options.user.variant }
          : undefined
        const prepared = options?.effectiveParams
          ? { params: options.effectiveParams }
          : options?.agent && concreteUser
            ? await LLM.prepareRouteParams({
                model,
                sessionID: options.sessionID ?? concreteUser.sessionID,
                agent: options.agent,
                user: concreteUser,
                provider,
              })
            : undefined
        const key = await ModelVerification.identity(model, provider, {
          variant: options?.variant,
          effectiveParams: prepared?.params,
        })
        const abortController = new AbortController()
        let deadline: ReturnType<typeof setTimeout> | undefined

        try {
          const evidence = await ModelVerification.probe(
            {
              key,
              providerID: model.providerID,
              modelID: model.id,
              capability,
              force: options?.force,
            },
            async () => {
              const probePrompt =
                capability === "tool" ? 'Call the verification tool with {"value":"ok"}.' : "Reply with OK."
              const executionAttempt = options?.sessionID
                ? await ExecutionRuntime.admitModelCall({
                    sessionID: options.sessionID,
                    purpose: `verification:${capability}`,
                    estimateMicrousd: ExecutionRuntime.estimateMicrousd(model, probePrompt, maxOutputTokens),
                    execution: options.execution,
                  })
                : undefined
              let usageSettled = false
              try {
                const request = (async () => {
                  try {
                    const language = await Provider.getLanguage(model)
                    const base = ProviderTransform.options(
                      model,
                      options?.sessionID ?? "model-verification",
                      provider.options,
                    )
                    const requestOptions =
                      prepared?.params.options ??
                      ProviderTransform.applyVariant(model, options?.variant, base, model.options)
                    if (isCodex && !prepared) {
                      const { SystemPrompt } = await import("@/core/session/system")
                      requestOptions.instructions = SystemPrompt.instructions()
                      requestOptions.store = false
                    }
                    const signals = [abortController.signal]
                    if (options?.signal) signals.push(options.signal)
                    if (executionAttempt) signals.push(executionAttempt.signal)
                    const requestParams = {
                      model: language,
                      messages: [{ role: "user" as const, content: probePrompt }],
                      abortSignal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
                      maxOutputTokens: isCodex ? undefined : maxOutputTokens,
                      maxRetries: 0,
                      temperature: prepared?.params.temperature,
                      topP: prepared?.params.topP,
                      topK: prepared?.params.topK,
                      providerOptions: ProviderTransform.providerOptions(model, requestOptions),
                      ...(probeTool
                        ? {
                            tools: { verification: probeTool },
                            toolChoice: { type: "tool" as const, toolName: "verification" as const },
                          }
                        : {}),
                    }
                    // ChatGPT OAuth accepts only streaming Responses requests, just like normal dispatch.
                    const response = isCodex
                      ? await (async () => {
                          const { getStreamText } = await import("@/util/util/ai-compat")
                          const stream = (await getStreamText())(requestParams)
                          const [text, toolCalls, usage, finishReason] = await Promise.all([
                            stream.text,
                            stream.toolCalls,
                            stream.usage,
                            stream.finishReason,
                          ])
                          return { text, toolCalls, usage, finishReason }
                        })()
                      : await generateText(requestParams)
                    executionAttempt?.settle(ExecutionRuntime.usageCostUsd(model, response.usage))
                    usageSettled = true
                    if (capability === "tool") validateProbeTool(response)
                    else validateProbeText(response)
                    return response
                  } catch (error) {
                    if (!usageSettled) executionAttempt?.uncertain()
                    throw error
                  }
                })()
                const result = await Promise.race([
                  request,
                  new Promise<never>((_, reject) => {
                    deadline = setTimeout(() => {
                      abortController.abort()
                      reject(new Error(`Probe timed out after ${remaining}ms`))
                    }, remaining)
                  }),
                ])
                return { capabilities: [capability] }
              } catch (error) {
                throw error
              }
            },
          )

          const latencyMs = Date.now() - start
          return {
            model: modelSpec,
            providerID: model.providerID,
            modelID: model.id,
            available: ModelVerification.isVerified(evidence, capability),
            latencyMs,
            verification: evidence.status,
            capability,
            checkedAt: evidence.checkedAt,
            verifiedUntil: evidence.capabilities[capability],
            error: evidence.status === "verified" ? undefined : evidence.reason,
          }
        } finally {
          if (deadline) clearTimeout(deadline)
        }
      } catch (err: any) {
        if (err?.name === "ExecutionBudgetExceededError") throw err
        return {
          model: modelSpec,
          providerID: parsed.providerID,
          modelID: parsed.modelID,
          available: false,
          latencyMs: Date.now() - start,
          error: err?.message || String(err),
        }
      }
    }

    // Run probes in bounded batches
    for (let i = 0; i < models.length; i += concurrency) {
      const batch = models.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map((m) => probeSingle(m)))
      results.push(...batchResults)
    }

    return results
  }

  export const _internals = {
    validateProbeText,
    validateProbeTool,
  }

  /**
   * Check if error should trigger fallback
   */
  export function shouldFallback(error: Error): boolean {
    const errorMessage = error.message.toLowerCase()
    return FALLBACK_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))
  }

  /**
   * Get fallback chain from configuration
   */
  export async function getFallbackChain(
    primaryModelID: string,
    config?: {
      secondary?: string
      tertiary?: string
    },
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
    options: FallbackOptions = {},
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
            await new Promise((resolve) => setTimeout(resolve, delay))
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
  export async function createChain(primary: string, secondary?: string, tertiary?: string): Promise<FallbackChain> {
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
      claude: ["openai/gpt-4", "google/gemini-pro"],
      "gpt-4": ["anthropic/claude-sonnet", "google/gemini-pro"],
      gemini: ["anthropic/claude-sonnet", "openai/gpt-4"],
    }

    for (const [pattern, fallbacks] of Object.entries(recommendations)) {
      if (primary.id.toLowerCase().includes(pattern)) {
        return fallbacks
      }
    }

    return ["anthropic/claude-sonnet", "openai/gpt-4"]
  }
}
