/**
 * LLM-based Reranker
 * 
 * Uses atomcli free models to rerank BM25 search results for better semantic relevance.
 * Fallback chain: minimax → glm → trinity → gpt-5-nano → big-pickle
 * 
 * If all models fail or timeout, falls back to original BM25 ordering.
 */

import { Log } from "@/util/util/log"
import { Provider } from "@/integrations/provider/provider"
import { getGenerateText } from "@/util/util/ai-compat"

const log = Log.create({ service: "memory.reranker" })

// ============================================================================
// FALLBACK CHAIN
// ============================================================================

const RERANKER_FALLBACK_CHAIN = [
    { provider: "atomcli", model: "minimax-m2.5-free" },
    { provider: "atomcli", model: "glm-5-free" },
    { provider: "atomcli", model: "trinity-large-preview-free" },
    { provider: "atomcli", model: "gpt-5-nano" },
    { provider: "atomcli", model: "big-pickle" },
]

/** Max time to wait for LLM reranking before falling back to BM25 order */
const RERANK_TIMEOUT_MS = 5000

// ============================================================================
// RERANKER
// ============================================================================

export interface RerankCandidate {
    id: string
    content: string
    score?: number  // Original BM25 score
}

export interface RerankResult {
    id: string
    score: number
    rerankScore: number
}

/**
 * Get a working model from the fallback chain
 */
async function getWorkingModel() {
    for (const entry of RERANKER_FALLBACK_CHAIN) {
        try {
            const model = await Provider.getModel(entry.provider, entry.model)
            if (model) {
                log.info("Selected reranker model", { model: `${entry.provider}/${entry.model}` })
                return model
            }
        } catch {
            // Try next
        }
    }
    return null
}

/**
 * Rerank BM25 candidates using LLM
 * 
 * @param query - The search query
 * @param candidates - BM25 results to rerank  
 * @param limit - How many results to return
 * @returns Reranked results, or original candidates if LLM fails
 */
export async function rerank(
    query: string,
    candidates: RerankCandidate[],
    limit: number = 5
): Promise<RerankResult[]> {
    // If too few candidates, no point in reranking
    if (candidates.length <= limit) {
        return candidates.map((c, i) => ({
            id: c.id,
            score: c.score || 0,
            rerankScore: candidates.length - i,  // Preserve order
        }))
    }

    try {
        const model = await getWorkingModel()
        if (!model) {
            log.warn("No reranker model available, using BM25 order")
            return candidates.slice(0, limit).map((c, i) => ({
                id: c.id,
                score: c.score || 0,
                rerankScore: candidates.length - i,
            }))
        }

        const language = await Provider.getLanguage(model)
        const generateText = await getGenerateText()

        // Build prompt with numbered candidates
        const candidateList = candidates
            .map((c, i) => `[${i}] ${c.content.substring(0, 200)}`)
            .join("\n")

        const prompt = `Given the search query and candidate results below, rank the candidates by relevance.
Return ONLY a JSON array of indices sorted by relevance (most relevant first).
Example: [2, 0, 4, 1, 3]

Query: "${query}"

Candidates:
${candidateList}

Return ONLY the JSON array, no explanation.`

        // Race between LLM call and timeout
        const result = await Promise.race([
            generateText({
                model: language,
                messages: [{ role: "user", content: prompt }],
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), RERANK_TIMEOUT_MS)),
        ])

        if (!result || !("text" in result)) {
            log.warn("Reranker timed out, using BM25 order")
            return candidates.slice(0, limit).map((c, i) => ({
                id: c.id,
                score: c.score || 0,
                rerankScore: candidates.length - i,
            }))
        }

        // Parse LLM response 
        const text = result.text.trim()
        const jsonMatch = text.match(/\[[\d,\s]+\]/)

        if (!jsonMatch) {
            log.warn("Failed to parse reranker response", { text })
            return candidates.slice(0, limit).map((c, i) => ({
                id: c.id,
                score: c.score || 0,
                rerankScore: candidates.length - i,
            }))
        }

        const indices: number[] = JSON.parse(jsonMatch[0])
        const validIndices = indices.filter(i => i >= 0 && i < candidates.length)

        log.info("Reranked results", {
            query,
            original: candidates.map(c => c.id).slice(0, 5),
            reranked: validIndices.slice(0, limit),
        })

        // Build reranked results
        const reranked: RerankResult[] = []
        const seen = new Set<number>()

        for (const idx of validIndices) {
            if (seen.has(idx)) continue
            seen.add(idx)

            reranked.push({
                id: candidates[idx].id,
                score: candidates[idx].score || 0,
                rerankScore: validIndices.length - reranked.length,
            })

            if (reranked.length >= limit) break
        }

        // If LLM returned fewer results than needed, fill with remaining BM25 results
        if (reranked.length < limit) {
            for (let i = 0; i < candidates.length && reranked.length < limit; i++) {
                if (!seen.has(i)) {
                    reranked.push({
                        id: candidates[i].id,
                        score: candidates[i].score || 0,
                        rerankScore: 0,
                    })
                }
            }
        }

        return reranked

    } catch (error) {
        log.warn("Reranker failed, using BM25 order", { error })
        return candidates.slice(0, limit).map((c, i) => ({
            id: c.id,
            score: c.score || 0,
            rerankScore: candidates.length - i,
        }))
    }
}

export const LLMReranker = { rerank }
export default LLMReranker
