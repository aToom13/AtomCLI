import { createContext, useContext } from "solid-js"
import { useSync } from "@tui/context/sync"

export const SessionContextContext = createContext<{
    width: number
    sessionID: string
    conceal: () => boolean
    showThinking: () => boolean
    showTimestamps: () => boolean
    showDetails: () => boolean
    diffWrapMode: () => "word" | "none"
    sync: ReturnType<typeof useSync>
}>()

export function useSessionContext() {
    const ctx = useContext(SessionContextContext)
    if (!ctx) throw new Error("useContext must be used within a Session component")
    return ctx
}
