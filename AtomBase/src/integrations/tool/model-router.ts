import { Provider } from "../provider/provider"
import { Config } from "@/core/config/config"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "model-router" })

/**
 * Task categories that influence model selection.
 */
export type TaskCategory = "coding" | "documentation" | "analysis" | "general"

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
function scoreModel(model: Provider.Model, category: TaskCategory): number {
    let score = 0

    switch (category) {
        case "coding":
            // Coding needs tool calling
            if (!model.capabilities.toolcall) return 0
            // Reasoning is highly valuable for coding
            if (model.capabilities.reasoning) score += 50
            // Higher output limit is better for code generation
            score += Math.min(model.limit.output / 1000, 30) // max 30pts
            // Moderate context is fine
            score += Math.min(model.limit.context / 10000, 20) // max 20pts
            break

        case "documentation":
            // Documentation benefits from long context
            score += Math.min(model.limit.context / 5000, 60) // max 60pts (heavily weighted)
            // Higher output for long docs
            score += Math.min(model.limit.output / 1000, 25) // max 25pts
            // Reasoning helps structure docs but less critical
            if (model.capabilities.reasoning) score += 15
            break

        case "analysis":
            // Analysis needs reasoning
            if (model.capabilities.reasoning) score += 60
            // Context helps for analyzing large data
            score += Math.min(model.limit.context / 10000, 25) // max 25pts
            // Tool calling is useful for analysis tasks
            if (model.capabilities.toolcall) score += 15
            break

        case "general":
        default:
            // Balanced scoring
            if (model.capabilities.toolcall) score += 25
            if (model.capabilities.reasoning) score += 25
            score += Math.min(model.limit.context / 10000, 25)
            score += Math.min(model.limit.output / 1000, 25)
            break
    }

    // Small bonus for active models
    if (model.status === "active") score += 5

    // Cost penalty: prefer cheaper models when scores are close
    // Normalize cost to a 0-10 penalty range
    const costPer1M = (model.cost.input + model.cost.output) / 2
    if (costPer1M > 0) {
        score -= Math.min(costPer1M * 0.5, 10)
    }

    return Math.max(score, 0)
}

/**
 * Select the best model for a given task category.
 *
 * When smart_model_routing is disabled, returns the fallback model unchanged.
 * When enabled, scores all available models and picks the best one.
 */
export async function selectModel(
    category: TaskCategory,
    fallback: { providerID: string; modelID: string },
): Promise<{ providerID: string; modelID: string }> {
    const config = await Config.get()

    // If smart routing is disabled, use fallback
    if (!config.experimental?.smart_model_routing) {
        return fallback
    }

    try {
        const providers = await Provider.list()
        const candidates: ScoredModel[] = []

        for (const [providerID, provider] of Object.entries(providers)) {
            for (const [modelID, model] of Object.entries(provider.models)) {
                // Skip models that can't do text output
                if (!model.capabilities.output.text) continue
                // Skip alpha/deprecated
                if (model.status === "deprecated") continue

                const score = scoreModel(model, category)
                if (score > 0) {
                    candidates.push({ providerID, modelID, model, score })
                }
            }
        }

        if (candidates.length === 0) {
            log.warn("no suitable model found, using fallback", { category, fallback })
            return fallback
        }

        // Sort by score (descending), take the best
        candidates.sort((a, b) => b.score - a.score)
        const best = candidates[0]

        log.info("model selected", {
            category,
            selected: `${best.providerID}/${best.modelID}`,
            score: best.score,
            candidates: candidates.length,
        })

        return { providerID: best.providerID, modelID: best.modelID }
    } catch (e) {
        log.warn("model routing failed, using fallback", { error: (e as Error).message })
        return fallback
    }
}

/**
 * Infer task category from a prompt string.
 * Uses keyword matching for fast, offline categorization.
 */
export function inferCategory(prompt: string): TaskCategory {
    const lower = prompt.toLowerCase()

    const codingKeywords = [
        "write code", "implement", "fix bug", "refactor", "function",
        "class", "module", "api", "endpoint", "test", "debug",
        "compile", "build", "syntax", "error", "bug", "feature",
        "kod yaz", "düzelt", "hata", "fonksiyon",
    ]

    const docKeywords = [
        "document", "readme", "guide", "tutorial", "explain",
        "describe", "summary", "changelog", "release notes",
        "doküman", "belge", "açıkla", "özet",
    ]

    const analysisKeywords = [
        "analyze", "review", "audit", "inspect", "investigate",
        "compare", "evaluate", "assess", "benchmark",
        "analiz", "incele", "karşıla",
    ]

    const codingScore = codingKeywords.filter(k => lower.includes(k)).length
    const docScore = docKeywords.filter(k => lower.includes(k)).length
    const analysisScore = analysisKeywords.filter(k => lower.includes(k)).length

    if (codingScore > docScore && codingScore > analysisScore) return "coding"
    if (docScore > codingScore && docScore > analysisScore) return "documentation"
    if (analysisScore > codingScore && analysisScore > docScore) return "analysis"

    return "general"
}

// Export internals for testing
export const _internals = {
    scoreModel,
    inferCategory,
}
