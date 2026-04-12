import {
    type LanguageModelV2StreamPart,
    type LanguageModelV2FinishReason,
    type LanguageModelV2Usage,
} from "@ai-sdk/provider"
import { z } from "zod/v4"
import { LOGPROBS_SCHEMA } from "../schemas"

export interface StreamOptions {
    includeRawChunks?: boolean
    providerOptions?: any
    webSearchToolName?: string
    generateId?: () => string
}

export interface StreamContext {
    finishReason: LanguageModelV2FinishReason
    usage: LanguageModelV2Usage
    logprobs: Array<z.infer<typeof LOGPROBS_SCHEMA>>
    responseId: string | null
    ongoingToolCalls: Record<
        number,
        | {
            toolName: string
            toolCallId: string
            codeInterpreter?: {
                containerId: string
            }
        }
        | undefined
    >
    hasFunctionCall: boolean
    activeReasoning: Record<
        string,
        {
            encryptedContent?: string | null
            summaryParts: number[]
        }
    >
    currentTextId: string | null
    serviceTier: string | undefined
    options: StreamOptions
    warnings: any[]
}
