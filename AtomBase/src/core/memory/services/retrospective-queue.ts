/**
 * Dependency-free registry of sessions awaiting their close-time LLM
 * retrospective. Kept free of heavy imports so process entrypoints can
 * cheaply check for pending work at shutdown without loading the whole
 * memory stack.
 */
export namespace RetrospectiveQueue {
  const MAX_TRACKED_SESSIONS = 500
  const sessions = new Set<string>()

  export function add(sessionID: string) {
    sessions.delete(sessionID)
    sessions.add(sessionID)
    while (sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = sessions.values().next().value
      if (!oldest) break
      sessions.delete(oldest)
    }
  }

  export function take(sessionID: string): boolean {
    return sessions.delete(sessionID)
  }

  export function all(): string[] {
    return [...sessions]
  }
}
