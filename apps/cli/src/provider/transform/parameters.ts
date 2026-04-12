import type { Provider } from "../provider"
import { iife } from "@/util/iife"

export function temperature(model: Provider.Model) {
    const id = model.modelID.toLowerCase()
    if (id.includes("qwen")) return 0.55
    if (id.includes("claude")) return undefined
    if (id.includes("gemini")) return 1.0
    if (id.includes("glm-4.6")) return 1.0
    if (id.includes("glm-4.7")) return 1.0
    if (id.includes("minimax-m2")) return 1.0
    if (id.includes("kimi-k2")) {
        if (id.includes("thinking")) return 1.0
        return 0.6
    }
    return undefined
}

export function topP(model: Provider.Model) {
    const id = model.modelID.toLowerCase()
    if (id.includes("qwen")) return 1
    if (id.includes("minimax-m2")) {
        return 0.95
    }
    if (id.includes("gemini")) return 0.95
    return undefined
}

export function topK(model: Provider.Model) {
    const id = model.modelID.toLowerCase()
    if (id.includes("minimax-m2")) {
        if (id.includes("m2.1")) return 40
        return 20
    }
    if (id.includes("gemini")) return 64
    return undefined
}

const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"]

export function variants(model: Provider.Model): Record<string, Record<string, any>> {
    if (!model.capabilities.reasoning) return {}

    const id = model.modelID.toLowerCase()
    if (id.includes("deepseek") || id.includes("minimax") || id.includes("glm") || id.includes("mistral")) return {}

    switch (model.api.npm) {
        case "@openrouter/ai-sdk-provider":
            if (!model.modelID.includes("gpt") && !model.modelID.includes("gemini-3") && !model.modelID.includes("grok-4")) return {}
            return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))

        // TODO: YOU CANNOT SET max_tokens if this is set!!!
        case "@ai-sdk/gateway":
            return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

        case "@ai-sdk/cerebras":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/cerebras
        case "@ai-sdk/togetherai":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/togetherai
        case "@ai-sdk/xai":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/xai
        case "@ai-sdk/deepinfra":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/deepinfra
        case "@ai-sdk/openai-compatible":
            return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))

        case "@ai-sdk/azure":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/azure
            if (id === "o1-mini") return {}
            const azureEfforts = ["low", "medium", "high"]
            if (id.includes("gpt-5-") || id === "gpt-5") {
                azureEfforts.unshift("minimal")
            }
            return Object.fromEntries(
                azureEfforts.map((effort) => [
                    effort,
                    {
                        reasoningEffort: effort,
                        reasoningSummary: "auto",
                        include: ["reasoning.encrypted_content"],
                    },
                ]),
            )
        case "@ai-sdk/openai":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/openai
            if (id === "gpt-5-pro") return {}
            const openaiEfforts = iife(() => {
                if (id.includes("codex")) {
                    if (id.includes("5.2")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
                    return WIDELY_SUPPORTED_EFFORTS
                }
                const arr = [...WIDELY_SUPPORTED_EFFORTS]
                if (id.includes("gpt-5-") || id === "gpt-5") {
                    arr.unshift("minimal")
                }
                if (model.release_date >= "2025-11-13") {
                    arr.unshift("none")
                }
                if (model.release_date >= "2025-12-04") {
                    arr.push("xhigh")
                }
                return arr
            })
            return Object.fromEntries(
                openaiEfforts.map((effort) => [
                    effort,
                    {
                        reasoningEffort: effort,
                        reasoningSummary: "auto",
                        include: ["reasoning.encrypted_content"],
                    },
                ]),
            )

        case "@ai-sdk/anthropic":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/anthropic
            return {
                high: {
                    thinking: {
                        type: "enabled",
                        budgetTokens: 16000,
                    },
                },
                max: {
                    thinking: {
                        type: "enabled",
                        budgetTokens: 31999,
                    },
                },
            }

        case "@ai-sdk/amazon-bedrock":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock
            return Object.fromEntries(
                WIDELY_SUPPORTED_EFFORTS.map((effort) => [
                    effort,
                    {
                        reasoningConfig: {
                            type: "enabled",
                            maxReasoningEffort: effort,
                        },
                    },
                ]),
            )

        case "@ai-sdk/google-vertex":
        // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-vertex
        case "@ai-sdk/google":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
            if (id.includes("2.5")) {
                return {
                    high: {
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingBudget: 16000,
                        },
                    },
                    max: {
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingBudget: 24576,
                        },
                    },
                }
            }
            return Object.fromEntries(
                ["low", "high"].map((effort) => [
                    effort,
                    {
                        includeThoughts: true,
                        thinkingLevel: effort,
                    },
                ]),
            )

        case "@ai-sdk/mistral":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/mistral
            return {}

        case "@ai-sdk/cohere":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/cohere
            return {}

        case "@ai-sdk/groq":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/groq
            const groqEffort = ["none", ...WIDELY_SUPPORTED_EFFORTS]
            return Object.fromEntries(
                groqEffort.map((effort) => [
                    effort,
                    {
                        includeThoughts: true,
                        thinkingLevel: effort,
                    },
                ]),
            )

        case "@ai-sdk/perplexity":
            // https://v5.ai-sdk.dev/providers/ai-sdk-providers/perplexity
            return {}
    }
    return {}
}

