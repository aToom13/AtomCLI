import { Provider } from "../provider/provider"
import { Config } from "@/core/config/config"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "model-router" })

/**
 * Task categories that influence model selection.
 */
export type TaskCategory = "coding" | "documentation" | "analysis" | "general"

export type AutoMode = "speed" | "balanced" | "quality" | "reasoning"

export interface ModelState {
  modelID: string // Örn: "qwen/qwen3-235b-a22b"
  consecutiveFailures: number // Üst üste alınan hata sayısı
  lastError: number | null // Son hata timestamp'i
  recentLatenciesMs: number[] // Gerçek API gecikmeleri (Son 20 çağrı ring buffer)
  usageCount: number // Modelin kullanım sıklığı (Yük paylaştırma için)
  windowStart: number // Zaman penceresi başlangıcı
}

export const modelStates = new Map<string, ModelState>()

export function recordCallResult(modelID: string, ok: boolean, latencyMs?: number) {
  const s = modelStates.get(modelID) ?? {
    modelID,
    consecutiveFailures: 0,
    lastError: null,
    recentLatenciesMs: [],
    usageCount: 0,
    windowStart: Date.now(),
  }

  if (ok) {
    s.consecutiveFailures = 0
    if (latencyMs !== undefined) {
      s.recentLatenciesMs.push(latencyMs)
      if (s.recentLatenciesMs.length > 20) s.recentLatenciesMs.shift()
    }
  } else {
    s.consecutiveFailures++
    s.lastError = Date.now()
  }
  s.usageCount++
  modelStates.set(modelID, s)
}

/**
 * A model candidate with its score for a given category.
 */
interface ScoredModel {
  providerID: string
  modelID: string
  model: Provider.Model
  score: number
}

/**
 * Score a model for a specific task category.
 *
 * Higher score = better fit.
 * Returns 0 if the model lacks basic requirements (e.g., no toolcall for coding).
 */
function scoreModel(model: Provider.Model, category: TaskCategory, mode: AutoMode = "balanced"): number {
  let score = 0

  switch (category) {
    case "coding":
      // Coding needs tool calling
      if (!model.capabilities.toolcall) return 0
      // Reasoning is highly valuable for coding
      if (model.capabilities.reasoning) score += 50
      // Higher output limit is better for code generation
      score += Math.min((model.limit?.output ?? 0) / 1000, 30) // max 30pts
      // Moderate context is fine
      score += Math.min((model.limit?.context ?? 0) / 10000, 20) // max 20pts
      break

    case "documentation":
      // Documentation benefits from long context
      score += Math.min((model.limit?.context ?? 0) / 5000, 60) // max 60pts (heavily weighted)
      // Higher output for long docs
      score += Math.min((model.limit?.output ?? 0) / 1000, 25) // max 25pts
      // Reasoning helps structure docs but less critical
      if (model.capabilities.reasoning) score += 15
      break

    case "analysis":
      // Analysis needs reasoning
      if (model.capabilities.reasoning) score += 60
      // Context helps for analyzing large data
      score += Math.min((model.limit?.context ?? 0) / 10000, 25) // max 25pts
      // Tool calling is useful for analysis tasks
      if (model.capabilities.toolcall) score += 15
      break

    case "general":
    default:
      // Balanced scoring
      if (model.capabilities.toolcall) score += 25
      if (model.capabilities.reasoning) score += 25
      score += Math.min((model.limit?.context ?? 0) / 10000, 25)
      score += Math.min((model.limit?.output ?? 0) / 1000, 25)
      break
  }

  // Small bonus for active models
  if (model.status === "active") score += 5

  // Mode-based cost/reasoning adjustments
  const costPer1M = ((model.cost?.input ?? 0) + (model.cost?.output ?? 0)) / 2
  if (mode === "speed") {
    // Speed mode: penalise slow reasoning models, penalise cost more aggressively
    if (model.capabilities.reasoning) score -= 15
    if (costPer1M > 0) score -= Math.min(costPer1M * 1.5, 25)
  } else if (mode === "quality" || mode === "reasoning") {
    // Quality/reasoning: bonus for reasoning models, lenient cost penalty
    if (model.capabilities.reasoning) score += 25
    if (costPer1M > 0) score -= Math.min(costPer1M * 0.2, 4)
  } else {
    // balanced (default) — original formula
    if (costPer1M > 0) score -= Math.min(costPer1M * 0.5, 10)
  }

  return Math.max(score, 0)
}

