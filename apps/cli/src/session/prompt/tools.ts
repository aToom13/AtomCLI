import type { ToolCallOptions } from "@ai-sdk/provider"
import { type AITool, tool } from "ai"
import { z } from "zod"
import { zodToJsonSchema as jsonSchema } from "zod-to-json-schema"
import { Agent } from "../../acp/agent"
import type { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { Session } from "../../session"
import { SessionProcessor } from "../processor"
import { Log } from "../../util/log"
import { PermissionNext } from "../../permission/next"
import { ToolRegistry } from "../../tool/registry"
import { Plugin } from "../../plugin"
import { MCP } from "../../mcp"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import type { Tool } from "../../tool/tool"

const log = Log.create({ service: "session", file: "prompt/tools" })

export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
}) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
        agent: input.agent.name,
        metadata: async (val: { title?: string; metadata?: any }) => {
            const match = input.processor.partFromToolCall(options.toolCallId)
            if (match && match.state.status === "running") {
                await Session.updatePart({
                    ...match,
                    state: {
                        title: val.title,
                        metadata: val.metadata,
                        status: "running",
                        input: args,
                        time: {
                            start: Date.now(),
                        },
                    },
                })
            }
        },
        async ask(req) {
            await PermissionNext.ask({
                ...req,
                sessionID: input.session.id,
                tool: { messageID: input.processor.message.id, callID: options.toolCallId },
                ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
            })
        },
    })

    for (const item of await ToolRegistry.tools(input.model.providerID, input.agent)) {
        const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
        tools[item.id] = tool({
            id: item.id as any,
            description: item.description,
            inputSchema: jsonSchema(schema as any),
            async execute(args, options) {
                const ctx = context(args, options)
                await Plugin.trigger(
                    "tool.execute.before",
                    {
                        tool: item.id,
                        sessionID: ctx.sessionID,
                        callID: ctx.callID,
                    },
                    {
                        args,
                    },
                )
                const result = await item.execute(args, ctx)
                await Plugin.trigger(
                    "tool.execute.after",
                    {
                        tool: item.id,
                        sessionID: ctx.sessionID,
                        callID: ctx.callID,
                    },
                    result,
                )
                return result
            },
            toModelOutput(result) {
                return {
                    type: "text",
                    value: result.output,
                }
            },
        })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
        const execute = item.execute
        if (!execute) continue

        // Wrap execute to add plugin hooks and format output
        item.execute = async (args, opts) => {
            const ctx = context(args, opts)

            await Plugin.trigger(
                "tool.execute.before",
                {
                    tool: key,
                    sessionID: ctx.sessionID,
                    callID: opts.toolCallId,
                },
                {
                    args,
                },
            )

            await ctx.ask({
                permission: key,
                metadata: {},
                patterns: ["*"],
                always: ["*"],
            })

            const result = await execute(args, opts)

            await Plugin.trigger(
                "tool.execute.after",
                {
                    tool: key,
                    sessionID: ctx.sessionID,
                    callID: opts.toolCallId,
                },
                result,
            )

            const textParts: string[] = []
            const attachments: MessageV2.FilePart[] = []

            for (const contentItem of result.content) {
                if (contentItem.type === "text") {
                    textParts.push(contentItem.text)
                } else if (contentItem.type === "image") {
                    attachments.push({
                        id: Identifier.ascending("part"),
                        sessionID: input.session.id,
                        messageID: input.processor.message.id,
                        type: "file",
                        mime: contentItem.mimeType,
                        url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                    })
                }
                // Add support for other types if needed
            }

            return {
                title: "",
                metadata: result.metadata ?? {},
                output: textParts.join("\n\n"),
                attachments,
                content: result.content, // directly return content to preserve ordering when outputting to model
            }
        }
        item.toModelOutput = (result) => {
            return {
                type: "text",
                value: result.output,
            }
        }
        tools[key] = item
    }

    return tools
}
