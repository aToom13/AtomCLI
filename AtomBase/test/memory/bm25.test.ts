/**
 * BM25 Search Engine Tests
 * 
 * Tests for the BM25 tokenizer and search algorithm.
 */

import { describe, it, expect } from "bun:test"
import { tokenize, bm25Search, bm25Score, type BM25Document } from "@/core/memory/core/bm25"

// ============================================================================
// TOKENIZER TESTS
// ============================================================================

describe("BM25 Tokenizer", () => {
    it("should tokenize basic English text", () => {
        const tokens = tokenize("The quick brown fox jumps over the lazy dog")
        expect(tokens).toContain("quick")
        expect(tokens).toContain("brown")
        expect(tokens).toContain("fox")
        expect(tokens).toContain("jumps")
        expect(tokens).toContain("lazy")
        expect(tokens).toContain("dog")
        // Stop words should be removed
        expect(tokens).not.toContain("the")
        expect(tokens).not.toContain("over")
    })

    it("should tokenize Turkish text", () => {
        const tokens = tokenize("Dosya bulunamadı hatası ile karşılaştım")
        expect(tokens).toContain("dosya")
        expect(tokens).toContain("bulunamadı")
        expect(tokens).toContain("hatası")
        expect(tokens).toContain("karşılaştım")
        // Turkish stop words should be removed
        expect(tokens).not.toContain("ile")
    })

    it("should handle special characters", () => {
        const tokens = tokenize("Error: ENOENT - file not found at /home/user/file.txt")
        expect(tokens).toContain("error")
        expect(tokens).toContain("enoent")
        expect(tokens).toContain("file")
        expect(tokens).toContain("found")
        // Punctuation removed
        expect(tokens).not.toContain(":")
        expect(tokens).not.toContain("-")
    })

    it("should filter single-character tokens", () => {
        const tokens = tokenize("I am a test")
        expect(tokens).not.toContain("i")
        expect(tokens).not.toContain("a")
        expect(tokens).toContain("test")
    })

    it("should handle empty and whitespace strings", () => {
        expect(tokenize("")).toEqual([])
        expect(tokenize("   ")).toEqual([])
    })

    it("should normalize to lowercase", () => {
        const tokens = tokenize("TypeScript Error ERROR")
        expect(tokens).toContain("typescript")
        expect(tokens).toContain("error")
        // Both "Error" and "ERROR" should be normalized to "error"
        expect(tokens.filter(t => t === "error").length).toBe(2)
    })
})

// ============================================================================
// BM25 SEARCH TESTS
// ============================================================================

describe("BM25 Search", () => {
    const documents: BM25Document[] = [
        { id: "1", text: "TypeScript type checking failed with error TS2345" },
        { id: "2", text: "Python virtual environment setup guide" },
        { id: "3", text: "File not found error when reading configuration" },
        { id: "4", text: "React component rendering optimization tips" },
        { id: "5", text: "Database connection timeout error in production" },
        { id: "6", text: "Dosya bulunamadı hatası çözümü" },
        { id: "7", text: "TypeScript strict mode configuration best practices" },
    ]

    it("should return relevant results for a query", () => {
        const results = bm25Search("TypeScript error", documents)
        expect(results.length).toBeGreaterThan(0)
        // TypeScript-related docs should score highest
        const topIds = results.slice(0, 3).map(r => r.id)
        expect(topIds).toContain("1") // TypeScript type checking error
    })

    it("should rank exact matches higher", () => {
        const results = bm25Search("File not found", documents)
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].id).toBe("3") // Exact match
    })

    it("should handle Turkish queries", () => {
        const results = bm25Search("dosya hatası", documents)
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].id).toBe("6") // Turkish doc
    })

    it("should return empty for non-matching queries", () => {
        const results = bm25Search("quantum computing blockchain", documents)
        expect(results.length).toBe(0)
    })

    it("should respect limit parameter", () => {
        const results = bm25Search("error", documents, 2)
        expect(results.length).toBeLessThanOrEqual(2)
    })

    it("should handle empty document list", () => {
        const results = bm25Search("test", [])
        expect(results.length).toBe(0)
    })

    it("should handle empty query", () => {
        const results = bm25Search("", documents)
        expect(results.length).toBe(0)
    })

    it("should sort results by score descending", () => {
        const results = bm25Search("error", documents)
        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
        }
    })

    it("should find related terms across documents", () => {
        const results = bm25Search("configuration", documents)
        expect(results.length).toBeGreaterThan(0)
        const ids = results.map(r => r.id)
        expect(ids).toContain("3") // "reading configuration"
        expect(ids).toContain("7") // "configuration best practices"
    })
})

// ============================================================================
// BM25 SINGLE SCORE TESTS
// ============================================================================

describe("BM25 Single Score", () => {
    it("should return positive score for matching text", () => {
        const score = bm25Score("file error", "File not found error when reading")
        expect(score).toBeGreaterThan(0)
    })

    it("should return 0 for non-matching text", () => {
        const score = bm25Score("quantum computing", "TypeScript error handling guide")
        expect(score).toBe(0)
    })

    it("should return 0 for empty query", () => {
        const score = bm25Score("", "some text here")
        expect(score).toBe(0)
    })

    it("should return 0 for empty text", () => {
        const score = bm25Score("test query", "")
        expect(score).toBe(0)
    })

    it("should score higher for more matching terms", () => {
        const scoreOne = bm25Score("error", "TypeScript error handling")
        const scoreTwo = bm25Score("TypeScript error", "TypeScript error handling")
        expect(scoreTwo).toBeGreaterThan(scoreOne)
    })

    it("should handle cross-language matching", () => {
        // Turkish query matching Turkish content
        const score = bm25Score("dosya hatası", "Dosya bulunamadı hatası ile karşılaştım")
        expect(score).toBeGreaterThan(0)
    })
})

console.log("Running BM25 Search Engine Tests...")
