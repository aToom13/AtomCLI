import {
    type LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { generateId } from "@ai-sdk/provider-utils"
import {
    isTextDeltaChunk,
    isResponseOutputItemDoneChunk,
    isResponseOutputItemDoneReasoningChunk,
    isResponseFinishedChunk,
    isResponseCreatedChunk,
    isResponseFunctionCallArgumentsDeltaChunk,
    isResponseImageGenerationCallPartialImageChunk,
    isResponseCodeInterpreterCallCodeDeltaChunk,
    isResponseCodeInterpreterCallCodeDoneChunk,
    isResponseOutputItemAddedChunk,
    isResponseOutputItemAddedReasoningChunk,
    isResponseAnnotationAddedChunk,
    isResponseReasoningSummaryPartAddedChunk,
    isResponseReasoningSummaryTextDeltaChunk,
    isErrorChunk,
    imageGenerationOutputSchema,
    codeInterpreterOutputSchema,
    codeInterpreterInputSchema,
    fileSearchOutputSchema,
    localShellInputSchema,
} from "../schemas"
import { mapOpenAIResponseFinishReason } from "../map-openai-responses-finish-reason"
import { type StreamContext } from "./types"

export function handleChunk(
    chunk: any,
    controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
    ctx: StreamContext,
) {
    if (ctx.options.includeRawChunks) {
        controller.enqueue({ type: "raw", rawValue: chunk.rawValue })
    }

    if (!chunk.success) {
        ctx.finishReason = "error"
        controller.enqueue({ type: "error", error: chunk.error })
        return
    }

    const value = chunk.value

    if (isResponseOutputItemAddedChunk(value)) {
        handleOutputItemAdded(value, controller, ctx)
    } else if (isResponseOutputItemDoneChunk(value)) {
        handleOutputItemDone(value, controller, ctx)
    } else if (isResponseFunctionCallArgumentsDeltaChunk(value)) {
        handleFunctionCallArgumentsDelta(value, controller, ctx)
    } else if (isResponseImageGenerationCallPartialImageChunk(value)) {
        handleImageGenerationCallPartialImage(value, controller, ctx)
    } else if (isResponseCodeInterpreterCallCodeDeltaChunk(value)) {
        handleCodeInterpreterCallCodeDelta(value, controller, ctx)
    } else if (isResponseCodeInterpreterCallCodeDoneChunk(value)) {
        handleCodeInterpreterCallCodeDone(value, controller, ctx)
    } else if (isResponseCreatedChunk(value)) {
        handleResponseCreated(value, controller, ctx)
    } else if (isTextDeltaChunk(value)) {
        handleTextDelta(value, controller, ctx)
    } else if (isResponseReasoningSummaryPartAddedChunk(value)) {
        handleReasoningSummaryPartAdded(value, controller, ctx)
    } else if (isResponseReasoningSummaryTextDeltaChunk(value)) {
        handleReasoningSummaryTextDelta(value, controller, ctx)
    } else if (isResponseFinishedChunk(value)) {
        handleResponseFinished(value, controller, ctx)
    } else if (isResponseAnnotationAddedChunk(value)) {
        handleAnnotationAdded(value, controller, ctx)
    } else if (isErrorChunk(value)) {
        controller.enqueue({ type: "error", error: value })
    }
}

function handleOutputItemAdded(value: any, controller: any, ctx: StreamContext) {
    if (value.item.type === "function_call") {
        ctx.ongoingToolCalls[value.output_index] = {
            toolName: value.item.name,
            toolCallId: value.item.call_id,
        }

        controller.enqueue({
            type: "tool-input-start",
            id: value.item.call_id,
            toolName: value.item.name,
        })
    } else if (value.item.type === "web_search_call") {
        ctx.ongoingToolCalls[value.output_index] = {
            toolName: ctx.options.webSearchToolName ?? "web_search",
            toolCallId: value.item.id,
        }

        controller.enqueue({
            type: "tool-input-start",
            id: value.item.id,
            toolName: ctx.options.webSearchToolName ?? "web_search",
        })
    } else if (value.item.type === "computer_call") {
        ctx.ongoingToolCalls[value.output_index] = {
            toolName: "computer_use",
            toolCallId: value.item.id,
        }

        controller.enqueue({
            type: "tool-input-start",
            id: value.item.id,
            toolName: "computer_use",
        })
    } else if (value.item.type === "code_interpreter_call") {
        ctx.ongoingToolCalls[value.output_index] = {
            toolName: "code_interpreter",
            toolCallId: value.item.id,
            codeInterpreter: {
                containerId: value.item.container_id,
            },
        }

        controller.enqueue({
            type: "tool-input-start",
            id: value.item.id,
            toolName: "code_interpreter",
        })

        controller.enqueue({
            type: "tool-input-delta",
            id: value.item.id,
            delta: `{"containerId":"${value.item.container_id}","code":"`,
        })
    } else if (value.item.type === "file_search_call") {
        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.id,
            toolName: "file_search",
            input: "{}",
            providerExecuted: true,
        })
    } else if (value.item.type === "image_generation_call") {
        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.id,
            toolName: "image_generation",
            input: "{}",
            providerExecuted: true,
        })
    } else if (value.item.type === "message") {
        ctx.currentTextId = value.item.id
        controller.enqueue({
            type: "text-start",
            id: value.item.id,
            providerMetadata: {
                openai: {
                    itemId: value.item.id,
                },
            },
        })
    } else if (isResponseOutputItemAddedReasoningChunk(value)) {
        ctx.activeReasoning[value.item.id] = {
            encryptedContent: value.item.encrypted_content,
            summaryParts: [0],
        }

        controller.enqueue({
            type: "reasoning-start",
            id: `${value.item.id}:0`,
            providerMetadata: {
                openai: {
                    itemId: value.item.id,
                    reasoningEncryptedContent: value.item.encrypted_content ?? null,
                },
            },
        })
    }
}

