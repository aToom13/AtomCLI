/**
 * Ollama Provider - Native local LLM support for AtomCLI
 *
 * Ollama runs local AI models like Llama 3, Mistral, Gemma, etc.
 * This provider auto-detects running Ollama instances and makes
 * installed models available without any configuration.
 *
 * @see https://ollama.ai
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider as SDK } from "ai"
import { Log } from "../util/log"

const log = Log.create({ service: "provider.ollama" })

export interface OllamaProviderSettings {
    /**
     * Ollama API base URL. Defaults to http://localhost:11434
     */
    baseURL?: string

    /**
     * Connection timeout in milliseconds. Defaults to 5000ms for detection.
     */
    timeout?: number
}

/**
 * Create an Ollama provider instance
 */
export function createOllama(options: OllamaProviderSettings = {}): SDK {
    const baseURL = options.baseURL ?? "http://localhost:11434/v1"

    return createOpenAICompatible({
        baseURL,
        name: "ollama",
        // Ollama doesn't require API key
        apiKey: "ollama",
    })
}

/**
 * Check if Ollama is running and get available models
 */
export async function detectOllama(
    baseURL: string = "http://localhost:11434",
): Promise<{ running: boolean; models: OllamaModel[] }> {
    try {
        const response = await fetch(`${baseURL}/api/tags`, {
            signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
            return { running: false, models: [] }
        }

        const data = (await response.json()) as { models?: OllamaModelInfo[] }

        // Filter out invalid models, but allow cloud/remote models
        const localModels = (data.models ?? []).filter((m) => {
            // Keep models even if they are remote/cloud proxies
            // if (m.remote_host) return false

            // Allow small models (like cloud pointers), just check if valid name exists
            if (!m.name) return false
            return true
        })

        const models = localModels.map(parseOllamaModel)

        log.info("detected ollama", { modelCount: models.length, totalModels: data.models?.length })
        return { running: true, models }
    } catch (e) {
        log.debug("ollama not detected", { error: e instanceof Error ? e.message : String(e) })
        return { running: false, models: [] }
    }
}

interface OllamaModelInfo {
    name: string
    model: string
    modified_at: string
    size: number
    digest: string
    details?: {
        parent_model?: string
        format?: string
        family?: string
        families?: string[]
        parameter_size?: string
        quantization_level?: string
    }
    // Some Ollama installations have cloud/remote models
    remote_host?: string
}

export interface OllamaModel {
    id: string
    name: string
    family: string
    parameterSize: string
    quantization: string
    contextLength: number
}

/** Provider model format returned by toProviderModels */
export interface OllamaProviderModel {
    id: string
    name: string
    providerID: string
    family: string
    status: "active" | "alpha" | "beta" | "deprecated"
    api: {
        id: string
        npm: string
        url: string
    }
    cost: {
        input: number
        output: number
        cache: { read: number; write: number }
    }
    limit: {
        context: number
        output: number
    }
    capabilities: {
        temperature: boolean
        reasoning: boolean
        attachment: boolean
        toolcall: boolean
        input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
        output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
        interleaved: boolean
    }
    headers: Record<string, string>
    options: Record<string, unknown>
    release_date: string
}

function parseOllamaModel(info: OllamaModelInfo): OllamaModel {
    const name = info.name.split(":")[0]
    const tag = info.name.includes(":") ? info.name.split(":")[1] : "latest"

    // Estimate context length based on model family
    const contextLength = estimateContextLength(name, info.details?.parameter_size)

    return {
        id: info.name,
        name: formatModelName(name, tag),
        family: info.details?.family ?? name,
        parameterSize: info.details?.parameter_size ?? "unknown",
        quantization: info.details?.quantization_level ?? tag,
        contextLength,
    }
}

function formatModelName(name: string, tag: string): string {
    const displayName = name
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")

    return tag === "latest" ? displayName : `${displayName} (${tag})`
}

function estimateContextLength(modelName: string, paramSize?: string): number {
    const name = modelName.toLowerCase()

    // Known context lengths for popular models
    if (name.includes("llama3") || name.includes("llama-3")) return 128000
    if (name.includes("llama2") || name.includes("llama-2")) return 4096
    if (name.includes("mistral")) return 32768
    if (name.includes("mixtral")) return 32768
    if (name.includes("gemma2") || name.includes("gemma-2")) return 8192
    if (name.includes("gemma")) return 8192
    if (name.includes("phi3") || name.includes("phi-3")) return 128000
    if (name.includes("phi")) return 4096
    if (name.includes("qwen2") || name.includes("qwen-2")) return 32768
    if (name.includes("qwen")) return 32768
    if (name.includes("codellama")) return 16384
    if (name.includes("deepseek")) return 128000
    if (name.includes("command-r")) return 128000
    if (name.includes("yi")) return 200000

    // Default based on parameter size
    if (paramSize) {
        const size = parseFloat(paramSize.replace(/[^0-9.]/g, ""))
        if (size >= 70) return 32768
        if (size >= 30) return 16384
        if (size >= 7) return 8192
    }

    return 4096 // Safe default
}

/**
 * Detect if an Ollama model supports vision/image input
 * based on model name patterns.
 */
function detectVision(model: OllamaModel): boolean {
    const name = model.id.toLowerCase()
    const visionModels = [
        "llava", "bakllava", "moondream", "llama3.2-vision",
        "llama-3.2-vision", "minicpm-v", "cogvlm",
        "internvl", "qwen2-vl", "qwen2.5-vl", "gemma3",
        "gemma-3",
    ]
    return visionModels.some(v => name.includes(v))
}

/**
 * Determine if an Ollama model supports tool/function calling
 * based on its family and name. Most modern models support tools,
 * but some older/smaller models do not.
 */
function supportsTools(model: OllamaModel): boolean {
    const name = model.id.toLowerCase()
    const family = model.family.toLowerCase()

    // Models known to support tool calling
    const toolCapableFamilies = [
        "llama", // Llama 3+ supports tools
        "mistral",
        "mixtral",
        "qwen", // Qwen 2+ supports tools
        "deepseek",
        "command-r",
        "phi3", "phi-3", "phi4", "phi-4",
        "gemma2", "gemma-2", "gemma3", "gemma-3",
        "granite",
        "nemotron",
        "hermes",
        "yi",
        "internlm",
    ]

    // Models known to NOT support tool calling
    const noToolModels = [
        "tinyllama",
        "llama2", "llama-2",
        "codellama",
        "phi",    // phi-1, phi-2 (not phi-3/phi-4)
        "stablelm",
        "orca-mini",
        "neural-chat",
        "starling",
        "vicuna",
        "solar",
        "openchat",
        "zephyr",
    ]

    // Check no-tool list first (more specific match)
    for (const pattern of noToolModels) {
        if (name.startsWith(pattern) || name.includes(`:${pattern}`)) {
            // But don't exclude if it's actually a newer version
            // e.g. phi3 should not match the "phi" exclusion
            if (pattern === "phi" && (name.includes("phi3") || name.includes("phi-3") || name.includes("phi4") || name.includes("phi-4"))) {
                continue
            }
            if (pattern === "llama2" && (name.includes("llama3") || name.includes("llama-3"))) {
                continue
            }
            return false
        }
    }

    // Check tool-capable families
    for (const f of toolCapableFamilies) {
        if (family.includes(f) || name.includes(f)) {
            return true
        }
    }

    // Default: assume tool support for unknown models
    // Modern models generally support tool calling
    return true
}

/**
 * Convert detected Ollama models to AtomCLI provider format
 */
export function toProviderModels(models: OllamaModel[]): Record<string, OllamaProviderModel> {
    const result: Record<string, OllamaProviderModel> = {}

    for (const model of models) {
        result[model.id] = {
            id: model.id,
            name: model.name,
            providerID: "ollama",
            family: model.family,
            status: "active",
            api: {
                id: model.id,
                npm: "@atomcli/ollama",
                url: "http://localhost:11434/v1",
            },
            cost: {
                input: 0,
                output: 0,
                cache: { read: 0, write: 0 },
            },
            limit: {
                context: model.contextLength,
                output: Math.min(4096, model.contextLength),
            },
            capabilities: {
                temperature: true,
                reasoning: model.family.toLowerCase().includes("deepseek") && model.id.toLowerCase().includes("r1"),
                attachment: false,
                toolcall: supportsTools(model),
                input: { text: true, audio: false, image: detectVision(model), video: false, pdf: false },
                output: { text: true, audio: false, image: false, video: false, pdf: false },
                interleaved: false,
            },
            headers: {},
            options: {},
            release_date: new Date().toISOString().split("T")[0],
        }
    }

    return result
}
