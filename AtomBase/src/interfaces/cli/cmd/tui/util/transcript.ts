import type { AssistantMessage, Part, UserMessage } from "@atomcli/sdk/v2"
import { Locale } from "@/util/util/locale"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions,
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(msg: UserMessage | AssistantMessage, parts: Part[], options: TranscriptOptions): string {
  let result = ""

  if (msg.role === "user") {
    result += `## User\n\n`
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "checkpoint") {
    const list = (title: string, values: string[]) =>
      values.length ? `${title}\n${values.map((x) => `- ${x}`).join("\n")}\n\n` : ""
    const runtime = part.runtime
      ? `Execution: ${part.runtime.executionID}\nTrigger: ${part.runtime.reason}\nSlice: ${part.runtime.allowance.used}/${part.runtime.allowance.limit}; total tools: ${part.runtime.allowance.toolCalls}\nDispatch: ${part.runtime.model}\n\n`
      : ""
    return `◆ Checkpoint #${part.sequence}\n\n${runtime}${part.progressSummary}\n\n${list("Completed", part.completedWork)}${list("Remaining", part.remainingWork)}${list("Failures", part.failures)}${list("Blockers", part.blockers)}Route: ${part.routeAssessment}\n\n${part.requestedCalls ? `Allowance: requested ${part.requestedCalls}, granted ${part.grantedCalls ?? 0}\n\n` : ""}`
  }
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `\`\`\`\nTool: ${part.tool}\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\``
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\``
    }
    result += `\n\`\`\`\n\n`
    return result
  }

  return ""
}