function handleOutputItemDone(value: any, controller: any, ctx: StreamContext) {
    if (value.item.type === "function_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined
        ctx.hasFunctionCall = true

        controller.enqueue({
            type: "tool-input-end",
            id: value.item.call_id,
        })

        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.call_id,
            toolName: value.item.name,
            input: value.item.arguments,
            providerMetadata: {
                openai: {
                    itemId: value.item.id,
                },
            },
        })
    } else if (value.item.type === "web_search_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined

        controller.enqueue({
            type: "tool-input-end",
            id: value.item.id,
        })

        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.id,
            toolName: "web_search",
            input: JSON.stringify({ action: value.item.action }),
            providerExecuted: true,
        })

        controller.enqueue({
            type: "tool-result",
            toolCallId: value.item.id,
            toolName: "web_search",
            result: { status: value.item.status },
            providerExecuted: true,
        })
    } else if (value.item.type === "computer_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined

        controller.enqueue({
            type: "tool-input-end",
            id: value.item.id,
        })

        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.id,
            toolName: "computer_use",
            input: "",
            providerExecuted: true,
        })

        controller.enqueue({
            type: "tool-result",
            toolCallId: value.item.id,
            toolName: "computer_use",
            result: {
                type: "computer_use_tool_result",
                status: value.item.status || "completed",
            },
            providerExecuted: true,
        })
    } else if (value.item.type === "file_search_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined

        controller.enqueue({
            type: "tool-result",
            toolCallId: value.item.id,
            toolName: "file_search",
            result: {
                queries: value.item.queries,
                results:
                    value.item.results?.map((result: any) => ({
                        attributes: result.attributes,
                        fileId: result.file_id,
                        filename: result.filename,
                        score: result.score,
                        text: result.text,
                    })) ?? null,
            } as any,
            providerExecuted: true,
        })
    } else if (value.item.type === "code_interpreter_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined

        controller.enqueue({
            type: "tool-result",
            toolCallId: value.item.id,
            toolName: "code_interpreter",
            result: {
                outputs: value.item.outputs,
            } as any,
            providerExecuted: true,
        })
    } else if (value.item.type === "image_generation_call") {
        controller.enqueue({
            type: "tool-result",
            toolCallId: value.item.id,
            toolName: "image_generation",
            result: {
                result: value.item.result,
            } as any,
            providerExecuted: true,
        })
    } else if (value.item.type === "local_shell_call") {
        ctx.ongoingToolCalls[value.output_index] = undefined

        controller.enqueue({
            type: "tool-call",
            toolCallId: value.item.call_id,
            toolName: "local_shell",
            input: JSON.stringify({
                action: {
                    type: "exec",
                    command: value.item.action.command,
                    timeoutMs: value.item.action.timeout_ms,
                    user: value.item.action.user,
                    workingDirectory: value.item.action.working_directory,
                    env: value.item.action.env,
                },
            }),
            providerMetadata: {
                openai: { itemId: value.item.id },
            },
        })
    } else if (value.item.type === "message") {
        if (ctx.currentTextId) {
            controller.enqueue({
                type: "text-end",
                id: ctx.currentTextId,
            })
            ctx.currentTextId = null
        }
    } else if (isResponseOutputItemDoneReasoningChunk(value)) {
        const activeReasoningPart = ctx.activeReasoning[value.item.id]
        if (activeReasoningPart) {
            for (const summaryIndex of activeReasoningPart.summaryParts) {
                controller.enqueue({
                    type: "reasoning-end",
                    id: `${value.item.id}:${summaryIndex}`,
                    providerMetadata: {
                        openai: {
                            itemId: value.item.id,
                            reasoningEncryptedContent: value.item.encrypted_content ?? null,
                        },
                    },
                })
            }
        }
        delete ctx.activeReasoning[value.item.id]
    }
}

