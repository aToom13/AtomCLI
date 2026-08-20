/**
 * Short-lived, bounded record of explicit session termination requests.
 *
 * This state intentionally lives in the server worker isolate: the abort route
 * marks a session immediately before cancellation wakes a blocking orchestrator.
 */
export namespace SessionTermination {
  const MAX_TERMINATIONS = 1_000
  const TERMINATION_TTL_MS = 60 * 60 * 1_000
  const terminated = new Map<string, number>()

  function prune(now: number) {
    for (const [sessionID, markedAt] of terminated) {
      if (now - markedAt > TERMINATION_TTL_MS) terminated.delete(sessionID)
    }
    while (terminated.size > MAX_TERMINATIONS) {
      const oldest = terminated.keys().next().value
      if (oldest === undefined) break
      terminated.delete(oldest)
    }
  }

  export function mark(sessionID: string) {
    const now = Date.now()
    terminated.delete(sessionID)
    terminated.set(sessionID, now)
    prune(now)
  }

  export function consume(sessionID: string) {
    const markedAt = terminated.get(sessionID)
    if (markedAt === undefined) return false
    terminated.delete(sessionID)
    return Date.now() - markedAt <= TERMINATION_TTL_MS
  }
}
