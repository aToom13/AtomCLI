import { Log } from "@/util/util/log"
import { ExecutionContract } from "./execution-contract"

const log = Log.create({ service: "execution-classifier" })

export namespace ExecutionClassifier {
  const cache = new Map<string, ExecutionContract.Info>()
  const MAX_CACHE_SIZE = 200

  export interface Input {
    invocationID?: string
    prompt: string
    agentMode?: string
    explicitConstraints?: string
    model?: any
    modelInfo?: any
    sessionID?: string
    execution?: any
    timeoutMs?: number
    signal?: AbortSignal
  }

  export interface ClassificationResult {
    contract: ExecutionContract.Info
    durationMs: number
    cached: boolean
    fallback: boolean
  }

  const CLASSIFIER_SYSTEM_PROMPT = `You are a strict task classifier. Analyze the user prompt and return a structured execution contract JSON.
Classification guidelines:
- scope:
  * "direct": single direct question/answer, single read, single local transformation, no repository-wide discovery, <= 2 steps.
  * "focused": localized bug fix, small feature, 1-4 files in single module/subsystem, targeted verification.
  * "coordinated": multiple independent tasks, cross-subsystem or cross-package changes, public API/schema/migration changes, wide refactoring.
- risk:
  * "low": read-only operations, safe reversible local inspect/explain, no side-effects.
  * "elevated": typical source modifications, config edits, refactors needing tests.
  * "critical": auth, credentials, permissions, DB migrations, persistent schema, CI/release workflows, irreversible changes, public API breaking changes.
- uncertainty: "low" if request is specific and clear, "material" if exploratory, "blocking" if requirements are missing.`

  export function getCached(key: string): ExecutionContract.Info | undefined {
    return cache.get(key)
  }

  export function setCache(key: string, contract: ExecutionContract.Info) {
    if (cache.size >= MAX_CACHE_SIZE) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(key, contract)
  }

  export function clearCache() {
    cache.clear()
  }

  export async function classify(input: Input): Promise<ClassificationResult> {
    const started = Date.now()
    const cacheKey = input.invocationID ?? input.prompt.trim()

    if (cacheKey) {
      const cached = cache.get(cacheKey)
      if (cached) {
        return {
          contract: cached,
          durationMs: Date.now() - started,
          cached: true,
          fallback: false,
        }
      }
    }

    if (!input.model) {
      const contract = ExecutionContract.fallback("no_model_available")
      if (cacheKey) setCache(cacheKey, contract)
      return {
        contract,
        durationMs: Date.now() - started,
        cached: false,
        fallback: true,
      }
    }

    let attempt: any = undefined
    if (input.sessionID && input.execution) {
      try {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const promptSnippet = input.prompt.slice(0, 1000)
        const estimateMicrousd = input.modelInfo
          ? ExecutionRuntime.estimateMicrousd(input.modelInfo, promptSnippet, 200)
          : undefined
        attempt = await ExecutionRuntime.admitModelCall({
          sessionID: input.sessionID,
          purpose: "execution_classification",
          execution: input.execution,
          estimateMicrousd,
        })
      } catch (err) {
        log.warn("classification model call admission rejected", { err })
        const contract = ExecutionContract.fallback("classifier_budget_exceeded")
        if (cacheKey) setCache(cacheKey, contract)
        return {
          contract,
          durationMs: Date.now() - started,
          cached: false,
          fallback: true,
        }
      }
    }

    const timeoutMs = input.timeoutMs ?? 2500
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combinedSignals = [input.signal, timeoutSignal]
    if (attempt?.signal) combinedSignals.push(attempt.signal)
    const combinedSignal = AbortSignal.any(combinedSignals.filter(Boolean))

    try {
      const { getGenerateObject } = await import("@/util/util/ai-compat")
      const generateObject = await getGenerateObject()

      const result = await generateObject({
        model: input.model,
        schema: ExecutionContract.Info,
        system: CLASSIFIER_SYSTEM_PROMPT,
        prompt: input.prompt.slice(0, 1000),
        abortSignal: combinedSignal,
        temperature: 0,
      })

      if (attempt) {
        let costUsd = 0
        if (input.modelInfo && result.usage) {
          const { ExecutionRuntime } = await import("@/core/execution/runtime")
          costUsd = ExecutionRuntime.usageCostUsd(input.modelInfo, result.usage)
        }
        attempt.settle(costUsd)
      }

      const contract = ExecutionContract.parseSafe(result.object)
      if (cacheKey) setCache(cacheKey, contract)
      const durationMs = Date.now() - started

      log.info("task classified", {
        scope: contract.scope,
        risk: contract.risk,
        confidence: contract.confidence,
        durationMs,
      })

      return {
        contract,
        durationMs,
        cached: false,
        fallback: false,
      }
    } catch (error) {
      attempt?.uncertain()
      const durationMs = Date.now() - started
      const reason = combinedSignal.aborted
        ? "classifier_timeout_or_abort"
        : `classifier_error: ${error instanceof Error ? error.message : String(error)}`

      log.warn("classification failed, falling back", { reason, durationMs })
      const contract = ExecutionContract.fallback(reason)
      if (cacheKey) setCache(cacheKey, contract)

      return {
        contract,
        durationMs,
        cached: false,
        fallback: true,
      }
    }
  }
}