function handleFunctionCallArgumentsDelta(value: any, controller: any, ctx: StreamContext) {
    const toolCall = ctx.ongoingToolCalls[value.output_index]

    if (toolCall != null) {
        controller.enqueue({
            type: "tool-input-delta",
            id: toolCall.toolCallId,
            delta: value.delta,
        })
    }
}

function handleImageGenerationCallPartialImage(value: any, controller: any, ctx: StreamContext) {
    controller.enqueue({
        type: "tool-result",
        toolCallId: value.item_id,
        toolName: "image_generation",
        result: {
            result: value.partial_image_b64,
        } as any,
        providerExecuted: true,
    })
}

function handleCodeInterpreterCallCodeDelta(value: any, controller: any, ctx: StreamContext) {
    const toolCall = ctx.ongoingToolCalls[value.output_index]

    if (toolCall != null) {
        controller.enqueue({
            type: "tool-input-delta",
            id: toolCall.toolCallId,
            delta: JSON.stringify(value.delta).slice(1, -1),
        })
    }
}

function handleCodeInterpreterCallCodeDone(value: any, controller: any, ctx: StreamContext) {
    const toolCall = ctx.ongoingToolCalls[value.output_index]

    if (toolCall != null) {
        controller.enqueue({
            type: "tool-input-delta",
            id: toolCall.toolCallId,
            delta: '"}',
        })

        controller.enqueue({
            type: "tool-input-end",
            id: toolCall.toolCallId,
        })

        controller.enqueue({
            type: "tool-call",
            toolCallId: toolCall.toolCallId,
            toolName: "code_interpreter",
            input: JSON.stringify({
                code: value.code,
                containerId: toolCall.codeInterpreter!.containerId,
            }),
            providerExecuted: true,
        })
    }
}

function handleResponseCreated(value: any, controller: any, ctx: StreamContext) {
    ctx.responseId = value.response.id
    controller.enqueue({
        type: "response-metadata",
        id: value.response.id,
        timestamp: new Date(value.response.created_at * 1000),
        modelId: value.response.model,
    })
}

function handleTextDelta(value: any, controller: any, ctx: StreamContext) {
    if (!ctx.currentTextId) {
        ctx.currentTextId = value.item_id
        controller.enqueue({
            type: "text-start",
            id: ctx.currentTextId,
            providerMetadata: {
                openai: { itemId: value.item_id },
            },
        })
    }

    controller.enqueue({
        type: "text-delta",
        id: ctx.currentTextId,
        delta: value.delta,
    })

    if (ctx.options.providerOptions?.openai?.logprobs && value.logprobs) {
        ctx.logprobs.push(value.logprobs)
    }
}

function handleReasoningSummaryPartAdded(value: any, controller: any, ctx: StreamContext) {
    if (value.summary_index > 0) {
        ctx.activeReasoning[value.item_id]?.summaryParts.push(value.summary_index)

        controller.enqueue({
            type: "reasoning-start",
            id: `${value.item_id}:${value.summary_index}`,
            providerMetadata: {
                openai: {
                    itemId: value.item_id,
                    reasoningEncryptedContent: ctx.activeReasoning[value.item_id]?.encryptedContent ?? null,
                },
            },
        })
    }
}

function handleReasoningSummaryTextDelta(value: any, controller: any, ctx: StreamContext) {
    controller.enqueue({
        type: "reasoning-delta",
        id: `${value.item_id}:${value.summary_index}`,
        delta: value.delta,
        providerMetadata: {
            openai: {
                itemId: value.item_id,
            },
        },
    })
}

function handleResponseFinished(value: any, controller: any, ctx: StreamContext) {
    ctx.finishReason = mapOpenAIResponseFinishReason({
        finishReason: value.response.incomplete_details?.reason,
        hasFunctionCall: ctx.hasFunctionCall,
    })
    ctx.usage.inputTokens = value.response.usage.input_tokens
    ctx.usage.outputTokens = value.response.usage.output_tokens
    ctx.usage.totalTokens = value.response.usage.input_tokens + value.response.usage.output_tokens
    const usage = ctx.usage as any
    usage.reasoningTokens = value.response.usage.output_tokens_details?.reasoning_tokens ?? undefined
    usage.cachedInputTokens = value.response.usage.input_tokens_details?.cached_tokens ?? undefined
    if (typeof value.response.service_tier === "string") {
        ctx.serviceTier = value.response.service_tier
    }
}

function handleAnnotationAdded(value: any, controller: any, ctx: StreamContext) {
    if (value.annotation.type === "url_citation") {
        controller.enqueue({
            type: "source",
            sourceType: "url",
            id: ctx.options.generateId?.() ?? generateId(),
            url: value.annotation.url,
            title: value.annotation.title,
        })
    } else if (value.annotation.type === "file_citation") {
        controller.enqueue({
            type: "source",
            sourceType: "document",
            id: ctx.options.generateId?.() ?? generateId(),
            mediaType: "text/plain",
            title: value.annotation.quote ?? value.annotation.filename ?? "Document",
            filename: value.annotation.filename ?? value.annotation.file_id,
        })
    }
}
