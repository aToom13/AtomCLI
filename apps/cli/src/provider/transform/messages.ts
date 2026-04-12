import type { ModelMessage } from "ai"
import { unique } from "remeda"
import type { Provider } from "../provider"
import type { ModelsDev } from "../models"

type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

function mimeToModality(mime: string): Modality | undefined {
    if (mime.startsWith("image/")) return "image"
    if (mime.startsWith("audio/")) return "audio"
    if (mime.startsWith("video/")) return "video"
    if (mime === "application/pdf") return "pdf"
    return undefined
}

function normalizeMessages(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    // Anthropic rejects messages with empty content - filter out empty string messages
    // and remove empty text/reasoning parts from array content
    if (model.api.npm === "@ai-sdk/anthropic") {
        msgs = msgs
            .map((msg) => {
                if (typeof msg.content === "string") {
                    if (msg.content === "") return undefined
                    return msg
                }
                if (!Array.isArray(msg.content)) return msg
                const filtered = msg.content.filter((part) => {
                    if (part.type === "text" || part.type === "reasoning") {
                        return part.text !== ""
                    }
                    return true
                })
                if (filtered.length === 0) return undefined
                return { ...msg, content: filtered } as ModelMessage
            })
            .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
    }

    if (model.api.id.includes("claude")) {
        msgs = msgs.map((msg) => {
            if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
                const newContent = msg.content.map((part) => {
                    if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
                        return {
                            ...part,
                            toolCallId: (part as any).toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
                        }
                    }
                    return part
                })
                return { ...msg, content: newContent } as ModelMessage
            }
            return msg
        })
    }

    if (model.providerID === "mistral" || model.api.id.toLowerCase().includes("mistral")) {
        const result: ModelMessage[] = []
        for (let i = 0; i < msgs.length; i++) {
            let msg = msgs[i]
            const nextMsg = msgs[i + 1]

            if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
                const newContent = msg.content.map((part) => {
                    if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
                        // Mistral requires alphanumeric tool call IDs with exactly 9 characters
                        const normalizedId = (part as any).toolCallId
                            .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
                            .substring(0, 9) // Take first 9 characters
                            .padEnd(9, "0") // Pad with zeros if less than 9 characters

                        return {
                            ...part,
                            toolCallId: normalizedId,
                        }
                    }
                    return part
                })
                msg = { ...msg, content: newContent as any }
            }

            result.push(msg)

            // Fix message sequence: tool messages cannot be followed by user messages
            if (msg.role === "tool" && nextMsg?.role === "user") {
                result.push({
                    role: "assistant",
                    content: [
                        {
                            type: "text",
                            text: "Done.",
                        },
                    ],
                })
            }
        }
        msgs = result
    }

    if (
        model.capabilities.interleaved &&
        typeof model.capabilities.interleaved === "object" &&
        model.capabilities.interleaved.field === "reasoning_content"
    ) {
        msgs = msgs.map((msg) => {
            if (msg.role === "assistant" && Array.isArray(msg.content)) {
                const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
                const reasoningText = reasoningParts.map((part: any) => part.text).join("")

                // Filter out reasoning parts from content
                const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

                // Include reasoning_content directly on the message for all assistant messages
                if (reasoningText) {
                    return {
                        ...msg,
                        content: filteredContent,
                        providerOptions: {
                            ...msg.providerOptions,
                            openaiCompatible: {
                                ...(msg.providerOptions as any)?.openaiCompatible,
                                reasoning_content: reasoningText,
                            },
                        },
                    } as ModelMessage
                }

                return {
                    ...msg,
                    content: filteredContent,
                } as ModelMessage
            }

            return msg
        })
    }

    return msgs
}

function applyCaching(msgs: ModelMessage[], providerID: string): ModelMessage[] {
    const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
    const final = msgs.filter((msg) => msg.role !== "system").slice(-2)
    const targets = unique([...system, ...final])

    const providerOptions = {
        anthropic: {
            cacheControl: { type: "ephemeral" },
        },
        openrouter: {
            cacheControl: { type: "ephemeral" },
        },
        bedrock: {
            cachePoint: { type: "ephemeral" },
        },
        openaiCompatible: {
            cache_control: { type: "ephemeral" },
        },
    }

    return msgs.map((msg) => {
        if (!targets.includes(msg)) {
            return msg
        }

        const shouldUseContentOptions = providerID !== "anthropic" && Array.isArray(msg.content) && msg.content.length > 0

        if (shouldUseContentOptions) {
            const lastContent = msg.content[msg.content.length - 1] as any
            if (lastContent && typeof lastContent === "object") {
                const newLastContent = {
                    ...lastContent,
                    providerOptions: {
                        ...lastContent.providerOptions,
                        ...providerOptions,
                    },
                }
                return {
                    ...msg,
                    content: [...msg.content.slice(0, -1), newLastContent] as any,
                }
            }
        }

        return {
            ...msg,
            providerOptions: {
                ...msg.providerOptions,
                ...providerOptions,
            },
        }
    })
}

function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
    return msgs.map((msg) => {
        if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

        const filtered = msg.content.map((part) => {
            if (part.type !== "file" && part.type !== "image") return part

            // Check for empty base64 image data
            if (part.type === "image") {
                const imageStr = part.image.toString()
                if (imageStr.startsWith("data:")) {
                    const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
                    if (match && (!match[2] || match[2].length === 0)) {
                        return {
                            type: "text" as const,
                            text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
                        }
                    }
                }
            }

            const mime = part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : (part as any).mediaType
            const filename = part.type === "file" ? (part as any).filename : undefined
            const modality = mimeToModality(mime)
            if (!modality) return part
            if (model.capabilities.input[modality]) return part

            const name = filename ? `"${filename}"` : modality
            return {
                type: "text" as const,
                text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
            }
        })

        return { ...msg, content: filtered } as ModelMessage
    })
}

export function message(msgs: ModelMessage[], model: Provider.Model) {
    msgs = unsupportedParts(msgs, model)
    msgs = normalizeMessages(msgs, model)
    if (
        model.providerID === "anthropic" ||
        model.api.id.includes("anthropic") ||
        model.api.id.includes("claude") ||
        model.api.npm === "@ai-sdk/anthropic"
    ) {
        msgs = applyCaching(msgs, model.providerID)
    }

    return msgs
}
