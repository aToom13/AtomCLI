/**
 * BM25 Search Engine
 * 
 * Lightweight, zero-dependency BM25 implementation for semantic-ish text search.
 * Replaces simple string.includes() with proper term frequency scoring.
 * 
 * Supports Turkish and English text tokenization.
 */

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.bm25" })

// ============================================================================
// TOKENIZER
// ============================================================================

/** Common stop words for Turkish and English */
const STOP_WORDS = new Set([
    // English
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "between", "out", "off",
    "over", "under", "again", "further", "then", "once", "and", "but", "or",
    "nor", "not", "so", "if", "than", "too", "very", "just", "about", "this",
    "that", "these", "those", "it", "its", "i", "me", "my", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "they", "them", "their",
    // Turkish
    "bir", "ve", "bu", "da", "de", "ile", "için", "olan", "gibi", "daha",
    "en", "çok", "var", "yok", "ne", "mi", "mu", "mü", "mı", "ama",
    "fakat", "ancak", "veya", "ya", "hem", "ki", "ben", "sen", "o",
    "biz", "siz", "onlar", "benim", "senin", "onun",
])

/**
 * Tokenize text into normalized terms
 */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")  // Keep letters+numbers, replace rest with space
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

// ============================================================================
// BM25 IMPLEMENTATION
// ============================================================================

/** BM25 tuning parameters */
const K1 = 1.5   // Term saturation parameter
const B = 0.75   // Length normalization parameter

export interface BM25Document {
    id: string
    text: string
    tokens?: string[]  // Pre-computed tokens (optional cache)
}

export interface BM25Result {
    id: string
    score: number
}

/**
 * Build BM25 index from documents and search
 */
export function bm25Search(query: string, documents: BM25Document[], limit: number = 10): BM25Result[] {
    if (documents.length === 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    // Tokenize all documents
    const docTokensList = documents.map(d => d.tokens || tokenize(d.text))

    // Calculate average document length
    const totalLength = docTokensList.reduce((sum, t) => sum + t.length, 0)
    const avgDl = totalLength / documents.length

    // Calculate IDF for each query term
    const N = documents.length
    const idf = new Map<string, number>()

    for (const term of queryTokens) {
        // Count documents containing this term
        let df = 0
        for (const docTokens of docTokensList) {
            if (docTokens.includes(term)) df++
        }
        // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
        idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1))
    }

    // Score each document
    const results: BM25Result[] = []

    for (let i = 0; i < documents.length; i++) {
        const docTokens = docTokensList[i]
        const dl = docTokens.length
        let score = 0

        for (const term of queryTokens) {
            const termIdf = idf.get(term) || 0

            // Term frequency in this document
            const tf = docTokens.filter(t => t === term).length

            // BM25 score for this term
            const numerator = tf * (K1 + 1)
            const denominator = tf + K1 * (1 - B + B * (dl / avgDl))

            score += termIdf * (numerator / denominator)
        }

        if (score > 0) {
            results.push({ id: documents[i].id, score })
        }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
}

/**
 * Quick BM25 relevance score between a query and a single text
 * Useful for inline scoring without building a full index
 */
export function bm25Score(query: string, text: string): number {
    const queryTokens = tokenize(query)
    const docTokens = tokenize(text)

    if (queryTokens.length === 0 || docTokens.length === 0) return 0

    let score = 0
    for (const term of queryTokens) {
        const tf = docTokens.filter(t => t === term).length
        if (tf === 0) continue

        // Simplified BM25 for single document (IDF=1)
        const numerator = tf * (K1 + 1)
        const denominator = tf + K1 * (1 - B + B * (docTokens.length / 50)) // avg ~50 tokens
        score += numerator / denominator
    }

    return score
}
