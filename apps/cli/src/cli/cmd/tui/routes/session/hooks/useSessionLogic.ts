import { createMemo, createSignal, createEffect } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKV } from "../../../context/kv"
import { useToast } from "../../../ui/toast"
import { useTerminalDimensions } from "@opentui/solid"
import { MacOSScrollAccel, type ScrollAcceleration } from "@opentui/core"
import type { PromptRef } from "@tui/component/prompt"
import { ScrollBoxRenderable } from "@opentui/core"

class CustomSpeedScroll implements ScrollAcceleration {
    constructor(private speed: number) { }
    tick(_now?: number): number {
        return this.speed
    }
    reset(): void { }
}

export function useSessionLogic() {
    const route = useRouteData("session")
    const { navigate } = useRoute()
    const sync = useSync()
    const kv = useKV()
    const toast = useToast()

    const session = createMemo(() => sync.session.get(route.sessionID))
    const children = createMemo(() => {
        const parentID = session()?.parentID ?? session()?.id
        return sync.data.session
            .filter((x) => x.parentID === parentID || x.id === parentID)
            .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })

    const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

    const permissions = createMemo(() => {
        if (session()?.parentID) return []
        return children().flatMap((x) => sync.data.permission[x.id] ?? [])
    })

    const questions = createMemo(() => {
        if (session()?.parentID) return []
        return children().flatMap((x) => sync.data.question[x.id] ?? [])
    })

    // State
    const dimensions = useTerminalDimensions()
    const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "hide")
    const [sidebarOpen, setSidebarOpen] = createSignal(false)
    const [conceal, setConceal] = createSignal(true)
    const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
    const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
    const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
    const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
    const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
    const [diffWrapMode, setDiffWrapMode] = createSignal<"word" | "none">("word")
    const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)

    const wide = createMemo(() => dimensions().width > 120)
    const sidebarVisible = createMemo(() => {
        if (session()?.parentID) return false
        if (sidebarOpen()) return true
        if (sidebar() === "auto" && wide()) return true
        return false
    })

    const showTimestamps = createMemo(() => timestamps() === "show")
    const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

    const pending = createMemo(() => {
        return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
    })

    const lastAssistant = createMemo(() => {
        return messages().findLast((x) => x.role === "assistant")
    })

    const scrollAcceleration = createMemo(() => {
        const tui = sync.data.config.tui
        if (tui?.scroll_acceleration?.enabled) {
            return new MacOSScrollAccel()
        }
        if (tui?.scroll_speed) {
            return new CustomSpeedScroll(tui.scroll_speed)
        }
        return new CustomSpeedScroll(3)
    })

    // Revert Logic
    const revertInfo = createMemo(() => session()?.revert)
    const revert = createMemo(() => {
        const info = revertInfo()
        if (!info || !info.messageID) return

        // We can't access parsePatch here easily without adding it to usage
        // For now we will return just the info needed including diff string
        return {
            messageID: info.messageID,
            diff: info.diff,
        }
    })

    return {
        route,
        navigate,
        sync,
        session,
        children,
        messages,
        permissions,
        questions,
        pending,
        lastAssistant,
        dimensions,
        sidebar,
        setSidebar,
        sidebarOpen,
        setSidebarOpen,
        conceal,
        setConceal,
        showThinking,
        setShowThinking,
        timestamps,
        setTimestamps,
        showDetails,
        setShowDetails,
        showAssistantMetadata,
        setShowAssistantMetadata,
        showScrollbar,
        setShowScrollbar,
        diffWrapMode,
        setDiffWrapMode,
        animationsEnabled,
        setAnimationsEnabled,
        wide,
        sidebarVisible,
        showTimestampsMemo: showTimestamps,
        contentWidth,
        scrollAcceleration,
        revert
    }
}
