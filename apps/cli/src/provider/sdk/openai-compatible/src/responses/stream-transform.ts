import {
    type LanguageModelV2StreamPart,
    type LanguageModelV2FinishReason,
    type LanguageModelV2Usage,
    type SharedV2ProviderMetadata,
} from "@ai-sdk/provider"
import { type ParseResult } from "@ai-sdk/provider-utils"
import { z } from "zod/v4"
import {
    openaiResponsesChunkSchema,
} from "./schemas"
import { type StreamContext, type StreamOptions } from "./stream-transform/types"
import { handleChunk } from "./stream-transform/handlers"

export function createStreamTransform(
    options: StreamOptions,
    warnings: any[],
) {
    const ctx: StreamContext = {
        finishReason: "unknown",
        usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
        },
        logprobs: [],
        responseId: null,
        ongoingToolCalls: {},
        hasFunctionCall: false,
        activeReasoning: {},
        currentTextId: null,
        serviceTier: undefined,
        options,
        warnings,
    }

    return new TransformStream<ParseResult<z.infer<typeof openaiResponsesChunkSchema>>, LanguageModelV2StreamPart>({
        start(controller) {
            if (ctx.warnings.length > 0) {
                controller.enqueue({ type: "stream-start", warnings: ctx.warnings })
            }
        },

        transform(chunk, controller) {
            handleChunk(chunk, controller, ctx)
        },

        flush(controller) {
            if (ctx.currentTextId) {
                controller.enqueue({ type: "text-end", id: ctx.currentTextId })
                ctx.currentTextId = null
            }

            const providerMetadata: SharedV2ProviderMetadata = {
                openai: {
                    responseId: ctx.responseId,
                },
            }

            if (ctx.logprobs.length > 0) {
                providerMetadata.openai.logprobs = ctx.logprobs
            }

            if (ctx.serviceTier !== undefined) {
                providerMetadata.openai.serviceTier = ctx.serviceTier
            }

            controller.enqueue({
                type: "finish",
                finishReason: ctx.finishReason,
                usage: ctx.usage,
                providerMetadata,
            })
        },
    })
}
