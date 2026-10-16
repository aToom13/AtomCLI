import { Log } from "@/util/util/log"
import type { LanguageModel } from "ai"
import type { Provider } from "@/integrations/provider/provider"
import type { ExecutionRuntime } from "@/core/execution/runtime"
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
    explicitOrchestration?: boolean
    scopeFloor?: ExecutionContract.Scope
    model?: LanguageModel
    modelInfo?: Provider.Model
    sessionID?: string
    execution?: ExecutionRuntime.Context
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
Return only a JSON object with required fields: "intent" ("answer"|"inspect"|"change"|"operate"|"design"), "scope" ("direct"|"focused"|"coordinated"), and "confidence" (number from 0 to 1). Use these exact field names and enum values. Optional fields: "risk" ("low"|"elevated"|"critical"), "deliverables" (string array), "acceptance" (up to 16 concise observable outcomes explicitly requested by the user), "expectedSurfaces" (array of "conversation"|"workspace"|"system"|"network"|"browser"|"remote"), "assumptions" (string array), "uncertainty" ("low"|"material"|"blocking"), "needsDiscovery", "needsMutation", "needsExternalAction", "likelyCrossBoundary" (booleans), and "rationale" (string). Do not invent fields, requirements or alternate labels.
Classification guidelines:
- scope:
  * "direct": single direct question/answer, single read, single local transformation, no repository-wide discovery, <= 2 steps.
  * "focused": localized bug fix, small feature, 1-4 files in single module/subsystem, targeted verification.
  * "coordinated": multiple independent tasks, cross-subsystem or cross-package changes, wide refactoring, or a complete interactive app/game with several acceptance criteria. A localized public API/schema/migration edit may stay focused; classify its risk separately.
- risk:
  * "low": read-only operations, safe reversible local inspect/explain, no side-effects.
  * "elevated": typical source modifications, config edits, refactors needing tests.
  * "critical": auth, credentials, permissions, DB migrations, persistent schema, CI/release workflows, irreversible changes, public API breaking changes.
