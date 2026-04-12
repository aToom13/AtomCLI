import type { AgentSideConnection, PermissionOption, ToolCallContent, PlanEntry } from "@agentclientprotocol/sdk"
import type { AtomcliClient } from "@atomcli/sdk/v2"
import type { ACPSessionState } from "./types"
import { Log } from "../util/log"
import { Todo } from "@/session/todo"
import { z } from "zod"
import { toToolKind, toLocations, getNewContent } from "./utils"

const log = Log.create({ service: "acp-event-handler" })

export function setupEventSubscriptions(
    session: ACPSessionState,
    connection: AgentSideConnection,
    sdk: AtomcliClient,
) {
    const sessionId = session.id
    const directory = session.cwd

    const options: PermissionOption[] = [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
    ]
    sdk.event.subscribe({ directory }).then(async (events) => {
        for await (const event of events.stream) {
            switch (event.type) {
                case "permission.asked":
                    try {
                        const permission = event.properties
                        const res = await connection
                            .requestPermission({
                                sessionId,
                                toolCall: {
                                    toolCallId: permission.tool?.callID ?? permission.id,
                                    status: "pending",
                                    title: permission.permission,
                                    rawInput: permission.metadata,
                                    kind: toToolKind(permission.permission),
                                    locations: toLocations(permission.permission, permission.metadata),
                                },
                                options,
                            })
                            .catch(async (error) => {
                                log.error("failed to request permission from ACP", {
                                    error,
                                    permissionID: permission.id,
                                    sessionID: permission.sessionID,
                                })
                                await sdk.permission.reply({
                                    requestID: permission.id,
                                    reply: "reject",
                                    directory,
                                })
                                return
                            })
                        if (!res) return
                        if (res.outcome.outcome !== "selected") {
                            await sdk.permission.reply({
                                requestID: permission.id,
                                reply: "reject",
                                directory,
                            })
                            return
                        }
                        if (res.outcome.optionId !== "reject" && permission.permission == "edit") {
                            const metadata = permission.metadata || {}
                            const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
                            const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""

                            const content = await Bun.file(filepath).text()
                            const newContent = getNewContent(content, diff)

                            if (newContent) {
                                connection.writeTextFile({
                                    sessionId: sessionId,
                                    path: filepath,
                                    content: newContent,
                                })
                            }
                        }
                        await sdk.permission.reply({
                            requestID: permission.id,
                            reply: res.outcome.optionId as "once" | "always" | "reject",
                            directory,
                        })
                    } catch (err) {
                        log.error("unexpected error when handling permission", { error: err })
                    } finally {
                        break
                    }

                case "message.part.updated":
                    log.info("message part updated", { event: event.properties })
                    try {
                        const props = event.properties
                        const { part } = props

                        const message = await sdk.session
                            .message(
                                {
                                    sessionID: part.sessionID,
                                    messageID: part.messageID,
                                    directory,
                                },
                                { throwOnError: true },
                            )
                            .then((x) => x.data)
                            .catch((err) => {
                                log.error("unexpected error when fetching message", { error: err })
                                return undefined
                            })

                        if (!message || message.info.role !== "assistant") return

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
                            const delta = props.delta
                            if (delta && part.synthetic !== true) {
                                await connection
                                    .sessionUpdate({
                                        sessionId,
                                        update: {
                                            sessionUpdate: "agent_message_chunk",
                                            content: {
                                                type: "text",
                                                text: delta,
                                            },
                                        },
                                    })
                                    .catch((err) => {
                                        log.error("failed to send text to ACP", { error: err })
                                    })
                            }
                        } else if (part.type === "reasoning") {
                            const delta = props.delta
                            if (delta) {
                                await connection
                                    .sessionUpdate({
                                        sessionId,
                                        update: {
                                            sessionUpdate: "agent_thought_chunk",
                                            content: {
                                                type: "text",
                                                text: delta,
                                            },
                                        },
                                    })
                                    .catch((err) => {
                                        log.error("failed to send reasoning to ACP", { error: err })
                                    })
                            }
                        }
                    } finally {
                        break
                    }
            }
        }
    })
}
