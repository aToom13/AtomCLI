/**
 * AI SDK Compatibility Layer
 * 
 * This module provides dynamic imports for the 'ai' package to work around
 * Bun 1.3.6's ESM resolution issues with ai@5.0.97.
 * 
 * Usage:
 *   import { getAI, getLoadAPIKeyError, getAPICallError } from "@/util/util/ai-compat"
 *   
 *   const { embed } = await getAI()
 *   const LoadAPIKeyError = await getLoadAPIKeyError()
 */

// Re-export types (these are safe - types are erased at runtime)
export type {
    ModelMessage,
    UIMessage,
    Tool as AITool,
    ToolCallOptions,
    EmbeddingModel,
    Provider as SDK,
    JSONSchema7,
} from "ai"

// Cached module reference
let aiModule: typeof import("ai") | null = null

/**
 * Get the full AI module dynamically
 */
export async function getAI(): Promise<typeof import("ai")> {
    if (!aiModule) {
        aiModule = await import("ai")
    }
    return aiModule
}

/**
 * Get LoadAPIKeyError class
 */
export async function getLoadAPIKeyError() {
    const ai = await getAI()
    return ai.LoadAPIKeyError
}

/**
 * Get APICallError class
 */
export async function getAPICallError() {
    const ai = await getAI()
    return ai.APICallError
}

/**
 * Get NoSuchModelError class
 */
export async function getNoSuchModelError() {
    const ai = await getAI()
    return ai.NoSuchModelError
}

/**
 * Get tool function
 */
export async function getTool() {
    const ai = await getAI()
    return ai.tool
}

/**
 * Get dynamicTool function
 */
export async function getDynamicTool() {
    const ai = await getAI()
    return ai.dynamicTool
}

/**
 * Get jsonSchema function
 */
export async function getJsonSchema() {
    const ai = await getAI()
    return ai.jsonSchema
}

/**
 * Get generateObject function
 */
export async function getGenerateObject() {
    const ai = await getAI()
    return ai.generateObject
}

/**
 * Get convertToModelMessages function
 */
export async function getConvertToModelMessages() {
    const ai = await getAI()
    return ai.convertToModelMessages
}

/**
 * Get embed function
 */
export async function getEmbed() {
    const ai = await getAI()
    return ai.embed
}

/**
 * Get generateText function
 */
export async function getGenerateText() {
    const ai = await getAI()
    return ai.generateText
}

/**
 * Get extractReasoningMiddleware function
 */
export async function getExtractReasoningMiddleware() {
    const ai = await getAI()
    return ai.extractReasoningMiddleware
}

/**
 * Get wrapLanguageModel function
 */
export async function getWrapLanguageModel() {
    const ai = await getAI()
    return ai.wrapLanguageModel
}

/**
 * Get streamText function
 */
export async function getStreamText() {
    const ai = await getAI()
    return ai.streamText
}
