import { z } from "zod/v4"
import { codeInterpreterInputSchema, codeInterpreterOutputSchema } from "./tool/code-interpreter"
import { fileSearchOutputSchema } from "./tool/file-search"
import { imageGenerationOutputSchema } from "./tool/image-generation"
import { localShellInputSchema } from "./tool/local-shell"

export {
    codeInterpreterInputSchema,
    codeInterpreterOutputSchema,
    fileSearchOutputSchema,
    imageGenerationOutputSchema,
    localShellInputSchema
}

export const webSearchCallItem = z.object({
    type: z.literal("web_search_call"),
    id: z.string(),
    status: z.string(),
    action: z
        .discriminatedUnion("type", [
            z.object({
                type: z.literal("search"),
                query: z.string().nullish(),
            }),
            z.object({
                type: z.literal("open_page"),
                url: z.string(),
            }),
            z.object({
                type: z.literal("find"),
                url: z.string(),
                pattern: z.string(),
            }),
        ])
        .nullish(),
})

export const fileSearchCallItem = z.object({
    type: z.literal("file_search_call"),
    id: z.string(),
    queries: z.array(z.string()),
    results: z
        .array(
            z.object({
                attributes: z.record(z.string(), z.unknown()),
                file_id: z.string(),
                filename: z.string(),
                score: z.number(),
                text: z.string(),
            }),
        )
        .nullish(),
})

export const codeInterpreterCallItem = z.object({
    type: z.literal("code_interpreter_call"),
    id: z.string(),
    code: z.string().nullable(),
    container_id: z.string(),
    outputs: z
        .array(
            z.discriminatedUnion("type", [
                z.object({ type: z.literal("logs"), logs: z.string() }),
                z.object({ type: z.literal("image"), url: z.string() }),
            ]),
        )
        .nullable(),
})

export const localShellCallItem = z.object({
    type: z.literal("local_shell_call"),
    id: z.string(),
    call_id: z.string(),
    action: z.object({
        type: z.literal("exec"),
        command: z.array(z.string()),
        timeout_ms: z.number().optional(),
        user: z.string().optional(),
        working_directory: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
    }),
})

export const imageGenerationCallItem = z.object({
    type: z.literal("image_generation_call"),
    id: z.string(),
    result: z.string(),
})

/**
 * `top_logprobs` request body argument can be set to an integer between
 * 0 and 20 specifying the number of most likely tokens to return at each
 * token position, each with an associated log probability.
 *
 * @see https://platform.openai.com/docs/api-reference/responses/create#responses_create-top_logprobs
 */
export const TOP_LOGPROBS_MAX = 20

export const LOGPROBS_SCHEMA = z.array(
    z.object({
        token: z.string(),
        logprob: z.number(),
        top_logprobs: z.array(
            z.object({
                token: z.string(),
                logprob: z.number(),
            }),
        ),
    }),
)

export const usageSchema = z.object({
    input_tokens: z.number(),
    input_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
    output_tokens: z.number(),
    output_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
})

export const textDeltaChunkSchema = z.object({
    type: z.literal("response.output_text.delta"),
    item_id: z.string(),
    delta: z.string(),
    logprobs: LOGPROBS_SCHEMA.nullish(),
})

export const errorChunkSchema = z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    param: z.string().nullish(),
    sequence_number: z.number(),
})

export const responseFinishedChunkSchema = z.object({
    type: z.enum(["response.completed", "response.incomplete"]),
    response: z.object({
        incomplete_details: z.object({ reason: z.string() }).nullish(),
        usage: usageSchema,
        service_tier: z.string().nullish(),
    }),
})

export const responseCreatedChunkSchema = z.object({
    type: z.literal("response.created"),
    response: z.object({
        id: z.string(),
        created_at: z.number(),
        model: z.string(),
        service_tier: z.string().nullish(),
    }),
})

