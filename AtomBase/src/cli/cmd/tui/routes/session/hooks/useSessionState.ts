import { createMemo, createSignal } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useTerminalDimensions } from "@opentui/solid"
import { MacOSScrollAccel } from "@opentui/core"
import { useKV } from "../../../context/kv"
import { CustomSpeedScroll } from "../context"

export type SessionState = ReturnType<typeof useSessionState>

export function useSessionState() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const dimensions = useTerminalDimensions()

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

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

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
  const [autoFollow, setAutoFollow] = kv.signal("auto_follow", true)

  const wide = createMemo(() => dimensions().width > 120)

  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })

  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)

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

  return {
    navigate,
    route,
    sync,
    session,
    children,
    messages,
    permissions,
    questions,
    pending,
    lastAssistant,
    // State
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
    showTimestamps,
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
    autoFollow,
    setAutoFollow,
    // UI
    wide,
    sidebarVisible,
    contentWidth,
    scrollAcceleration,
  }
}
