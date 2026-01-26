
import { describe, expect, test, mock, beforeAll } from "bun:test"
import fs from "fs/promises"

// Mocks MUST be defined before importing the module under test
mock.module("@ai-sdk/openai", () => ({
    createOpenAI: () => ({
        embedding: () => "mock-model"
    })
}))

mock.module("ai", () => ({
    embed: async ({ value }: { value: string }) => {
        const val = value.length
        return {
            embedding: [val, val * 0.5, val * 0.1]
        }
    },
    EmbeddingModel: {}
}))

mock.module("../config/config", () => ({
    Config: {
        get: async () => ({
            provider: { openai: { options: { apiKey: "mock-key" } } }
        })
    }
}))

mock.module("../file", () => ({
    File: {
        search: async () => ["brain_test_doc1.txt", "brain_test_doc2.txt"]
    }
}))

describe("Brain Tool", () => {
    let BrainTool: any
    let tool: any
    const ctx: any = {
        metadata: () => { }
    }

    beforeAll(async () => {
        // Dynamic import to ensure mocks apply
        const mod = await import("./brain")
        BrainTool = mod.BrainTool

        // Initialize tool
        tool = await BrainTool.init({})

        // Create dummy files > 50 chars to pass the trivial file check
        await fs.writeFile("brain_test_doc1.txt", "Hello World ".repeat(10))
        await fs.writeFile("brain_test_doc2.txt", "Hello Universe ".repeat(10))
    })

    test("should fail search if no index (and clear works)", async () => {
        const result = await tool.execute({ action: "clear" }, ctx)
        expect(result.output).toBe("Brain memory cleared.")

        const search = await tool.execute({
            action: "search",
            query: "test"
        }, ctx)

        expect(search.output).toContain("No semantic matches")
    })

    test("should index and search", async () => {
        // 1. Index
        const idxRes = await tool.execute({ action: "index", path: "." }, ctx)
        expect(idxRes.output).toContain("Indexed")

        // 2. Search
        const searchRes = await tool.execute({
            action: "search",
            query: "Hello World",
            limit: 1
        }, ctx)

        expect(searchRes.output).toContain("brain_test_doc1.txt")
        // Check for score (format is [Score: 1.0000])
        expect(searchRes.output).toContain("1.0000")
    })
})
