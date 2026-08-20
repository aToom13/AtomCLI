import { Instance } from "@/services/project/instance"
import type { MessageV2 } from "@/core/session/message-v2"
import { SessionRetrospectiveService } from "./retrospective"
import { Log } from "@/util/util/log"
import { AgentEval } from "@/core/eval/harness"

export namespace MemoryLifecycle {
  const MAX_TRACKED_SESSIONS = 500
  const state = Instance.state(() => ({ scheduled: new Set<string>() }))
  const log = Log.create({ service: "memory.lifecycle" })

  export function schedule(
    sessionID: string,
    messages: MessageV2.WithParts[],
    options: { retrospective?: boolean } = {},
  ) {
    const value = state()
    // Eval is turn-scoped and idempotent, so run it on every completed turn.
    void AgentEval.recordSession(sessionID, messages).catch((error) =>
      log.warn("automatic eval recording failed", { sessionID, error }),
    )
    if (options.retrospective === false || AgentEval.isBenchmarkSession(sessionID)) return true
    if (value.scheduled.has(sessionID)) return false
    value.scheduled.add(sessionID)
    while (value.scheduled.size > MAX_TRACKED_SESSIONS) {
      const oldest = value.scheduled.values().next().value
      if (!oldest) break
      value.scheduled.delete(oldest)
    }
    void SessionRetrospectiveService.execute(sessionID, messages).catch((error) =>
      log.warn("retrospective failed", { sessionID, error }),
    )
    return true
  }
}
