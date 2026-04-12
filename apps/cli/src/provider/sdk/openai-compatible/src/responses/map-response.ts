import {
    type LanguageModelV2Content,
    type LanguageModelV2CallWarning,
    type SharedV2ProviderMetadata,
    type LanguageModelV2FinishReason,
    type LanguageModelV2Usage,
} from "@ai-sdk/provider"
import { z } from "zod/v4"
import { generateId } from "@ai-sdk/provider-utils"
import {
    codeInterpreterInputSchema,
    codeInterpreterOutputSchema,
    fileSearchOutputSchema,
    imageGenerationOutputSchema,
    localShellInputSchema,
    LOGPROBS_SCHEMA,
} from "./schemas"
import { mapOpenAIResponseFinishReason } from "./map-openai-responses-finish-reason"

// Define the response type based on the schema typically used in the main file
// Since we don't have the full schema exported, we approximate the structure expected here
// or define a type that matches what's used in the loop.
// Ideally, we'd export the schema from schemas.ts and infer it here, but let's define the needed type.

// We need to know what `response` looks like. It comes from `createJsonResponseHandler` with a schema.
// Let's assume we pass the parsed response body or relevant parts.

type ResponseOutputItem =
    | { type: "message"; id: string; content: any[] }
    | { type: "reasoning"; id: string; summary: any[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string; id: string }
    | { type: "web_search_call"; id: string; status: string; action: any }
    | { type: "file_search_call"; id: string; queries: string[]; results: any[] | null }
    | {
        type: "code_interpreter_call"
        id: string
        code: string | null
        container_id: string
        outputs: any[] | null
    }
    | { type: "image_generation_call"; id: string; result: string }
    | { type: "local_shell_call"; id: string; call_id: string; action: any }
    | { type: "computer_call"; id: string; status?: string }

export function mapResponse(
    response: {
        id: string
        created_at: number
        model: string
        output: ResponseOutputItem[]
        service_tier?: string | null
        incomplete_details?: { reason: string } | null
        usage: {
            input_tokens: number
            output_tokens: number
            output_tokens_details?: { reasoning_tokens?: number | null } | null
            input_tokens_details?: { cached_tokens?: number | null } | null
        }
    },
    options: {
        providerOptions?: any
        generateId?: () => string
        url?: string // not used here but maybe useful context
    },
): {
    content: Array<LanguageModelV2Content>
    providerMetadata: SharedV2ProviderMetadata
    finishReason: LanguageModelV2FinishReason
    usage: LanguageModelV2Usage
} {
    const content: Array<LanguageModelV2Content> = []
    const logprobs: Array<z.infer<typeof LOGPROBS_SCHEMA>> = []

    // flag that checks if there have been client-side tool calls (not executed by openai)
    let hasFunctionCall = false

    // map response content to content array
    for (const part of response.output) {
        switch (part.type) {
            case "reasoning": {
                // when there are no summary parts, we need to add an empty reasoning part:
                if (part.summary.length === 0) {
                    part.summary.push({ type: "summary_text", text: "" })
                }

                for (const summary of part.summary) {
                    content.push({
                        type: "reasoning" as const,
                        text: summary.text,
                        providerMetadata: {
                            openai: {
                                itemId: part.id,
                                // reasoningEncryptedContent not in basic response output usually?
                                // The snippet showed it in streaming chunks but also in `response.output` schema in the main file
                                // Let's assume it's there if the schema allows it.
                                // In main file: z.object({ type: z.literal("reasoning"), ... encrypted_content: z.string().nullish() ... })
                                // So we should handle it if passed.
                                reasoningEncryptedContent: (part as any).encrypted_content ?? null,
                            },
                        },
                    })
                }
                break
            }

            case "image_generation_call": {
                content.push({
                    type: "tool-call",
                    toolCallId: part.id,
                    toolName: "image_generation",
                    input: "{}",
                    providerExecuted: true,
                })

                content.push({
                    type: "tool-result",
                    toolCallId: part.id,
                    toolName: "image_generation",
                    result: {
                        result: part.result,
                    } satisfies z.infer<typeof imageGenerationOutputSchema>,
                    providerExecuted: true,
                })

                break
            }

            case "local_shell_call": {
                content.push({
                    type: "tool-call",
                    toolCallId: part.call_id,
                    toolName: "local_shell",
                    input: JSON.stringify({ action: part.action } satisfies z.infer<typeof localShellInputSchema>),
                    providerMetadata: {
                        openai: {
                            itemId: part.id,
                        },
                    },
                })

                break
            }

            case "message": {
                for (const contentPart of part.content) {
                    if (options.providerOptions?.openai?.logprobs && contentPart.logprobs) {
                        logprobs.push(contentPart.logprobs)
                    }

                    content.push({
                        type: "text",
                        text: contentPart.text,
                        providerMetadata: {
                            openai: {
                                itemId: part.id,
                            },
                        },
                    })

                    for (const annotation of contentPart.annotations) {
                        if (annotation.type === "url_citation") {
                            content.push({
                                type: "source",
                                sourceType: "url",
                                id: options.generateId?.() ?? generateId(),
                                url: annotation.url,
                                title: annotation.title,
                            })
                        } else if (annotation.type === "file_citation") {
                            content.push({
                                type: "source",
                                sourceType: "document",
                                id: options.generateId?.() ?? generateId(),
                                mediaType: "text/plain",
                                title: annotation.quote ?? annotation.filename ?? "Document",
                                filename: annotation.filename ?? annotation.file_id,
                            })
                        }
                    }
                }

                break
            }

            case "function_call": {
                hasFunctionCall = true

                content.push({
                    type: "tool-call",
                    toolCallId: part.call_id,
                    toolName: part.name,
                    input: part.arguments,
                    providerMetadata: {
                        openai: {
                            itemId: part.id,
                        },
                    },
                })
                break
            }

            case "web_search_call": {
                // webSearchToolName not passed? The main file logic used `webSearchToolName ?? "web_search"`
                // We need to pass it in options.
                const webSearchToolName = (options as any).webSearchToolName ?? "web_search"

                content.push({
                    type: "tool-call",
                    toolCallId: part.id,
                    toolName: webSearchToolName,
                    input: JSON.stringify({ action: part.action }),
                    providerExecuted: true,
                })

                content.push({
                    type: "tool-result",
                    toolCallId: part.id,
                    toolName: webSearchToolName,
                    result: { status: part.status },
                    providerExecuted: true,
                })

                break
            }

            case "computer_call": {
                content.push({
                    type: "tool-call",
                    toolCallId: part.id,
                    toolName: "computer_use",
                    input: "",
                    providerExecuted: true,
                })

                content.push({
                    type: "tool-result",
                    toolCallId: part.id,
                    toolName: "computer_use",
                    result: {
                        type: "computer_use_tool_result",
                        status: part.status || "completed",
                    },
                    providerExecuted: true,
                })
                break
            }

            case "file_search_call": {
                content.push({
                    type: "tool-call",
                    toolCallId: part.id,
                    toolName: "file_search",
                    input: "{}",
                    providerExecuted: true,
                })

                content.push({
                    type: "tool-result",
                    toolCallId: part.id,
                    toolName: "file_search",
                    result: {
                        queries: part.queries,
                        results:
                            part.results?.map((result: any) => ({
                                attributes: result.attributes,
                                fileId: result.file_id,
                                filename: result.filename,
                                score: result.score,
                                text: result.text,
                            })) ?? null,
                    } satisfies z.infer<typeof fileSearchOutputSchema>,
                    providerExecuted: true,
                })
                break
            }

            case "code_interpreter_call": {
                content.push({
                    type: "tool-call",
                    toolCallId: part.id,
                    toolName: "code_interpreter",
                    input: JSON.stringify({
                        code: part.code,
                        containerId: part.container_id,
                    } satisfies z.infer<typeof codeInterpreterInputSchema>),
                    providerExecuted: true,
                })

                content.push({
                    type: "tool-result",
                    toolCallId: part.id,
                    toolName: "code_interpreter",
                    result: {
                        outputs: part.outputs,
                    } satisfies z.infer<typeof codeInterpreterOutputSchema>,
                    providerExecuted: true,
                })
                break
            }
        }
    }

    const providerMetadata: SharedV2ProviderMetadata = {
        openai: { responseId: response.id },
    }

    if (logprobs.length > 0) {
        providerMetadata.openai.logprobs = logprobs
    }

    if (typeof response.service_tier === "string") {
        providerMetadata.openai.serviceTier = response.service_tier
    }

    return {
        content,
        finishReason: mapOpenAIResponseFinishReason({
            finishReason: response.incomplete_details?.reason,
            hasFunctionCall,
        }),
        usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens ?? undefined,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? undefined,
        },
        providerMetadata,
    }
}
