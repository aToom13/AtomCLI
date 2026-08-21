import { fn } from "@/util/util/fn"
import z from "zod"
import { Session } from "."

import { MessageV2 } from "./message-v2"
import { Identifier } from "@/core/id/id"
import { Snapshot } from "@/core/snapshot"

import { Log } from "@/util/util/log"
import path from "path"
import { Instance } from "@/services/project/instance"
import { Storage } from "@/core/storage/storage"
import { Bus } from "@/core/bus"


export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" })

  // F11: Debounce summarization per session — only run after 5s idle
  const DEBOUNCE_MS = 5_000
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  export function localTitle(text: string) {
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/\s+/g, " ").trim()
    if (!cleaned) return
    return cleaned.length > 100 ? cleaned.slice(0, 97) + "..." : cleaned
  }

  export function localDiffSummary(diffs: Snapshot.FileDiff[]) {
    if (diffs.length === 0) return
    const additions = diffs.reduce((sum, item) => sum + item.additions, 0)
    const deletions = diffs.reduce((sum, item) => sum + item.deletions, 0)
    const files = diffs
      .slice(0, 8)
      .map((item) => item.file)
      .join(", ")
    const remaining = diffs.length > 8 ? ` and ${diffs.length - 8} more` : ""
    return `Changed ${diffs.length} file${diffs.length === 1 ? "" : "s"} (+${additions}/-${deletions}): ${files}${remaining}`
  }

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      // Clear any pending debounce for this session
      const existing = debounceTimers.get(input.sessionID)
      if (existing) clearTimeout(existing)

      // Schedule summarization after debounce period
      debounceTimers.set(
        input.sessionID,
        setTimeout(async () => {
          debounceTimers.delete(input.sessionID)
          try {
            const all = await Session.messages({ sessionID: input.sessionID })
            await Promise.all([
              summarizeSession({ sessionID: input.sessionID, messages: all }),
              summarizeMessage({ messageID: input.messageID, messages: all }),
            ])
          } catch (err) {
            log.error("summarize failed", { error: (err as Error).message })
          }
        }, DEBOUNCE_MS),
      )
    },
  )

  /**
   * Cancel any pending debounce timer for the given session.
   * Call this from the session teardown path to prevent the timer from firing
   * on a closed session and leaking async work after cleanup.
   */
  export function cancelPendingSummarize(sessionID: string): void {
    const timer = debounceTimers.get(sessionID)
    if (timer !== undefined) {
      clearTimeout(timer)
      debounceTimers.delete(sessionID)
    }
  }

  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    const files = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === "patch")
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x)),
    )
    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((x) => {
        return files.has(x.file)
      }),
    )
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      }
    })
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    const messages = input.messages.filter(
      (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
    )
    const msgWithParts = messages.find((m) => m.info.id === input.messageID)
    if (!msgWithParts) {
      log.warn("summarizeMessage: message not found", { messageID: input.messageID })
      return
    }
    const userMsg = msgWithParts.info as MessageV2.User
    const diffs = await computeDiff({ messages })
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg)

    const assistantMsgMatch = messages.find((m) => m.info.role === "assistant")
    if (!assistantMsgMatch) {
      log.warn("summarizeMessage: assistant message not found", { messageID: input.messageID })
      return
    }
    const textPart = msgWithParts.parts.find((p) => p.type === "text" && !p.synthetic) as MessageV2.TextPart
    if (textPart && !userMsg.summary?.title) {
      userMsg.summary.title = localTitle(textPart.text)
      await Session.updateMessage(userMsg)
    }

    if (
      messages.some(
        (m) =>
          m.info.role === "assistant" && m.parts.some((p) => p.type === "step-finish" && p.reason !== "tool-calls"),
      )
    ) {
      if (diffs.length > 0) {
        userMsg.summary.body = localDiffSummary(diffs)
      }
      await Session.updateMessage(userMsg)
    }
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      return Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
    },
  )

  async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    // scan assistant messages to find earliest from and latest to
    // snapshot
    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
          break
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to)
    return []
  }
}
