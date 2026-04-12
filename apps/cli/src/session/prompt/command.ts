import z from "zod"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Bus } from "../../bus"
import { Command } from "../../command"
import { ConfigMarkdown } from "../../config/markdown"
import { Log } from "../../util/log"
import { NamedError } from "@atomcli/util/error"
import { $ } from "bun"
import { PromptInput } from "./types"
import { lastModel } from "./messages"

const log = Log.create({ service: "session", file: "prompt/command" })

export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z
        .array(
            z.discriminatedUnion("type", [
                MessageV2.FilePart.omit({
                    messageID: true,
                    sessionID: true,
                }).partial({
                    id: true,
                }),
            ]),
        )
        .optional(),
})
export type CommandInput = z.infer<typeof CommandInput>

const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export async function command(
    input: CommandInput,
    deps: {
        prompt: (input: PromptInput) => Promise<MessageV2.WithParts>
        resolvePromptParts: (template: string) => Promise<PromptInput["parts"]>
    }
) {
    log.info("command", input)
    const cmd = await Command.get(input.command)
    const agentName = cmd.agent ?? input.agent ?? (await Agent.defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await cmd.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
    }

    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
    })
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    const shellCmds = ConfigMarkdown.shell(template)
    if (shellCmds.length > 0) {
        const results = await Promise.all(
            shellCmds.map(async ([, code]) => {
                try {
                    return await $`${{ raw: code }}`.quiet().nothrow().text()
                } catch (error) {
                    return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
                }
            }),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const model = await (async () => {
        if (cmd.model) {
            return Provider.parseModel(cmd.model)
        }
        if (cmd.agent) {
            const cmdAgent = await Agent.get(cmd.agent)
            if (cmdAgent?.model) {
                return cmdAgent.model
            }
        }
        if (input.model) return Provider.parseModel(input.model)
        return await lastModel(input.sessionID)
    })()

    try {
        await Provider.getModel(model.providerID, model.modelID)
    } catch (e) {
        if (Provider.ModelNotFoundError.isInstance(e)) {
            const { providerID, modelID, suggestions } = e.data
            const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
            Bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
            })
        }
        throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
        const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        Bus.publish(Session.Event.Error, {
            sessionID: input.sessionID,
            error: error.toObject(),
        })
        throw error
    }

    const templateParts = await deps.resolvePromptParts(template)
    const parts =
        (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
            ? [
                {
                    type: "subtask" as const,
                    agent: agent.name,
                    description: cmd.description ?? "",
                    command: input.command,
                    prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
                },
            ]
            : [...templateParts, ...(input.parts ?? [])]

    const result = (await deps.prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model,
        agent: agentName,
        parts,
        variant: input.variant,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
    })

    return result
}
