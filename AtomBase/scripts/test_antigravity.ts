#!/usr/bin/env bun
/**
 * Test script for native Antigravity API
 */

import { callAntigravity, streamAntigravityResponse } from "../src/provider/antigravity/index"

async function main() {
    const model = process.argv[2] || "gemini-2.5-flash"
    const prompt = process.argv[3] || "Say hello in one sentence"

    console.log(`Testing Antigravity model: ${model}`)
    console.log(`Prompt: ${prompt}`)
    console.log("---")

    try {
        // Test streaming
        console.log("Streaming response:")
        for await (const chunk of streamAntigravityResponse(model, [{ role: "user", content: prompt }])) {
            process.stdout.write(chunk)
        }
        console.log("\n---")

        // Test non-streaming
        console.log("Non-streaming response:")
        const response = await callAntigravity(model, [{ role: "user", content: prompt }])
        console.log(response)
    } catch (error) {
        console.error("Error:", error)
        process.exit(1)
    }
}

main()