export function options(
    model: Provider.Model,
    sessionID: string,
    providerOptions?: Record<string, any>,
): Record<string, any> {
    const result: Record<string, any> = {}

    if (model.api.npm === "@openrouter/ai-sdk-provider") {
        result["usage"] = {
            include: true,
        }
        if (model.api.id.includes("gemini-3")) {
            result["reasoning"] = { effort: "high" }
        }
    }

    if (
        model.providerID === "baseten" ||
        (model.providerID === "atomcli" && ["kimi-k2-thinking", "glm-4.6"].includes(model.api.id))
    ) {
        result["chat_template_args"] = { enable_thinking: true }
    }

    if (model.providerID === "openai" || providerOptions?.setCacheKey) {
        result["promptCacheKey"] = sessionID
    }

    if (model.api.npm === "@ai-sdk/google" || model.api.npm === "@ai-sdk/google-vertex") {
        result["thinkingConfig"] = {
            includeThoughts: true,
        }
        if (model.api.id.includes("gemini-3")) {
            result["thinkingConfig"]["thinkingLevel"] = "high"
        }
    }

    if (model.api.id.includes("gpt-5") && !model.api.id.includes("gpt-5-chat")) {
        if (model.providerID.includes("codex")) {
            result["store"] = false
        }

        if (!model.api.id.includes("codex") && !model.api.id.includes("gpt-5-pro")) {
            result["reasoningEffort"] = "medium"
        }

        if (model.api.id.endsWith("gpt-5.") && model.providerID !== "azure") {
            result["textVerbosity"] = "low"
        }

        if (model.providerID.startsWith("atomcli")) {
            result["promptCacheKey"] = sessionID
            result["include"] = ["reasoning.encrypted_content"]
            result["reasoningSummary"] = "auto"
        }
    }
    return result
}

export function smallOptions(model: Provider.Model) {
    if (model.providerID === "openai" || model.api.id.includes("gpt-5")) {
        if (model.api.id.includes("5.")) {
            return { reasoningEffort: "low" }
        }
        return { reasoningEffort: "minimal" }
    }
    if (model.providerID === "google") {
        // gemini-3 uses thinkingLevel, gemini-2.5 uses thinkingBudget
        if (model.api.id.includes("gemini-3")) {
            return { thinkingConfig: { thinkingLevel: "minimal" } }
        }
        return { thinkingConfig: { thinkingBudget: 0 } }
    }
    if (model.providerID === "openrouter") {
        if (model.api.id.includes("google")) {
            return { reasoning: { enabled: false } }
        }
        return { reasoningEffort: "minimal" }
    }
    return {}
}

export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
    switch (model.api.npm) {
        case "@ai-sdk/github-copilot":
        case "@ai-sdk/openai":
        case "@ai-sdk/azure":
            return {
                ["openai" as string]: options,
            }
        case "@ai-sdk/amazon-bedrock":
            return {
                ["bedrock" as string]: options,
            }
        case "@ai-sdk/anthropic":
            return {
                ["anthropic" as string]: options,
            }
        case "@ai-sdk/google-vertex":
        case "@ai-sdk/google":
            return {
                ["google" as string]: options,
            }
        case "@ai-sdk/gateway":
            return {
                ["gateway" as string]: options,
            }
        case "@openrouter/ai-sdk-provider":
            return {
                ["openrouter" as string]: options,
            }
        default:
            return {
                [model.providerID]: options,
            }
    }
}

export function maxOutputTokens(
    npm: string,
    options: Record<string, any>,
    modelLimit: number,
    globalLimit: number,
): number {
    const modelCap = modelLimit || globalLimit
    const standardLimit = Math.min(modelCap, globalLimit)

    if (npm === "@ai-sdk/anthropic") {
        const thinking = options?.["thinking"]
        const budgetTokens = typeof thinking?.["budgetTokens"] === "number" ? thinking["budgetTokens"] : 0
        const enabled = thinking?.["type"] === "enabled"
        if (enabled && budgetTokens > 0) {
            // Return text tokens so that text + thinking <= model cap, preferring 32k text when possible.
            if (budgetTokens + standardLimit <= modelCap) {
                return standardLimit
            }
            return modelCap - budgetTokens
        }
    }

    return standardLimit
}
