import type { ScrollBoxRenderable } from "@opentui/core"
import type { PromptRef } from "@tui/component/prompt"

export interface SessionCommandContext {
    session: () => any
    messages: () => any[]
    children: () => any[]
    navigate: (path: any) => void
    prompt: PromptRef | undefined
    scroll: ScrollBoxRenderable | undefined
    toBottom: () => void
    sidebarVisible: () => boolean
    setSidebar: (val: any) => void
    setSidebarOpen: (val: boolean) => void
    setConceal: (val: any) => void
    showTimestamps: () => boolean
    setTimestamps: (val: any) => void
    showThinking: () => boolean
    setShowThinking: (val: any) => void
    setDiffWrapMode: (val: any) => void
    showDetails: () => boolean
    setShowDetails: (val: any) => void
    setShowScrollbar: (val: any) => void
    animationsEnabled: () => boolean
    setAnimationsEnabled: (val: any) => void
    showAssistantMetadata: () => boolean
    scrollToMessage: (direction: "next" | "prev", dialog: any) => void
    moveChild: (direction: number) => void
}
