import {
    type LanguageModelV2,
    type LanguageModelV2CallWarning,
    type LanguageModelV2ProviderDefinedTool,
} from "@ai-sdk/provider"
import { parseProviderOptions } from "@ai-sdk/provider-utils"
import type { OpenAIConfig } from "./openai-config"
import { convertToOpenAIResponsesInput } from "./convert-to-openai-responses-input"
import type { OpenAIResponsesIncludeOptions, OpenAIResponsesIncludeValue } from "./openai-responses-api-types"
import { prepareResponsesTools } from "./openai-responses-prepare-tools"
import type { OpenAIResponsesModelId } from "./openai-responses-settings"
import { openaiResponsesProviderOptionsSchema, TOP_LOGPROBS_MAX } from "./schemas"

type ResponsesModelConfig = {
    isReasoningModel: boolean
    systemMessageMode: "remove" | "system" | "developer"
    requiredAutoTruncation: boolean
    supportsFlexProcessing: boolean
    supportsPriorityProcessing: boolean
}

export function getResponsesModelConfig(modelId: string): ResponsesModelConfig {
    const supportsFlexProcessing =
        modelId.startsWith("o3") ||
        modelId.startsWith("o4-mini") ||
        (modelId.startsWith("gpt-5") && !modelId.startsWith("gpt-5-chat"))
    const supportsPriorityProcessing =
        modelId.startsWith("gpt-4") ||
        modelId.startsWith("gpt-5-mini") ||
        (modelId.startsWith("gpt-5") && !modelId.startsWith("gpt-5-nano") && !modelId.startsWith("gpt-5-chat")) ||
        modelId.startsWith("o3") ||
        modelId.startsWith("o4-mini")
    const defaults = {
        requiredAutoTruncation: false,
        systemMessageMode: "system" as const,
        supportsFlexProcessing,
        supportsPriorityProcessing,
    }

    // gpt-5-chat models are non-reasoning
    if (modelId.startsWith("gpt-5-chat")) {
        return {
            ...defaults,
            isReasoningModel: false,
        }
    }

    // o series reasoning models:
    if (
        modelId.startsWith("o") ||
        modelId.startsWith("gpt-5") ||
        modelId.startsWith("codex-") ||
        modelId.startsWith("computer-use")
    ) {
        if (modelId.startsWith("o1-mini") || modelId.startsWith("o1-preview")) {
            return {
                ...defaults,
                isReasoningModel: true,
                systemMessageMode: "remove",
            }
        }

        return {
            ...defaults,
            isReasoningModel: true,
            systemMessageMode: "developer",
        }
    }

    // gpt models:
    return {
        ...defaults,
        isReasoningModel: false,
    }
}

