import type { LanguageModel, Provider as SDK } from "ai"
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createAzure } from "@ai-sdk/azure"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible } from "./sdk/openai-compatible/src"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/openai-compatible/src"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createVercel } from "@ai-sdk/vercel"
import { createAntigravity } from "./antigravity"
import { createOllama } from "./ollama"
import { CUSTOM_LOADERS } from "./loaders"
import type { Model } from "./types"
import { state } from "./state"

export const BUNDLED_PROVIDERS: Record<string, (options: any) => any> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/azure": createAzure,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    "@ai-sdk/openai-compatible": createOpenaiCompatible,
    "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
    "@ai-sdk/xai": createXai,
    "@ai-sdk/mistral": createMistral,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/cerebras": createCerebras,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/gateway": createGateway,
    "@ai-sdk/vercel": createVercel,
    // Antigravity provider for Claude/Gemini via Google OAuth
    "@atomcli/antigravity": createAntigravity,
    // Ollama - Local LLM provider
    "@atomcli/ollama": createOllama,
}

export async function getSDK(model: Model): Promise<SDK> {
    const { providers, sdk: sdkCache } = await state()

    const provider = providers[model.providerID]
    if (!provider) {
        throw new Error(`Provider not found: ${model.providerID}`)
    }

    const existing = sdkCache.get(provider.id as any)
    if (existing) return existing

    const create = BUNDLED_PROVIDERS[model.api.npm]
    if (!create) {
        throw new Error(`SDK not found for npm package: ${model.api.npm}`)
    }

    const options = {
        ...provider.options,
        apiKey: provider.key,
    }

    const sdk = create(options)
    sdkCache.set(provider.id as any, sdk)

    const loader = CUSTOM_LOADERS[model.providerID]
    if (loader) {
        const result = await loader(provider)
        if (result.getModel) {
            const { modelLoaders } = await state()
            modelLoaders[model.providerID] = result.getModel
        }
    }

    return sdk
}

export async function getLanguage(model: Model): Promise<LanguageModel> {
    const sdk = (await getSDK(model)) as any
    const { modelLoaders } = await state()

    const customLoader = modelLoaders[model.providerID]
    if (customLoader) {
        return customLoader(sdk, model.api.id, model.options)
    }

    if (typeof sdk === "function") {
        return sdk(model.api.id, model.options)
    }

    if (typeof sdk.languageModel === "function") {
        return sdk.languageModel(model.api.id, model.options)
    }

    if (typeof sdk.chat === "function") {
        return sdk.chat(model.api.id, model.options)
    }

    // Fallback for some providers that use the provider name as method
    const method = model.api.npm.split("/").pop()?.replace("ai-sdk-", "")
    if (method && typeof sdk[method] === "function") {
        return sdk[method](model.api.id, model.options)
    }

    throw new Error(`Could not create language model for ${model.id}`)
}