- uncertainty: "low" if request is specific and clear, "material" if exploratory, "blocking" if requirements are missing.`

  const READ_ONLY_START =
    /^(?:please\s+)?(?:what is|what's|how does|how to|why|explain|define|describe|compare|summarize|analyse|analyze|review|inspect|neden|nedir|nasıl|açıkla|anlat|karşılaştır|özetle|incele)(?=\s|\?|$)/i
  const FOLLOWUP = /[,;]|\b(?:and|then|after that|ve)\b|sonra|ardından/i
  const MUTATION_VERB =
    /^(?:then\s+)?(?:fix|change|edit|create|build|implement|write|generate|code|make|update|improve|refactor|remove|add|düzelt|oluştur|yap|geliştir|kodla|değiştir|düzenle|ekle|sil)(?=\s|$)/i
  const WORKSPACE_MENTION = /\b(?:repo|repository|project|file|code|workspace)\b|proje|dosya|kod|depo/i
  const SIMPLE_EXPLANATION = /^(?:please\s+)?(?:what is|what's|explain|define|nedir|açıkla)(?=\s|\?|$)/i
  const COMPLEX_TOPIC =
    /\b(?:game|browser|app|application|architecture|design|3d|complete|full|system)\b|oyun|uygulama|tasarım|mimari/i

  function readOnlyRequest(prompt: string) {
    if (!READ_ONLY_START.test(prompt)) return false
    return !prompt
      .split(FOLLOWUP)
      .slice(1)
      .some((part) => MUTATION_VERB.test(part.trim()))
  }

  function fastPath(input: Input): ExecutionContract.Info | undefined {
    const prompt = input.prompt.trim().toLowerCase()
    if (!prompt || input.explicitOrchestration || input.scopeFloor === "coordinated") return undefined

    if (/^(hi|hello|hey|selam|merhaba|thanks|thank you|teşekkürler)[!.\s]*$/.test(prompt)) {
      return ExecutionContract.parseSafe({
        intent: "answer",
        scope: "direct",
        risk: "low",
        confidence: 0.99,
        expectedSurfaces: ["conversation"],
        rationale: "deterministic conversational fast path",
      })
    }

    if (
      prompt.length <= 80 &&
      SIMPLE_EXPLANATION.test(prompt) &&
      readOnlyRequest(prompt) &&
      !WORKSPACE_MENTION.test(prompt) &&
      !COMPLEX_TOPIC.test(prompt)
    ) {
      return ExecutionContract.parseSafe({
        intent: "answer",
        scope: "direct",
        risk: "low",
        confidence: 0.9,
        expectedSurfaces: ["conversation"],
        rationale: "deterministic simple explanation fast path",
      })
    }

    return undefined
  }

  function fallbackContract(prompt: string, reason: string): ExecutionContract.Info {
    if (!readOnlyRequest(prompt)) return enforceComplexity(prompt, ExecutionContract.fallback(reason))
    const workspace = WORKSPACE_MENTION.test(prompt)
    return enforceComplexity(
      prompt,
      ExecutionContract.fallback(reason, {
        intent: workspace ? "inspect" : "answer",
        scope: workspace ? "focused" : "direct",
        risk: "low",
        expectedSurfaces: workspace ? ["workspace"] : ["conversation"],
        needsDiscovery: workspace,
        needsMutation: false,
      }),
    )
  }

  /**
   * Keep broad build requests from being under-scoped when the classifier
   * returns an optimistic focused contract. These tasks need room for
   * implementation, runtime verification, and independent QA.
   */
  export function enforceComplexity(prompt: string, contract: ExecutionContract.Info): ExecutionContract.Info {
    const text = prompt.toLowerCase()
    const acceptance = ExecutionContract.acceptanceFor(prompt)
    contract = {
      ...contract,
      acceptance: contract.intent === "answer" ? undefined : acceptance.length ? acceptance : contract.acceptance,
      acceptanceRevision: undefined,
      acceptanceChange: undefined,
    }
    if (
      contract.intent !== "answer" &&
      /\b(?:run|execute)\s+(?:the\s+)?(?:bash|shell)\s+command\b|(?:bash|shell)\s+komutunu\s+çalıştır/i.test(prompt)
    ) {
      contract = {
        ...contract,
        scope: contract.scope === "direct" ? "focused" : contract.scope,
        expectedSurfaces: [...new Set([...contract.expectedSurfaces, "system" as const])],
      }
    }
    // ponytail: explicit operation names select the surface; extend names only for supported operations.
    if (
      contract.intent !== "answer" &&
      /\b(?:browser (?:tool|flows?|navigation|verification)|chromium|playwright|input_sequence)\b|tarayıcı aracı/.test(
        text,
      )
    ) {
      contract = {
        ...contract,
        scope: contract.scope === "direct" ? "focused" : contract.scope,
        expectedSurfaces: [...new Set([...contract.expectedSurfaces, "browser" as const])],
        needsExternalAction: true,
      }
    }
    if (readOnlyRequest(text)) return contract
    const browser = /\b(?:browser|chrome|html|css|javascript|web\s*(?:app|os|desktop|game)|playwright)\b|tarayıcı/.test(
      text,
    )
    const game = /\b(?:game|gameplay|skateboard|skateboarding|gta|3d|physics|playable|trick|npc|camera)\b|oyun/.test(
      text,
    )
    const multiSurface =
      /\b(?:at\s+least\s+\d+|multiple|five|six|complete|full|self-contained|single[- ]file|compile\s+and\s+run|no\s+setup)\b|en\s+az\s+\d+|birden\s+fazla|tek\s+dosya/.test(
        text,
      )
    const complex =
      (game && multiSurface) ||
      (browser && multiSurface && /\b(?:app|application|os|desktop|game)\b|uygulama|masaüstü|oyun/.test(text))
    if (!complex) return contract
    const expectedSurfaces = [
      ...new Set([...(contract.expectedSurfaces ?? []), ...(browser ? ["browser" as const] : ["workspace" as const])]),
    ]
    return {
      ...contract,
      scope: "coordinated",
      risk: contract.risk === "critical" ? "critical" : "elevated",
      expectedSurfaces,
      needsDiscovery: true,
      needsMutation: true,
      rationale:
        `${contract.rationale}; complex interactive deliverable requires coordinated build and independent verification`.slice(
          0,
          500,
        ),
    }
  }

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
    const cacheKey = [
      input.invocationID ?? input.prompt.trim(),
      `floor=${input.scopeFloor ?? "none"}`,
      `explicit=${input.explicitOrchestration === true ? "yes" : "no"}`,
      `agent=${input.agentMode ?? "default"}`,
    ].join("|")

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

    const fast = fastPath(input)
    if (fast) {
      if (cacheKey) setCache(cacheKey, fast)
      return { contract: fast, durationMs: Date.now() - started, cached: false, fallback: false }
    }

    if (!input.model) {
      const contract = fallbackContract(input.prompt, "no_model_available")
      return {
        contract,
        durationMs: Date.now() - started,
        cached: false,
        fallback: true,
      }
    }

    let attempt: Awaited<ReturnType<typeof ExecutionRuntime.admitModelCall>> | undefined
    if (input.sessionID && input.execution) {
      try {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const estimateMicrousd = input.modelInfo
          ? ExecutionRuntime.estimateMicrousd(input.modelInfo, input.prompt, 200)
          : undefined
        attempt = await ExecutionRuntime.admitModelCall({
          sessionID: input.sessionID,
          purpose: "execution_classification",
          execution: input.execution,
          estimateMicrousd,
        })
      } catch (err) {
        log.warn("classification model call admission rejected", { err })
        const contract = fallbackContract(input.prompt, "classifier_budget_exceeded")
        return {
          contract,
          durationMs: Date.now() - started,
          cached: false,
          fallback: true,
        }
      }
    }

    // Providers may hide reasoning latency in model metadata. Keep one bounded
    // ceiling high enough for schema-valid output without allowing an unbounded
    // pre-execution wait.
    const timeoutMs = input.timeoutMs ?? 8000
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
        prompt: `${input.prompt}\n\nExecution hints: minimum scope=${input.scopeFloor ?? "none"}; explicit orchestration request=${input.explicitOrchestration === true ? "yes" : "no"}.`,
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

      const contract = enforceComplexity(input.prompt, ExecutionContract.parseSafe(result.object))
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
      const contract = fallbackContract(input.prompt, reason)

      return {
        contract,
        durationMs,
        cached: false,
        fallback: true,
      }
    }
  }
}