export const responseOutputItemAddedSchema = z.object({
    type: z.literal("response.output_item.added"),
    output_index: z.number(),
    item: z.discriminatedUnion("type", [
        z.object({
            type: z.literal("message"),
            id: z.string(),
        }),
        z.object({
            type: z.literal("reasoning"),
            id: z.string(),
            encrypted_content: z.string().nullish(),
        }),
        z.object({
            type: z.literal("function_call"),
            id: z.string(),
            call_id: z.string(),
            name: z.string(),
            arguments: z.string(),
        }),
        z.object({
            type: z.literal("web_search_call"),
            id: z.string(),
            status: z.string(),
            action: z
                .object({
                    type: z.literal("search"),
                    query: z.string().optional(),
                })
                .nullish(),
        }),
        z.object({
            type: z.literal("computer_call"),
            id: z.string(),
            status: z.string(),
        }),
        z.object({
            type: z.literal("file_search_call"),
            id: z.string(),
        }),
        z.object({
            type: z.literal("image_generation_call"),
            id: z.string(),
        }),
        z.object({
            type: z.literal("code_interpreter_call"),
            id: z.string(),
            container_id: z.string(),
            code: z.string().nullable(),
            outputs: z
                .array(
                    z.discriminatedUnion("type", [
                        z.object({ type: z.literal("logs"), logs: z.string() }),
                        z.object({ type: z.literal("image"), url: z.string() }),
                    ]),
                )
                .nullable(),
            status: z.string(),
        }),
    ]),
})

export const responseOutputItemDoneSchema = z.object({
    type: z.literal("response.output_item.done"),
    output_index: z.number(),
    item: z.discriminatedUnion("type", [
        z.object({
            type: z.literal("message"),
            id: z.string(),
        }),
        z.object({
            type: z.literal("reasoning"),
            id: z.string(),
            encrypted_content: z.string().nullish(),
        }),
        z.object({
            type: z.literal("function_call"),
            id: z.string(),
            call_id: z.string(),
            name: z.string(),
            arguments: z.string(),
            status: z.literal("completed"),
        }),
        codeInterpreterCallItem,
        imageGenerationCallItem,
        webSearchCallItem,
        fileSearchCallItem,
        localShellCallItem,
        z.object({
            type: z.literal("computer_call"),
            id: z.string(),
            status: z.literal("completed"),
        }),
    ]),
})

export const responseFunctionCallArgumentsDeltaSchema = z.object({
    type: z.literal("response.function_call_arguments.delta"),
    item_id: z.string(),
    output_index: z.number(),
    delta: z.string(),
})

export const responseImageGenerationCallPartialImageSchema = z.object({
    type: z.literal("response.image_generation_call.partial_image"),
    item_id: z.string(),
    output_index: z.number(),
    partial_image_b64: z.string(),
})

export const responseCodeInterpreterCallCodeDeltaSchema = z.object({
    type: z.literal("response.code_interpreter_call_code.delta"),
    item_id: z.string(),
    output_index: z.number(),
    delta: z.string(),
})

export const responseCodeInterpreterCallCodeDoneSchema = z.object({
    type: z.literal("response.code_interpreter_call_code.done"),
    item_id: z.string(),
    output_index: z.number(),
    code: z.string(),
})

export const responseAnnotationAddedSchema = z.object({
    type: z.literal("response.output_text.annotation.added"),
    annotation: z.discriminatedUnion("type", [
        z.object({
            type: z.literal("url_citation"),
            url: z.string(),
            title: z.string(),
        }),
        z.object({
            type: z.literal("file_citation"),
            file_id: z.string(),
            filename: z.string().nullish(),
            index: z.number().nullish(),
            start_index: z.number().nullish(),
            end_index: z.number().nullish(),
            quote: z.string().nullish(),
        }),
    ]),
})

export const responseReasoningSummaryPartAddedSchema = z.object({
    type: z.literal("response.reasoning_summary_part.added"),
    item_id: z.string(),
    summary_index: z.number(),
})

export const responseReasoningSummaryTextDeltaSchema = z.object({
    type: z.literal("response.reasoning_summary_text.delta"),
    item_id: z.string(),
    summary_index: z.number(),
    delta: z.string(),
})

export const openaiResponsesChunkSchema = z.union([
    textDeltaChunkSchema,
    responseFinishedChunkSchema,
    responseCreatedChunkSchema,
    responseOutputItemAddedSchema,
    responseOutputItemDoneSchema,
    responseFunctionCallArgumentsDeltaSchema,
    responseImageGenerationCallPartialImageSchema,
    responseCodeInterpreterCallCodeDeltaSchema,
    responseCodeInterpreterCallCodeDoneSchema,
    responseAnnotationAddedSchema,
    responseReasoningSummaryPartAddedSchema,
    responseReasoningSummaryTextDeltaSchema,
    errorChunkSchema,
    z.object({ type: z.string() }).loose(),
])

