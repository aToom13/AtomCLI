import { $ } from "bun"
import z from "zod"
import { Agent } from "@/integrations/agent/agent"
import { Bus } from "@/core/bus"
import { Command } from "@/interfaces/command"
import { EnvPolicy } from "@/core/env/policy"
import { Instance } from "@/services/project/instance"
import { MessageV2 } from "../message-v2"
import { Session } from "../index"
import { Provider } from "@/integrations/provider/provider"
import { ConfigMarkdown } from "../../config/markdown"
import { Identifier } from "@/core/id/id"
import { NamedError } from "@atomcli/util/error"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "session.prompt.command" })

export type CommandDependencies = {
  lastModel: (sessionID: string) => Promise<{ providerID: string; modelID: string }>
  resolvePromptParts: (template: string) => Promise<any[]>
  prompt: (input: any, atomicGoal?: string) => Promise<MessageV2.WithParts>
}

export const CommandInput = z.object({
  messageID: Identifier.schema("message").optional(),
  sessionID: Identifier.schema("session"),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  modelPinned: z.boolean().optional(),
  thinkingPinned: z.boolean().optional(),
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
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
/**
 * Regular expression to match @ file references in text
 * Matches @ followed by file paths, excluding commas, periods at end of sentences, and backticks
 * Does not match when preceded by word characters or backticks (to avoid email addresses and quoted references)
 */

export async function command(input: CommandInput, deps: CommandDependencies) {
  if (input.command === Command.Default.ATOMIC_WORK && !input.arguments.trim())
    throw new Error("/atomic-work requires a nonempty goal")
  log.info("command", input)
  const command = await Command.get(input.command)
  const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

  const templateCommand = await command.template

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  // Let the final placeholder swallow any extra arguments so prompts read naturally
  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

  const shell = input.command === Command.Default.ATOMIC_WORK ? [] : ConfigMarkdown.shell(template)
  if (shell.length > 0) {
    const results = await Promise.all(
      shell.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`
            .env(EnvPolicy.build({ cwd: Instance.directory, scope: "session:command-template" }))
            .quiet()
            .nothrow()
            .text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()

  // System commands: handle directly without AI (e.g., "skill" lists installed skills)
  if (input.command === Command.Default.SKILL) {
    const msgId = Identifier.ascending("message")
    const now = Date.now()
    const msg = (await Session.updateMessage({
      id: msgId,
      sessionID: input.sessionID,
      role: "assistant",
      parentID: input.messageID ?? Identifier.ascending("message"),
      agent: agentName,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "",
      providerID: "",
      time: { created: now, completed: now },
    })) as MessageV2.Assistant

    const part = await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: msg.sessionID,
      type: "text",
      text: template,
    })

    Bus.publish(Command.Event.Executed, {
      name: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
      messageID: msg.id,
    })

    return { info: msg, parts: [part] } as MessageV2.WithParts
  }

  const model = await (async () => {
    if (command.model) {
      return Provider.parseModel(command.model)
    }
    if (command.agent) {
      const cmdAgent = await Agent.get(command.agent)
      if (cmdAgent?.model) {
        return cmdAgent.model
      }
    }
    if (input.model) return Provider.parseModel(input.model)
    return await deps.lastModel(input.sessionID)
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

  const templateParts =
    input.command === Command.Default.BRAINSTORM ||
    input.command === Command.Default.WRITE_PLAN ||
    input.command === Command.Default.EXECUTE_PLAN ||
    input.command === Command.Default.ATOMIC_WORK
      ? [
          { type: "text" as const, text: `/${input.command}${input.arguments ? ` ${input.arguments}` : ""}` },
          { type: "text" as const, text: template, synthetic: true },
        ]
      : await deps.resolvePromptParts(template)
  const parts =
    input.command !== Command.Default.ATOMIC_WORK &&
    ((agent.mode === "subagent" && command.subtask !== false) || command.subtask === true)
      ? [
          {
            type: "subtask" as const,
            agent: agent.name,
            description: command.description ?? "",
            command: input.command,
            // TODO: how can we make task tool accept a more complex input?
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : [...templateParts, ...(input.parts ?? [])]

  const result = (await deps.prompt(
    {
      sessionID: input.sessionID,
      messageID: input.messageID,
      model,
      agent: agentName,
      parts,
      variant: input.variant,
      modelPinned: input.modelPinned,
      thinkingPinned: input.thinkingPinned,
    },
    input.command === Command.Default.ATOMIC_WORK ? input.arguments.trim() : undefined,
  )) as MessageV2.WithParts

  Bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}
