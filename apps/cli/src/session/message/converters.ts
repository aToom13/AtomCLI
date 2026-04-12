import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import { Identifier } from "../../id/id"
import { AbortedError } from "./errors"
import { WithParts } from "./types"

export function toModelMessage(input: WithParts[]): ModelMessage[] {
    const result: UIMessage[] = []

    for (const msg of input) {
        if (msg.parts.length === 0) continue

        if (msg.info.role === "user") {
            const userMessage: UIMessage = {
                id: msg.info.id,
                role: "user",
                parts: [],
            }
            result.push(userMessage)
            for (const part of msg.parts) {
                if (part.type === "text" && !part.ignored)
                    userMessage.parts.push({
                        type: "text",
                        text: part.text,
                    })
                // text/plain and directory files are converted into text parts, ignore them
                if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory")
                    userMessage.parts.push({
                        type: "file",
                        url: part.url,
                        mediaType: part.mime,
                        filename: part.filename,
                    })

                if (part.type === "compaction") {
                    userMessage.parts.push({
                        type: "text",
                        text: "What did we do so far?",
                    })
                }
                if (part.type === "subtask") {
                    userMessage.parts.push({
                        type: "text",
                        text: "The following tool was executed by the user",
                    })
                }
            }
        }

        if (msg.info.role === "assistant") {
            if (
                msg.info.error &&
                !(
                    AbortedError.isInstance(msg.info.error) &&
                    msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
                )
            ) {
                continue
            }
            const assistantMessage: UIMessage = {
                id: msg.info.id,
                role: "assistant",
                parts: [],
            }
            for (const part of msg.parts) {
                if (part.type === "text")
                    assistantMessage.parts.push({
                        type: "text",
                        text: part.text,
                        providerMetadata: part.metadata,
                    })
                if (part.type === "step-start")
                    assistantMessage.parts.push({
                        type: "step-start",
                    })
                if (part.type === "tool") {
                    if (part.state.status === "completed") {
                        if (part.state.attachments?.length) {
                            result.push({
                                id: Identifier.ascending("message"),
                                role: "user",
                                parts: [
                                    {
                                        type: "text",
                                        text: `Tool ${part.tool} returned an attachment:`,
                                    },
                                    ...part.state.attachments.map((attachment) => ({
                                        type: "file" as const,
                                        url: attachment.url,
                                        mediaType: attachment.mime,
                                        filename: attachment.filename,
                                    })),
                                ],
                            })
                        }
                        assistantMessage.parts.push({
                            type: ("tool-" + part.tool) as `tool-${string}`,
                            state: "output-available",
                            toolCallId: part.callID,
                            input: part.state.input,
                            output: part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output,
                            callProviderMetadata: part.metadata,
                        })
                    }
                    if (part.state.status === "error")
                        assistantMessage.parts.push({
                            type: ("tool-" + part.tool) as `tool-${string}`,
                            state: "output-error",
                            toolCallId: part.callID,
                            input: part.state.input,
                            errorText: part.state.error,
                            callProviderMetadata: part.metadata,
                        })
                }
                if (part.type === "reasoning") {
                    assistantMessage.parts.push({
                        type: "reasoning",
                        text: part.text,
                        providerMetadata: part.metadata,
                    })
                }
            }
            if (assistantMessage.parts.length > 0) {
                result.push(assistantMessage)
            }
        }
    }

    return convertToModelMessages(result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")))
}

export async function filterCompacted(stream: AsyncIterable<WithParts>) {
    const result = [] as WithParts[]
    const completed = new Set<string>()
    for await (const msg of stream) {
        result.push(msg)
        if (
            msg.info.role === "user" &&
            completed.has(msg.info.id) &&
            msg.parts.some((part) => part.type === "compaction")
        )
            break
        if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish) completed.add(msg.info.parentID)
    }
    result.reverse()
    return result
}