// Helper types for type guards
type ExtractByType<T, K extends T extends { type: infer U } ? U : never> = T extends { type: K } ? T : never

export function isTextDeltaChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof textDeltaChunkSchema> {
    return chunk.type === "response.output_text.delta"
}

export function isResponseOutputItemDoneChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseOutputItemDoneSchema> {
    return chunk.type === "response.output_item.done"
}

export function isResponseOutputItemDoneReasoningChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<
    typeof responseOutputItemDoneSchema
> & {
    item: ExtractByType<z.infer<typeof responseOutputItemDoneSchema>["item"], "reasoning">
} {
    return isResponseOutputItemDoneChunk(chunk) && chunk.item.type === "reasoning"
}

export function isResponseFinishedChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseFinishedChunkSchema> {
    return chunk.type === "response.completed" || chunk.type === "response.incomplete"
}

export function isResponseCreatedChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCreatedChunkSchema> {
    return chunk.type === "response.created"
}

export function isResponseFunctionCallArgumentsDeltaChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseFunctionCallArgumentsDeltaSchema> {
    return chunk.type === "response.function_call_arguments.delta"
}

export function isResponseImageGenerationCallPartialImageChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseImageGenerationCallPartialImageSchema> {
    return chunk.type === "response.image_generation_call.partial_image"
}

export function isResponseCodeInterpreterCallCodeDeltaChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCodeInterpreterCallCodeDeltaSchema> {
    return chunk.type === "response.code_interpreter_call_code.delta"
}

export function isResponseCodeInterpreterCallCodeDoneChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCodeInterpreterCallCodeDoneSchema> {
    return chunk.type === "response.code_interpreter_call_code.done"
}

export function isResponseOutputItemAddedChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseOutputItemAddedSchema> {
    return chunk.type === "response.output_item.added"
}

export function isResponseOutputItemAddedReasoningChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<
    typeof responseOutputItemAddedSchema
> & {
    item: ExtractByType<z.infer<typeof responseOutputItemAddedSchema>["item"], "reasoning">
} {
    return isResponseOutputItemAddedChunk(chunk) && chunk.item.type === "reasoning"
}

export function isResponseAnnotationAddedChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseAnnotationAddedSchema> {
    return chunk.type === "response.output_text.annotation.added"
}

export function isResponseReasoningSummaryPartAddedChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseReasoningSummaryPartAddedSchema> {
    return chunk.type === "response.reasoning_summary_part.added"
}

export function isResponseReasoningSummaryTextDeltaChunk(
    chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseReasoningSummaryTextDeltaSchema> {
    return chunk.type === "response.reasoning_summary_text.delta"
}

export function isErrorChunk(chunk: z.infer<typeof openaiResponsesChunkSchema>): chunk is z.infer<typeof errorChunkSchema> {
    return chunk.type === "error"
}

export const openaiResponsesProviderOptionsSchema = z.object({
    include: z
        .array(z.enum(["reasoning.encrypted_content", "file_search_call.results", "message.output_text.logprobs"]))
        .nullish(),
    instructions: z.string().nullish(),
    logprobs: z.union([z.boolean(), z.number().min(1).max(TOP_LOGPROBS_MAX)]).optional(),
    maxToolCalls: z.number().nullish(),
    metadata: z.any().nullish(),
    parallelToolCalls: z.boolean().nullish(),
    previousResponseId: z.string().nullish(),
    promptCacheKey: z.string().nullish(),
    reasoningEffort: z.string().nullish(),
    reasoningSummary: z.string().nullish(),
    safetyIdentifier: z.string().nullish(),
    serviceTier: z.enum(["auto", "flex", "priority"]).nullish(),
    store: z.boolean().nullish(),
    strictJsonSchema: z.boolean().nullish(),
    textVerbosity: z.enum(["low", "medium", "high"]).nullish(),
    user: z.string().nullish(),
})

export type OpenAIResponsesProviderOptions = z.infer<typeof openaiResponsesProviderOptionsSchema>
