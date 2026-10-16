import { Instance } from "@/services/project/instance"
import { Session } from ".."
import type { MessageV2 } from "../message-v2"

type ActiveSession = {
  abort: AbortController
  execution?: import("@/core/execution/runtime").ExecutionRuntime.Context
  callbacks: {
    resolve(input: MessageV2.WithParts): void
    reject(): void
  }[]
}

export namespace PromptActiveSessions {
  export const state = Instance.sessionState(
    () => ({}) as Record<string, ActiveSession>,
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
        for (const callback of item.callbacks) callback.reject()
      }
    },
  )

  export function assertNotBusy(sessionID: string) {
    if (state()[sessionID]) throw new Session.BusyError(sessionID)
  }

  export function isActive(sessionID: string) {
    return Boolean(state()[sessionID])
  }
}
