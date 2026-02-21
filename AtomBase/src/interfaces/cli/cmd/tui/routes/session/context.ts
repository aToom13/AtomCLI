import { createContext, useContext } from "solid-js"
import { useSync } from "@tui/context/sync"

export class CustomSpeedScroll {
    constructor(private speed: number) { }

    tick(_now?: number): number {
        return this.speed
    }

    reset(): void { }
}

export const SessionContext = createContext<{
    width: number
    sessionID: string
    conceal: () => boolean
    showThinking: () => boolean
    showTimestamps: () => boolean
    showDetails: () => boolean
    diffWrapMode: () => "word" | "none"
    sync: ReturnType<typeof useSync>
}>()

export const useSession = () => {
    const ctx = useContext(SessionContext)
    if (!ctx) throw new Error("SessionContext not found")
    return ctx
}