export async function prepareArgs({
    modelId,
    config,
    maxOutputTokens,
    temperature,
    stopSequences,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,
    prompt,
    providerOptions,
    tools,
    toolChoice,
    responseFormat,
}: Parameters<LanguageModelV2["doGenerate"]>[0] & {
    modelId: OpenAIResponsesModelId
    config: OpenAIConfig
}) {
    const warnings: LanguageModelV2CallWarning[] = []
    const modelConfig = getResponsesModelConfig(modelId)

    if (topK != null) {
        warnings.push({ type: "unsupported-setting", setting: "topK" })
    }

    if (seed != null) {
        warnings.push({ type: "unsupported-setting", setting: "seed" })
    }

    if (presencePenalty != null) {
        warnings.push({
            type: "unsupported-setting",
            setting: "presencePenalty",
        })
    }

    if (frequencyPenalty != null) {
        warnings.push({
            type: "unsupported-setting",
            setting: "frequencyPenalty",
        })
    }

    if (stopSequences != null) {
        warnings.push({ type: "unsupported-setting", setting: "stopSequences" })
    }

    const openaiOptions = await parseProviderOptions({
        provider: "openai",
        providerOptions,
        schema: openaiResponsesProviderOptionsSchema,
    })

    function hasOpenAITool(id: string) {
        return tools?.find((tool) => tool.type === "provider-defined" && tool.id === id) != null
    }

    const { input, warnings: inputWarnings } = await convertToOpenAIResponsesInput({
        prompt,
        systemMessageMode: modelConfig.systemMessageMode,
        fileIdPrefixes: config.fileIdPrefixes,
        store: openaiOptions?.store ?? true,
        hasLocalShellTool: hasOpenAITool("openai.local_shell"),
    })

    warnings.push(...inputWarnings)

    const strictJsonSchema = openaiOptions?.strictJsonSchema ?? false

    let include: OpenAIResponsesIncludeOptions = openaiOptions?.include

    function addInclude(key: OpenAIResponsesIncludeValue) {
        include = include != null ? [...include, key] : [key]
    }

    // when logprobs are requested, automatically include them:
    const topLogprobs =
        typeof openaiOptions?.logprobs === "number"
            ? openaiOptions?.logprobs
            : openaiOptions?.logprobs === true
                ? TOP_LOGPROBS_MAX
                : undefined

    if (topLogprobs) {
        addInclude("message.output_text.logprobs")
    }

    // when a web search tool is present, automatically include the sources:
    const webSearchToolName = (
        tools?.find(
            (tool) =>
                tool.type === "provider-defined" &&
                (tool.id === "openai.web_search" || tool.id === "openai.web_search_preview"),
        ) as LanguageModelV2ProviderDefinedTool | undefined
    )?.name

    if (webSearchToolName) {
        addInclude("web_search_call.action.sources")
    }

    // when a code interpreter tool is present, automatically include the outputs:
    if (hasOpenAITool("openai.code_interpreter")) {
        addInclude("code_interpreter_call.outputs")
    }

    const baseArgs = {
        model: modelId,
        input,
        temperature,
        top_p: topP,
        max_output_tokens: maxOutputTokens,

        ...((responseFormat?.type === "json" || openaiOptions?.textVerbosity) && {
            text: {
                ...(responseFormat?.type === "json" && {
                    format:
                        responseFormat.schema != null
                            ? {
                                type: "json_schema",
                                strict: strictJsonSchema,
                                name: responseFormat.name ?? "response",
                                description: responseFormat.description,
                                schema: responseFormat.schema,
                            }
                            : { type: "json_object" },
                }),
                ...(openaiOptions?.textVerbosity && {
                    verbosity: openaiOptions.textVerbosity,
                }),
            },
        }),

        // provider options:
        max_tool_calls: openaiOptions?.maxToolCalls,
        metadata: openaiOptions?.metadata,
        parallel_tool_calls: openaiOptions?.parallelToolCalls,
        previous_response_id: openaiOptions?.previousResponseId,
        store: openaiOptions?.store,
        user: openaiOptions?.user,
        instructions: openaiOptions?.instructions,
        service_tier: openaiOptions?.serviceTier,
        include,
        prompt_cache_key: openaiOptions?.promptCacheKey,
        safety_identifier: openaiOptions?.safetyIdentifier,
        top_logprobs: topLogprobs,

        // model-specific settings:
        ...(modelConfig.isReasoningModel &&
            (openaiOptions?.reasoningEffort != null || openaiOptions?.reasoningSummary != null) && {
            reasoning: {
                ...(openaiOptions?.reasoningEffort != null && {
                    effort: openaiOptions.reasoningEffort,
                }),
                ...(openaiOptions?.reasoningSummary != null && {
                    summary: openaiOptions.reasoningSummary,
                }),
            },
        }),
        ...(modelConfig.requiredAutoTruncation && {
            truncation: "auto",
        }),
    }

    if (modelConfig.isReasoningModel) {
        // remove unsupported settings for reasoning models
        // see https://platform.openai.com/docs/guides/reasoning#limitations
        if (baseArgs.temperature != null) {
            baseArgs.temperature = undefined
            warnings.push({
                type: "unsupported-setting",
                setting: "temperature",
                details: "temperature is not supported for reasoning models",
            })
        }

        if (baseArgs.top_p != null) {
            baseArgs.top_p = undefined
            warnings.push({
                type: "unsupported-setting",
                setting: "topP",
                details: "topP is not supported for reasoning models",
            })
        }
    } else {
        if (openaiOptions?.reasoningEffort != null) {
            warnings.push({
                type: "unsupported-setting",
                setting: "reasoningEffort",
                details: "reasoningEffort is not supported for non-reasoning models",
            })
        }

        if (openaiOptions?.reasoningSummary != null) {
            warnings.push({
                type: "unsupported-setting",
                setting: "reasoningSummary",
                details: "reasoningSummary is not supported for non-reasoning models",
            })
        }
    }

    // Validate flex processing support
    if (openaiOptions?.serviceTier === "flex" && !modelConfig.supportsFlexProcessing) {
        warnings.push({
            type: "unsupported-setting",
            setting: "serviceTier",
            details: "flex processing is only available for o3, o4-mini, and gpt-5 models",
        })
        // Remove from args if not supported
        delete (baseArgs as any).service_tier
    }

    // Validate priority processing support
    if (openaiOptions?.serviceTier === "priority" && !modelConfig.supportsPriorityProcessing) {
        warnings.push({
            type: "unsupported-setting",
            setting: "serviceTier",
            details:
                "priority processing is only available for supported models (gpt-4, gpt-5, gpt-5-mini, o3, o4-mini) and requires Enterprise access. gpt-5-nano is not supported",
        })
        // Remove from args if not supported
        delete (baseArgs as any).service_tier
    }

    const {
        tools: openaiTools,
        toolChoice: openaiToolChoice,
        toolWarnings,
    } = prepareResponsesTools({
        tools,
        toolChoice,
        strictJsonSchema,
    })

    return {
        webSearchToolName,
        args: {
            ...baseArgs,
            tools: openaiTools,
            tool_choice: openaiToolChoice,
        },
        warnings: [...warnings, ...toolWarnings],
    }
}
