import { MessageV2 } from "@/core/session/message-v2"
import { SessionRetrospectiveService } from "./retrospective"
import { SessionMemoryIntegration } from "@/core/memory/integration/session"
import { RetrospectiveQueue } from "./retrospective-queue"
import { Log } from "@/util/util/log"
import { AgentEval } from "@/core/eval/harness"
import { Config } from "@/core/config/config"

export namespace MemoryLifecycle {
  const log = Log.create({ service: "memory.lifecycle" })

  function visibleText(message: MessageV2.WithParts): string {
    return message.parts
      .filter((p) => p.type === "text" && !("synthetic" in p && p.synthetic))
      .map((p) => (p as any).text)
      .filter(Boolean)
      .join(" ")
  }

  /**
   * Called after each completed turn. Records eval data, verifies learned
   * information against the assistant reply for turns carrying an explicit
   * memory signal, and marks the session so its LLM retrospective runs once
   * at session close (see flush) instead of silently spending a second
   * provider request mid-turn.
   */
  export function schedule(sessionID: string, messages: MessageV2.WithParts[]) {
    // Eval is turn-scoped and idempotent, so run it on every completed turn.
    void AgentEval.recordSession(sessionID, messages).catch((error) =>
      log.warn("automatic eval recording failed", { sessionID, error }),
    )
    if (AgentEval.isBenchmarkSession(sessionID)) return

    const lastUser = [...messages].reverse().find((m) => m.info.role === "user")
    const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
    const userText = lastUser ? visibleText(lastUser) : ""
    const assistantText = lastAssistant ? visibleText(lastAssistant) : ""
    const model = lastUser && lastUser.info.role === "user" ? lastUser.info.model : undefined

    if (
      userText &&
      assistantText &&
      AgentEval.executionPolicy(sessionID).allowMemoryLearning &&
      SessionMemoryIntegration.hasExplicitMemorySignal(userText)
    ) {
      // Fire-and-forget: the assistant reply is the verified half of what the
      // user just asked us to remember.
      void SessionMemoryIntegration.learnFromResponse(assistantText, userText, model).catch((error) =>
        log.error("Failed to learn from assistant response", { sessionID, error }),
      )
    }

    // Registered in the dependency-free RetrospectiveQueue so lightweight
    // shutdown paths can discover pending work without loading this module.
    RetrospectiveQueue.add(sessionID)
  }

  /**
   * Runs the deferred LLM retrospective for a session at close. Safe to call
   * multiple times; only the first call consumes the pending marker.
   */
  export async function flush(sessionID: string): Promise<void> {
    if (!RetrospectiveQueue.take(sessionID)) return
    if (AgentEval.isBenchmarkSession(sessionID)) return
    try {
      const config = await Config.get()
      if ((config as any).memory?.retrospective === false) {
        log.info("Retrospective disabled by config", { sessionID })
        return
      }
    } catch (error) {
      log.warn("Config unavailable for retrospective gate, continuing", { sessionID, error })
    }
    try {
      const messages: MessageV2.WithParts[] = []
      for await (const item of MessageV2.stream({ sessionID, excludePatches: true })) messages.push(item)
      await SessionRetrospectiveService.execute(sessionID, messages)
    } catch (error) {
      log.warn("retrospective failed", { sessionID, error })
    }
  }

  /**
   * Flushes every pending session; used on process shutdown.
   */
  export async function flushAll(): Promise<void> {
    const pending = RetrospectiveQueue.all()
    await Promise.allSettled(pending.map((sessionID) => flush(sessionID)))
  }
}
