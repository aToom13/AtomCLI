import type { AgentSideConnection, ToolCallContent, PlanEntry } from "@agentclientprotocol/sdk"
import type { SessionMessageResponse } from "@atomcli/sdk/v2"
import { Log } from "../util/log"
import { Todo } from "@/session/todo"
import { z } from "zod"
import { toToolKind, toLocations } from "./utils"

const log = Log.create({ service: "acp-message-processor" })

export async function processMessage(message: SessionMessageResponse, connection: AgentSideConnection) {
    log.debug("process message", message)
    if (message.info.role !== "assistant" && message.info.role !== "user") return
    const sessionId = message.info.sessionID

    for (const part of message.parts) {
        if (part.type === "tool") {
            switch (part.state.status) {
                case "pending":
                    await connection
                        .sessionUpdate({
                            sessionId,
                            update: {
                                sessionUpdate: "tool_call",
                                toolCallId: part.callID,
                                title: part.tool,
                                kind: toToolKind(part.tool),
                                status: "pending",
                                locations: [],
                                rawInput: {},
                            },
                        })
                        .catch((err) => {
                            log.error("failed to send tool pending to ACP", { error: err })
                        })
                    break
                case "running":
                    await connection
                        .sessionUpdate({
                            sessionId,
                            update: {
                                sessionUpdate: "tool_call_update",
                                toolCallId: part.callID,
                                status: "in_progress",
                                kind: toToolKind(part.tool),
                                title: part.tool,
                                locations: toLocations(part.tool, part.state.input),
                                rawInput: part.state.input,
                            },
                        })
                        .catch((err) => {
                            log.error("failed to send tool in_progress to ACP", { error: err })
                        })
                    break
                case "completed":
                    const kind = toToolKind(part.tool)
                    const content: ToolCallContent[] = [
                        {
                            type: "content",
                            content: {
                                type: "text",
                                text: part.state.output,
                            },
                        },
                    ]

                    if (kind === "edit") {
                        const input = part.state.input
                        const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
                        const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
                        const newText =
                            typeof input["newString"] === "string"
                                ? input["newString"]
                                : typeof input["content"] === "string"
                                    ? input["content"]
                                    : ""
                        content.push({
                            type: "diff",
                            path: filePath,
                            oldText,
                            newText,
                        })
                    }

                    if (part.tool === "todowrite") {
                        const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
                        if (parsedTodos.success) {
                            await connection
                                .sessionUpdate({
                                    sessionId,
                                    update: {
                                        sessionUpdate: "plan",
                                        entries: parsedTodos.data.map((todo) => {
                                            const status: PlanEntry["status"] =
                                                todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                                            return {
                                                priority: "medium",
                                                status,
                                                content: todo.content,
                                            }
                                        }),
                                    },
                                })
                                .catch((err) => {
                                    log.error("failed to send session update for todo", { error: err })
                                })
                        } else {
                            log.error("failed to parse todo output", { error: parsedTodos.error })
                        }
                    }

                    await connection
                        .sessionUpdate({
                            sessionId,
                            update: {
                                sessionUpdate: "tool_call_update",
                                toolCallId: part.callID,
                                status: "completed",
                                kind,
                                content,
                                title: part.state.title,
                                rawInput: part.state.input,
                                rawOutput: {
                                    output: part.state.output,
                                    metadata: part.state.metadata,
                                },
                            },
                        })
                        .catch((err) => {
                            log.error("failed to send tool completed to ACP", { error: err })
                        })
                    break
                case "error":
                    await connection
                        .sessionUpdate({
                            sessionId,
                            update: {
                                sessionUpdate: "tool_call_update",
                                toolCallId: part.callID,
                                status: "failed",
                                kind: toToolKind(part.tool),
                                title: part.tool,
                                rawInput: part.state.input,
                                content: [
                                    {
                                        type: "content",
                                        content: {
                                            type: "text",
                                            text: part.state.error,
                                        },
                                    },
                                ],
                                rawOutput: {
                                    error: part.state.error,
                                },
                            },
                        })
                        .catch((err) => {
                            log.error("failed to send tool error to ACP", { error: err })
                        })
                    break
            }
        } else if (part.type === "text") {
            if (part.text) {
                await connection
                    .sessionUpdate({
                        sessionId,
                        update: {
                            sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                            content: {
                                type: "text",
                                text: part.text,
                            },
                        },
                    })
                    .catch((err) => {
                        log.error("failed to send text to ACP", { error: err })
                    })
            }
        } else if (part.type === "reasoning") {
            if (part.text) {
                await connection
                    .sessionUpdate({
                        sessionId,
                        update: {
                            sessionUpdate: "agent_thought_chunk",
                            content: {
                                type: "text",
                                text: part.text,
                            },
                        },
                    })
                    .catch((err) => {
                        log.error("failed to send reasoning to ACP", { error: err })
                    })
            }
        }
    }
}
