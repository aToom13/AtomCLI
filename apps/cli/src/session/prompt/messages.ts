import { fileURLToPath } from "bun"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { MCP } from "../../mcp"
import { ReadTool } from "../../tool/read"
import { ListTool } from "../../tool/ls"
import { FileTime } from "../../file/time"
import { LSP } from "../../lsp"
import { Plugin } from "../../plugin"
import { Session } from ".."
import { Bus } from "../../bus"
import { NamedError } from "@atomcli/util/error"
import { ConfigMarkdown } from "../../config/markdown"
import { Skill } from "../../skill"
import { PermissionNext } from "../../permission/next"
import type { PromptInput } from "./types"
import PROMPT_PLAN from "./plan.txt"
import BUILD_SWITCH from "./build-switch.txt"

const log = Log.create({ service: "session", file: "prompt/messages" })

export async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
        if (item.info.role === "user" && item.info.model) return item.info.model
    }
    return Provider.defaultModel()
}

export async function createUserMessage(input: PromptInput) {
    const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
    const info: MessageV2.Info = {
        id: input.messageID ?? Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
            created: Date.now(),
        },
        tools: input.tools,
        agent: agent.name,
        model: input.model ?? agent.model ?? (await lastModel(input.sessionID)),
        system: input.system,
        variant: input.variant,
    }

    const parts = await Promise.all(
        input.parts.map(async (part): Promise<MessageV2.Part[]> => {
            if (part.type === "file") {
                // before checking the protocol we check if this is an mcp resource because it needs special handling
                if (part.source?.type === "resource") {
                    const { clientName, uri } = part.source
                    log.info("mcp resource", { clientName, uri, mime: part.mime })

                    const pieces: MessageV2.Part[] = [
                        {
                            id: Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                            type: "text",
                            synthetic: true,
                            text: `Reading MCP resource: ${part.filename} (${uri})`,
                        },
                    ]

                    try {
                        const resourceContent = await MCP.readResource(clientName, uri)
                        if (!resourceContent) {
                            throw new Error(`Resource not found: ${clientName}/${uri}`)
                        }

                        // Handle different content types
                        const contents = Array.isArray(resourceContent.contents)
                            ? resourceContent.contents
                            : [resourceContent.contents]

                        for (const content of contents) {
                            if ("text" in content && content.text) {
                                pieces.push({
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: content.text as string,
                                })
                            } else if ("blob" in content && content.blob) {
                                // Handle binary content if needed
                                const mimeType = "mimeType" in content ? content.mimeType : part.mime
                                pieces.push({
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: `[Binary content: ${mimeType}]`,
                                })
                            }
                        }

                        pieces.push({
                            ...part,
                            id: part.id ?? Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                        })
                    } catch (error: unknown) {
                        log.error("failed to read MCP resource", { error, clientName, uri })
                        const message = error instanceof Error ? error.message : String(error)
                        pieces.push({
                            id: Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                            type: "text",
                            synthetic: true,
                            text: `Failed to read MCP resource ${part.filename}: ${message}`,
                        })
                    }

                    return pieces
                }
                const url = new URL(part.url)
                switch (url.protocol) {
                    case "data:":
                        if (part.mime === "text/plain") {
                            return [
                                {
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                                },
                                {
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: Buffer.from(part.url, "base64url").toString(),
                                },
                                {
                                    ...part,
                                    id: part.id ?? Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                },
                            ]
                        }
                        break
                    case "file:":
                        log.info("file", { mime: part.mime })
                        // have to normalize, symbol search returns absolute paths
                        // Decode the pathname since URL constructor doesn't automatically decode it
                        const filepath = fileURLToPath(part.url)
                        const stat = await Bun.file(filepath).stat()

                        if (stat.isDirectory()) {
                            part.mime = "application/x-directory"
                        }

                        if (part.mime === "text/plain") {
                            let offset: number | undefined = undefined
                            let limit: number | undefined = undefined
                            const range = {
                                start: url.searchParams.get("start"),
                                end: url.searchParams.get("end"),
                            }
                            if (range.start != null) {
                                const filePathURI = part.url.split("?")[0]
                                let start = parseInt(range.start)
                                let end = range.end ? parseInt(range.end) : undefined
                                // some LSP servers (eg, gopls) don't give full range in
                                // workspace/symbol searches, so we'll try to find the
                                // symbol in the document to get the full range
                                if (start === end) {
                                    const symbols = await LSP.documentSymbol(filePathURI)
                                    for (const symbol of symbols) {
                                        let range: LSP.Range | undefined
                                        if ("range" in symbol) {
                                            range = symbol.range
                                        } else if ("location" in symbol) {
                                            range = symbol.location.range
                                        }
                                        if (range?.start?.line && range?.start?.line === start) {
                                            start = range.start.line
                                            end = range?.end?.line ?? start
                                            break
                                        }
                                    }
                                }
                                offset = Math.max(start - 1, 0)
                                if (end) {
                                    limit = end - offset
                                }
                            }
                            const args = { filePath: filepath, offset, limit }

                            const pieces: MessageV2.Part[] = [
                                {
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                                },
                            ]

                            await ReadTool.init()
                                .then(async (t) => {
                                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                                    const readCtx: any = {
                                        sessionID: input.sessionID,
                                        abort: new AbortController().signal,
                                        agent: input.agent!,
                                        messageID: info.id,
                                        extra: { bypassCwdCheck: true, model },
                                        metadata: async () => { },
                                        ask: async () => { },
                                    }
                                    const result = await t.execute(args, readCtx)
                                    pieces.push({
                                        id: Identifier.ascending("part"),
                                        messageID: info.id,
                                        sessionID: input.sessionID,
                                        type: "text",
                                        synthetic: true,
                                        text: result.output,
                                    })
                                    if (result.attachments?.length) {
                                        pieces.push(
                                            ...result.attachments.map((attachment) => ({
                                                ...attachment,
                                                synthetic: true,
                                                filename: attachment.filename ?? part.filename,
                                                messageID: info.id,
                                                sessionID: input.sessionID,
                                            })),
                                        )
                                    } else {
                                        pieces.push({
                                            ...part,
                                            id: part.id ?? Identifier.ascending("part"),
                                            messageID: info.id,
                                            sessionID: input.sessionID,
                                        })
                                    }
                                })
                                .catch((error) => {
                                    log.error("failed to read file", { error })
                                    const message = error instanceof Error ? error.message : error.toString()
                                    Bus.publish(Session.Event.Error, {
                                        sessionID: input.sessionID,
                                        error: new NamedError.Unknown({
                                            message,
                                        }).toObject(),
                                    })
                                    pieces.push({
                                        id: Identifier.ascending("part"),
                                        messageID: info.id,
                                        sessionID: input.sessionID,
                                        type: "text",
                                        synthetic: true,
                                        text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                                    })
                                })

                            return pieces
                        }

                        if (part.mime === "application/x-directory") {
                            const args = { path: filepath }
                            const listCtx: any = {
                                sessionID: input.sessionID,
                                abort: new AbortController().signal,
                                agent: input.agent!,
                                messageID: info.id,
                                extra: { bypassCwdCheck: true },
                                metadata: async () => { },
                                ask: async () => { },
                            }
                            const result = await ListTool.init().then((t) => t.execute(args, listCtx))
                            return [
                                {
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: `Called the list tool with the following input: ${JSON.stringify(args)}`,
                                },
                                {
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    synthetic: true,
                                    text: result.output,
                                },
                                {
                                    ...part,
                                    id: part.id ?? Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                },
                            ]
                        }

                        const file = Bun.file(filepath)
                        FileTime.read(input.sessionID, filepath)
                        return [
                            {
                                id: Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "text",
                                text: `Called the Read tool with the following input: {\"filePath\":\"${filepath}\"}`,
                                synthetic: true,
                            },
                            {
                                id: part.id ?? Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "file",
                                url: `data:${part.mime};base64,` + Buffer.from(await file.bytes()).toString("base64"),
                                mime: part.mime,
                                filename: part.filename!,
                                source: part.source,
                            },
                        ]
                }
            }

            // Handle skill injection for text parts
            if (part.type === "text" && part.text) {
                const skillMatches = ConfigMarkdown.files(part.text)
                const skillParts: MessageV2.Part[] = []
                const seenSkills = new Set<string>()

                for (const match of skillMatches) {
                    const name = match[1]
                    if (seenSkills.has(name)) continue

                    const skill = await Skill.get(name)
                    if (skill) {
                        seenSkills.add(name)
                        try {
                            const parsed = await ConfigMarkdown.parse(skill.location)
                            skillParts.push({
                                id: Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "text",
                                synthetic: true,
                                text: `\n<skill name="${skill.name}">\n${parsed.content.trim()}\n</skill>\n`,
                            })
                        } catch (error) {
                            log.error("failed to load skill", { name, error })
                        }
                    }
                }

                if (skillParts.length > 0) {
                    return [
                        {
                            id: Identifier.ascending("part"),
                            ...part,
                            messageID: info.id,
                            sessionID: input.sessionID,
                        },
                        ...skillParts,
                    ]
                }
            }

            if (part.type === "agent") {
                // Check if this agent would be denied by task permission
                const perm = PermissionNext.evaluate("task", part.name, agent.permission)
                const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
                return [
                    {
                        id: Identifier.ascending("part"),
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                    },
                    {
                        id: Identifier.ascending("part"),
                        messageID: info.id,
                        sessionID: input.sessionID,
                        type: "text",
                        synthetic: true,
                        // An extra space is added here. Otherwise the 'Use' gets appended
                        // to user's last word; making a combined word
                        text:
                            " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                            part.name +
                            hint,
                    },
                ]
            }

            return [
                {
                    id: Identifier.ascending("part"),
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                },
            ]
        }),
    ).then((x) => x.flat())

    await Plugin.trigger(
        "chat.message",
        {
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            messageID: input.messageID,
            variant: input.variant,
        },
        {
            message: info,
            parts,
        },
    )

    await Session.updateMessage(info)
    for (const part of parts) {
        await Session.updatePart(part)
    }

    return {
        info,
        parts,
    }
}

export function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info }) {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages
    if (input.agent.name === "plan") {
        userMessage.parts.push({
            id: Identifier.ascending("part"),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            // TODO (for mr dax): update to use the anthropic full fledged one (see plan-reminder-anthropic.txt)
            text: PROMPT_PLAN,
            synthetic: true,
        })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
        userMessage.parts.push({
            id: Identifier.ascending("part"),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
        })
    }
    return input.messages
}