export function estimateComplexity(prompt: string): number {
  let score = 0

  // Uzunluk: 1000 kelimeye kadar lineer artış
  score += Math.min(prompt.split(/\s+/).length / 100, 10)

  // Soru işareti sayısı (çok sorulu → daha az odaklı)
  score += Math.min((prompt.match(/\?/g) ?? []).length * 0.5, 3)

  // Teknik terim yoğunluğu (regex, API, schema, algorithm, ...)
  const techTerms = ["algorithm", "regex", "schema", "concurrent", "async", "recursive"]
  score += techTerms.filter((t) => prompt.toLowerCase().includes(t)).length

  // Kod bloğu varlığı
  if (/```/.test(prompt)) score += 2

  // Çoklu görev işareti ("ve ayrıca", "ardından", "then also")
  if (/\band\b|\bayrıca\b|\bardından\b/.test(prompt.toLowerCase())) score += 1.5

  return Math.min(score, 10) // 0-10 arası normalleştir
}

export interface WeightedKeyword {
  pattern: string | RegExp
  weight: number
}

export const CODING_PATTERNS: WeightedKeyword[] = [
  { pattern: "write code", weight: 2 },
  { pattern: "implement", weight: 1.5 },
  { pattern: "fix bug", weight: 2 },
  { pattern: "refactor", weight: 2 },
  { pattern: "function", weight: 1 },
  { pattern: "class", weight: 1 },
  { pattern: "module", weight: 1 },
  { pattern: "api", weight: 1.5 },
  { pattern: "endpoint", weight: 1.5 },
  { pattern: "test", weight: 1.5 },
  { pattern: "debug", weight: 2 },
  { pattern: "compile", weight: 1.5 },
  { pattern: "build", weight: 1.5 },
  { pattern: "syntax", weight: 1.5 },
  { pattern: "error", weight: 1 },
  { pattern: "bug", weight: 1.5 },
  { pattern: "feature", weight: 1 },
  { pattern: "kod yaz", weight: 2 },
  { pattern: "düzelt", weight: 2 },
  { pattern: "hata", weight: 1.5 },
  { pattern: "fonksiyon", weight: 1.5 },
  { pattern: "yaz", weight: 0.2 },
]

export const DOC_PATTERNS: WeightedKeyword[] = [
  { pattern: "document", weight: 2 },
  { pattern: "readme", weight: 2 },
  { pattern: "guide", weight: 2 },
  { pattern: "tutorial", weight: 2 },
  { pattern: "explain", weight: 1 },
  { pattern: "describe", weight: 1 },
  { pattern: "summary", weight: 1 },
  { pattern: "changelog", weight: 2 },
  { pattern: "release notes", weight: 2 },
  { pattern: "doküman", weight: 2 },
  { pattern: "belge", weight: 2 },
  { pattern: "açıkla", weight: 1.5 },
  { pattern: "özet", weight: 1.5 },
]

export const ANALYSIS_PATTERNS: WeightedKeyword[] = [
  { pattern: "analyze", weight: 2 },
  { pattern: "review", weight: 2 },
  { pattern: "audit", weight: 2 },
  { pattern: "inspect", weight: 1.5 },
  { pattern: "investigate", weight: 1.5 },
  { pattern: "compare", weight: 1.5 },
  { pattern: "evaluate", weight: 1.5 },
  { pattern: "assess", weight: 1.5 },
  { pattern: "benchmark", weight: 2 },
  { pattern: "analiz", weight: 2 },
  { pattern: "incele", weight: 2 },
  { pattern: "karşılaştır", weight: 2 },
]

export function scoreAgainstPatterns(prompt: string, patterns: WeightedKeyword[]): number {
  let score = 0
  const lower = prompt.toLowerCase()
  for (const p of patterns) {
    const isRegex = p.pattern instanceof RegExp
    const matches = isRegex ? (lower.match(p.pattern) ?? []).length : lower.includes(p.pattern as string) ? 1 : 0
    score += matches * p.weight
  }
  return score
}

export function inferCategoryMulti(prompt: string): { category: TaskCategory; confidence: number } {
  const scores = {
    coding: scoreAgainstPatterns(prompt, CODING_PATTERNS),
    documentation: scoreAgainstPatterns(prompt, DOC_PATTERNS),
    analysis: scoreAgainstPatterns(prompt, ANALYSIS_PATTERNS),
    general: 1, // Taban puan
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topCategory, topScore] = sorted[0]
  const runnerUpScore = sorted[1][1]
  const margin = topScore - runnerUpScore

  // Eğer en yüksek iki kategori birbirine çok yakınsa (margin farkı %30'dan azsa) belirsizlik vardır.
  // Bu durumda "general" kategorisine düşür.
  if (margin < topScore * 0.3) {
    return { category: "general", confidence: 0.4 }
  }

  return { category: topCategory as TaskCategory, confidence: margin / topScore }
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a task classifier. Classify the user's request into exactly ONE category.
Reply with ONLY the category name in lowercase, nothing else.

Categories:
- coding: Writing, fixing, refactoring, implementing, debugging, deploying code or scripts
- documentation: Writing docs, READMEs, guides, tutorials, changelogs, comments
- analysis: Code review, auditing, investigating, comparing, benchmarking, explaining how something works
- general: Greetings, questions, brainstorming, planning, or anything else`

/**
 * Pick the smallest/fastest free model to use as the semantic classifier.
 * Prefers non-reasoning models (faster) and smaller context windows (proxy for speed).
 */
export function pickClassifierModel(
  freeModels: Array<[string, Provider.Model]>,
): [string, Provider.Model] | null {
  const candidates = freeModels
    .filter(([, m]) => !m.capabilities.reasoning) // non-reasoning = faster
    .sort(([, a], [, b]) => (a.limit?.context ?? 0) - (b.limit?.context ?? 0))

  if (candidates.length > 0) return candidates[0]

  // Fallback: any free model, sorted by context size
  const all = [...freeModels].sort(([, a], [, b]) => (a.limit?.context ?? 0) - (b.limit?.context ?? 0))
  return all.length > 0 ? all[0] : null
}

/**
 * Semantic (LLM-based) task category classification.
 * Uses a small free model to understand the user's intent instead of keyword matching.
 * Falls back to keyword-based inferCategoryMulti() on any failure.
 */
export async function inferCategorySemantic(
  prompt: string,
  languageModel: any, // LanguageModelV2
): Promise<{ category: TaskCategory; confidence: number }> {
  try {
    const { getGenerateText } = await import("@/util/util/ai-compat")
    const generateText = await getGenerateText()

    const result = await generateText({
      model: languageModel,
      system: CLASSIFIER_SYSTEM_PROMPT,
      prompt: prompt.slice(0, 800), // Limit for speed
    })

    const raw = result.text.trim().toLowerCase().replace(/[^a-z]/g, "")

    // Exact match
    if (raw === "coding" || raw === "documentation" || raw === "analysis" || raw === "general") {
      log.info("semantic classification", { category: raw, prompt: prompt.slice(0, 80) })
      return { category: raw, confidence: 0.9 }
    }

    // Prefix match (model may add extra text)
    if (raw.startsWith("cod")) return { category: "coding", confidence: 0.85 }
    if (raw.startsWith("doc")) return { category: "documentation", confidence: 0.85 }
    if (raw.startsWith("ana")) return { category: "analysis", confidence: 0.85 }
    if (raw.startsWith("gen")) return { category: "general", confidence: 0.85 }

    log.warn("semantic classification: unrecognized response, falling back to keyword", { raw })
    return inferCategoryMulti(prompt)
  } catch (e) {
    log.warn("semantic classification failed, falling back to keyword", { error: (e as Error).message })
    return inferCategoryMulti(prompt)
  }
}

export function estimateRequiredContext(session: any, currentPrompt: string): number {
  const systemPromptTokens = session?.systemPromptTokenCount ?? 1500
  const toolSchemasTokens = session?.toolSchemaTokenCount ?? 3000
  const conversationHistoryTokens = session?.cumulativeTokenCount ?? 0
  const currentPromptTokens = Math.ceil(currentPrompt.length / 4) // 1 token ≈ 4 karakter
  const outputReserve = 2000 // Çıktı için ayrılan pay

  return systemPromptTokens + toolSchemasTokens + conversationHistoryTokens + currentPromptTokens + outputReserve
}

export function categoryHardOk(m: Provider.Model, category: TaskCategory): boolean {
  if (category === "coding" && !m.capabilities.toolcall) return false
  if (category === "analysis" && !m.capabilities.reasoning) return false
  return true
}

export function selectCandidates(
  freeModels: Array<[string, Provider.Model]>,
  category: TaskCategory,
  autoRouterConfig?: { excluded_models?: string[] },
): Array<[string, Provider.Model]> {
  if (freeModels.length === 0) {
    throw new Error("NoFreeModelsError: Kullanılabilir hiçbir ücretsiz model bulunamadı!")
  }

  const tiers = [
    // Tier 0: Görev kategorisi tam karşılanıyor VE model sağlıklı (hata yok)
    (id: string, m: Provider.Model) =>
      categoryHardOk(m, category) && (modelStates.get(id)?.consecutiveFailures ?? 0) === 0,

    // Tier 1: Görev kategorisi tam karşılanıyor (sağlık durumu ne olursa olsun)
    (id: string, m: Provider.Model) => categoryHardOk(m, category),

    // Tier 2: Görev kategorisi "general" olarak gevşetiliyor VE model sağlıklı
    (id: string, m: Provider.Model) =>
      categoryHardOk(m, "general") && (modelStates.get(id)?.consecutiveFailures ?? 0) === 0,

    // Tier 3: Elimizde kalan ne varsa (Tier 3 her zaman true döner)
    (id: string, m: Provider.Model) => true,
  ]

  for (const check of tiers) {
    let candidates = freeModels.filter(([id, m]) => check(id, m))
    // Kullanıcı exclude ettiyse, adaylardan çıkar
    if (candidates.length > 0 && autoRouterConfig?.excluded_models?.length) {
      const filtered = candidates.filter(([id]) => !autoRouterConfig.excluded_models!.includes(id))
      if (filtered.length > 0) candidates = filtered
      // Tüm modeller exclude edildiyse exclude'u yok say (kullanıcı hepsini engelleyemez)
    }
    if (candidates.length > 0) return candidates
  }

  return freeModels // Fallback
}

export const MODE_WEIGHTS = {
  speed: { context: 0.1, output: 0.1, toolcall: 0.3, reasoning: 0.0, latency: 1.5 },
  balanced: { context: 0.3, output: 0.3, toolcall: 0.5, reasoning: 0.5, latency: 1.0 },
  quality: { context: 0.5, output: 0.5, toolcall: 0.8, reasoning: 1.5, latency: 0.5 },
  reasoning: { context: 0.3, output: 0.3, toolcall: 0.5, reasoning: 3.0, latency: 0.2 },
}

export function finalScore(
  id: string,
  m: Provider.Model,
  category: TaskCategory,
  mode: AutoMode,
  complexity: number = 0,
  autoRouterConfig?: { model_ratings?: Record<string, Record<string, number>> },
): number {
  // 1. Temel puanlama (saf yetenekler) — mode-aware
  const base = scoreModel(m, category, mode)
  const w = MODE_WEIGHTS[mode]

  // 2. Mod ağırlıklı yetenek bonusları (toolcall çarpanı dahil edildi)
  let score =
    base * (1 + w.reasoning * (m.capabilities.reasoning ? 1.5 : 0)) +
    w.context * Math.min((m.limit?.context ?? 0) / 10000, 20) +
    w.output * Math.min((m.limit?.output ?? 0) / 1000, 20) +
    w.toolcall * (m.capabilities.toolcall ? 20 : 0)

  // 3. Karmaşıklık (Complexity) etkisi: >= 7 ise reasoning modellerine ek bonus
  if (complexity >= 7 && m.capabilities.reasoning) {
    score += 40
  }

  // 4. Dinamik Latency Cezası (models.dev'de hız verisi yoktur, in-memory ModelState'ten ölçülür)
  const state = modelStates.get(id)
  let avgLat =
    state && state.recentLatenciesMs.length > 0
      ? state.recentLatenciesMs.reduce((a, b) => a + b, 0) / state.recentLatenciesMs.length
      : null

  // İlk çalıştırmada veri yoksa context limit'ini zayıf bir proxy (küçük model = hızlı) olarak kullan
  if (avgLat === null) {
    avgLat = ((m.limit?.context ?? 0) / 1000) * 10 // Örn: 128k ctx -> 1280ms varsayılan
  }
  score -= w.latency * (avgLat / 1000)

  // 5. Yumuşak Sağlık Cezası (Soft Penalty - ModelID bazlı)
  const failures = state?.consecutiveFailures ?? 0
  score -= failures * 15

  // 6. Kullanıcı Rating Çarpanı (auto_router.model_ratings, -3..+3)
  const userRating = autoRouterConfig?.model_ratings?.[id]?.[category] ?? 0
  score += userRating * 15 // -45 ile +45 arası bonus/ceza

  return Math.max(score, 0)
}

function pickWithLoadBalancing(
  ranked: Array<{ id: string; m: Provider.Model; score: number }>,
  poolSize: number,
): { id: string; m: Provider.Model; score: number } {
  const topN = poolSize <= 3 ? ranked.length : Math.max(2, Math.ceil(poolSize * 0.3))
  const pool = ranked.slice(0, topN)

  const weights = pool.map((c) => {
    const usage = modelStates.get(c.id)?.usageCount ?? 0
    return c.score / (1 + usage * 0.5)
  })

  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * totalWeight

  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[0]
}

export interface ModelSelectionResult {
  selected: { id: string; m: Provider.Model; score: number }
  ranked: Array<{ id: string; m: Provider.Model; score: number }>
}

export function selectModelInternal(
  category: TaskCategory,
  allFreeModels: Array<[string, Provider.Model]>,
  mode: AutoMode = "balanced",
  complexity = 0,
  session?: any,
  prompt?: string,
  autoRouterConfig?: any,
): ModelSelectionResult {
  // Category override: kullanıcı belirli bir model sabitlemişse direkt onu seç
  const override = autoRouterConfig?.category_overrides?.[category]
  if (override) {
    const model = allFreeModels.find(([id]) => id === override)
    if (model) {
      return {
        selected: { id: model[0], m: model[1], score: 999 },
        ranked: [{ id: model[0], m: model[1], score: 999 }],
      }
    }
  }

  let filtered = allFreeModels
  if (session && prompt) {
    const requiredContext = estimateRequiredContext(session, prompt)
    filtered = allFreeModels.filter(([, m]) => (m.limit?.context ?? 0) >= requiredContext)
  }

  const pool = filtered.length > 0 ? filtered : allFreeModels
  const candidates = selectCandidates(pool, category, autoRouterConfig)

  const ranked = candidates
    .map(([id, m]) => ({ id, m, score: finalScore(id, m, category, mode, complexity, autoRouterConfig) }))
    .sort((a, b) => b.score - a.score)

  const selected = pickWithLoadBalancing(ranked, candidates.length)

  return { selected, ranked }
}

export function buildFallbackChain(
  category: TaskCategory,
  allFreeModels: Array<[string, Provider.Model]>,
  mode: AutoMode = "balanced",
  complexity = 0,
  session?: any,
  prompt?: string,
  autoRouterConfig?: any,
) {
  const { selected, ranked } = selectModelInternal(
    category,
    allFreeModels,
    mode,
    complexity,
    session,
    prompt,
    autoRouterConfig,
  )

  const fallbacks = ranked
    .filter((x) => x.id !== selected.id)
    .slice(0, 2)
    .map((x) => ({ providerID: "atomcli", modelID: x.id }))

  return {
    primary: { providerID: "atomcli", modelID: selected.id },
    fallbacks,
    reason: `category=${category}, mode=${mode}, finalScore=${selected.score.toFixed(1)}`,
  }
}

/**
 * Select the best model for a given task category.
 * Supports overloaded signatures:
 * 1. selectModel(category, fallback)
 * 2. selectModel(category, allFreeModels, mode, complexity, session, prompt)
 */
export async function selectModel(
  category: TaskCategory,
  allFreeModelsOrFallback: Array<[string, Provider.Model]> | { providerID: string; modelID: string },
  mode: AutoMode = "balanced",
  complexity = 0,
  session?: any,
  prompt?: string,
): Promise<any> {
  if (!Array.isArray(allFreeModelsOrFallback)) {
    // Old signature: selectModel(category, fallback)
    const fallback = allFreeModelsOrFallback
    const config = await Config.get()

    if (!config.experimental?.smart_model_routing) {
      return fallback
    }

    try {
      const providers = await Provider.list()
      const atomcliProvider = providers["atomcli"]
      let freeModels: Array<[string, Provider.Model]> = []
      if (atomcliProvider) {
        freeModels = Object.entries(atomcliProvider.models).filter(
          ([id]) => id !== "atomcli-auto" && id !== "atomcli-free",
        )
      } else {
        for (const [pID, p] of Object.entries(providers)) {
          for (const [mID, m] of Object.entries(p.models)) {
            if (m.cost?.input === 0 && m.cost?.output === 0 && mID !== "atomcli-auto" && mID !== "atomcli-free") {
              freeModels.push([mID, m])
            }
          }
        }
      }

      const configMode = config.experimental?.auto_mode ?? "quality"

      // Resolve active session & prompt
      let activeSession = session
      let promptText = prompt ?? ""
      if (!activeSession) {
        const { Session } = await import("@/core/session")
        for await (const s of Session.list()) {
          if (!activeSession || s.time.updated > activeSession.time.updated) {
            activeSession = s
          }
        }
        if (activeSession && !promptText) {
          const messages = await Session.messages({ sessionID: activeSession.id })
          const lastUser = [...messages].reverse().find((m) => m.info.role === "user")
          if (lastUser) {
            promptText = lastUser.parts
              .filter((p: any) => p.type === "text" && !p.synthetic)
              .map((p: any) => p.text)
              .join("\n")
          }
        }
      }

      const comp = promptText ? estimateComplexity(promptText) : 0
      const autoRouterConfig = config.experimental?.auto_router
      const result = selectModelInternal(
        category,
        freeModels,
        configMode,
        comp,
        activeSession,
        promptText,
        autoRouterConfig,
      )

      log.info("model selected", {
        category,
        selected: `atomcli/${result.selected.id}`,
        score: result.selected.score,
        candidates: result.ranked.length,
      })

      return { providerID: "atomcli", modelID: result.selected.id }
    } catch (e) {
      log.warn("model routing failed, using fallback", { error: (e as Error).message })
      return fallback
    }
  } else {
    // New signature: selectModel(category, allFreeModels, mode, complexity, session, prompt)
    return selectModelInternal(category, allFreeModelsOrFallback, mode, complexity, session, prompt)
  }
}

/**
 * Infer task category from a prompt string.
 * Uses keyword matching for fast, offline categorization.
 */
export function inferCategory(prompt: string): TaskCategory {
  const lower = prompt.toLowerCase()

  const codingKeywords = [
    "write code",
    "implement",
    "fix bug",
    "refactor",
    "function",
    "class",
    "module",
    "api",
    "endpoint",
    "test",
    "debug",
    "compile",
    "build",
    "syntax",
    "error",
    "bug",
    "feature",
    "kod yaz",
    "düzelt",
    "hata",
    "fonksiyon",
  ]

  const docKeywords = [
    "document",
    "readme",
    "guide",
    "tutorial",
    "explain",
    "describe",
    "summary",
    "changelog",
    "release notes",
    "doküman",
    "belge",
    "açıkla",
    "özet",
  ]

  const analysisKeywords = [
    "analyze",
    "review",
    "audit",
    "inspect",
    "investigate",
    "compare",
    "evaluate",
    "assess",
    "benchmark",
    "analiz",
    "incele",
    "karşıla",
  ]

  const codingScore = codingKeywords.filter((k) => lower.includes(k)).length
  const docScore = docKeywords.filter((k) => lower.includes(k)).length
  const analysisScore = analysisKeywords.filter((k) => lower.includes(k)).length

  if (codingScore > docScore && codingScore > analysisScore) return "coding"
  if (docScore > codingScore && docScore > analysisScore) return "documentation"
  if (analysisScore > codingScore && analysisScore > docScore) return "analysis"

  return "general"
}

// Export internals for testing
export const _internals = {
  scoreModel,
  inferCategory,
  scoreAgainstPatterns,
  inferCategoryMulti,
  estimateComplexity,
  selectCandidates,
  pickWithLoadBalancing,
}
