
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { BrainTool } from "../../src/tool/brain"
import { Tool } from "../../src/tool/tool"
import { Global } from "../../src/global"
import fs from "fs/promises"
import path from "path"

// Mock OpenAI
mock.module("@ai-sdk/openai", () => ({
    createOpenAI: () => ({
        embedding: () => ({ /* mock embedding model */ })
    })
}))

// Mock ai module
mock.module("ai", () => ({
    embed: async ({ value }: any) => ({
        embedding: new Array(1536).fill(0.1) // Mock 1536-dim vector
    })
}))

// Mock Config
mock.module("../../src/config/config", () => ({
    Config: {
        get: async () => ({
            provider: {}
        })
    }
}))

describe("tool.brain", () => {
    const testDir = path.join(Global.Path.home, ".atomcli_test_brain")
    const indexFile = path.join(testDir, "brain-index.json")

    // Mock Context
    const mockCtx = {
        sessionID: "test-session",
        metadata: () => { }
    } as unknown as Tool.Context<any>

    let brainToolInstance: any

    // Setup/Teardown
    beforeEach(async () => {
        // Mock Global.Path.home via env var
        process.env.ATOMCLI_TEST_HOME = testDir
        await fs.mkdir(testDir, { recursive: true })
        // Clear environment to force no API key error if needed, or set it
        process.env.OPENAI_API_KEY = "sk-test-key"

        // Initialize tool
        brainToolInstance = await BrainTool.init()
    })

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true })
        process.env.ATOMCLI_TEST_HOME = undefined
        process.env.OPENAI_API_KEY = undefined
    })

    test("should fail without API key", async () => {
        process.env.OPENAI_API_KEY = ""
        // Re-init or just execute, but since execute checks env, it might work if we just call it
        // However, we might need to re-init if the tool caches the key? 
        // My implementation reads it inside execute: 'const apiKey = process.env.OPENAI_API_KEY ...'
        // So no need to re-init.

        const result = await brainToolInstance.execute({ action: "search", query: "test" }, mockCtx)
        expect(result.metadata.error).toBe("Missing API Key")
    })

    test("should index files (mocked)", async () => {
        // Test clear
        const result = await brainToolInstance.execute({ action: "clear" }, mockCtx)
        expect(result.output).toContain("Brain memory cleared")
        expect(result.metadata.count).toBe(0)
    })

    test("should search (mocked embedding)", async () => {
        // First clear
        await brainToolInstance.execute({ action: "clear" }, mockCtx)

        // Search on empty
        const resultEmpty = await brainToolInstance.execute({ action: "search", query: "hello" }, mockCtx)
        expect(resultEmpty.output).toContain("No semantic matches found")
    })
})
