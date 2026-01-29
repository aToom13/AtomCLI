/**
 * Google Gemini Provider for AtomCLI
 *
 * This module provides dynamic model discovery for Google Gemini,
 * fetching available models from the API instead of using static lists.
 */

import { GoogleGenAI } from "@google/genai"
import { Log } from "../util/log"
import { Auth } from "../auth"
import { Env } from "../env"

const log = Log.create({ service: "google" })

const DEFAULT_CONTEXT_WINDOW = 1_048_576
const SUPPORTED_MODEL_PREFIXES = ["gemini-", "learnlm-"]

// Model info structure
interface ModelInfo {
    id: string
    name: string
    description?: string
    contextWindow: number
    maxTokens: number | null
    supportsImages?: boolean
    inputPrice?: number
    outputPrice?: number
}

/**
 * Extract the canonical model identifier from the API model resource name.
 */
function normalizeModelId(name?: string): string | undefined {
    if (!name) {
        return undefined
    }

    const segments = name.split("/")
    const candidate = segments[segments.length - 1]

    if (!candidate || candidate.startsWith("tunedModels")) {
        return undefined
    }

    return candidate
}

/**
 * Check if model ID is supported
 */
function isSupportedModelId(id: string): boolean {
    return SUPPORTED_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/**
 * Fetch available models from Google Gemini API
 */
export async function getGoogleModels(apiKey: string): Promise<Record<string, ModelInfo>> {
    const models: Record<string, ModelInfo> = {}

    try {
        log.info("Fetching Google models from API")
        const client = new GoogleGenAI({ apiKey })
        const pager = await client.models.list()

        for await (const model of pager) {
            const id = normalizeModelId(model.name)

            if (!id || !isSupportedModelId(id)) {
                continue
            }

            models[id] = {
                id,
                name: model.displayName || id,
                description: model.description || undefined,
                contextWindow: model.inputTokenLimit ?? DEFAULT_CONTEXT_WINDOW,
                maxTokens: model.outputTokenLimit ?? null,
                supportsImages: true, // Most Gemini models support images
            }
        }

        log.info("Fetched Google models", { count: Object.keys(models).length })
        return models
    } catch (error) {
        log.error("Failed to fetch Google models", { error })
        return {}
    }
}

/**
 * Detect if Google API is available (has key stored)
 */
export async function detectGoogle(): Promise<{
    available: boolean
    token?: string
}> {
    // Check environment variable first
    const envToken = Env.get("GOOGLE_GENERATIVE_AI_API_KEY") || Env.get("GEMINI_API_KEY")
    if (envToken) {
        return { available: true, token: envToken }
    }

    // Check stored auth
    const auth = await Auth.get("google")
    if (auth?.type === "api") {
        return {
            available: true,
            token: auth.key,
        }
    }

    return { available: false }
}
