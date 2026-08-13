import { createMemo, createSignal } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useTerminalDimensions } from "@opentui/solid"
import { MacOSScrollAccel } from "@opentui/core"
import { useKV } from "../../../context/kv"
import { CustomSpeedScroll } from "../context"
import { useSubAgents } from "@tui/context/subagent"
import { useFileTree } from "@tui/context/file-tree"
import { SessionLayout } from "../layout"

export type SessionState = ReturnType<typeof useSessionState>

export function useSessionState() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const subAgentCtx = useSubAgents()
  const fileTree = useFileTree()

  const session = createMemo(() => sync.session.get(route.sessionID))

  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })

  const messages = createMemo(() => {
    const remote = sync.data.message[route.sessionID] ?? []
    const optimistic = sync.data.optimistic_message[route.sessionID] ?? []
    return [...remote, ...optimistic]
  })

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
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", false)
  const [autoFollow, setAutoFollow] = kv.signal("auto_follow", true)

  const layoutMode = createMemo(() => SessionLayout.mode(dimensions().width))
  const verticalMode = createMemo(() => SessionLayout.verticalMode(dimensions().height))
  const wide = createMemo(() => layoutMode() === "wide")

  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })

  const showTimestamps = createMemo(() => timestamps() === "show")

  const secondaryPanelRequested = createMemo(
    () =>
      (subAgentCtx.panelVisible() && subAgentCtx.agents().length > 0) ||
      (fileTree.state.codePanelVisible && fileTree.hasOpenFiles()),
  )
  const fileTreeExpanded = createMemo(
    () => fileTree.state.visible && !(dimensions().width < 90 && secondaryPanelRequested()),
  )
  const fileTreeWidth = createMemo(() => SessionLayout.fileTreeWidth(dimensions().width, fileTreeExpanded()))
  const inspectorInline = createMemo(() => sidebarVisible() && wide())
  const inspectorWidth = createMemo(() =>
    SessionLayout.inspectorWidth(dimensions().width, sidebarVisible(), inspectorInline()),
  )
  const inlineInspectorWidth = createMemo(() => (inspectorInline() ? inspectorWidth() : 0))
  const occupiedBeforeRightPanel = createMemo(() => fileTreeWidth() + inlineInspectorWidth())
  const agentPanelWidth = createMemo(() =>
    SessionLayout.agentPanelWidth(
      dimensions().width,
      occupiedBeforeRightPanel(),
      subAgentCtx.panelVisible() && subAgentCtx.agents().length > 0,
    ),
  )
  const codePanelWidth = createMemo(() =>
    SessionLayout.codePanelWidth(
      dimensions().width,
      occupiedBeforeRightPanel(),
      agentPanelWidth() === 0 && fileTree.state.codePanelVisible && fileTree.hasOpenFiles(),
    ),
  )
  const rightPanelWidth = createMemo(() => agentPanelWidth() || codePanelWidth())
  const contentWidth = createMemo(() =>
    SessionLayout.chatWidth(dimensions().width, fileTreeWidth(), inlineInspectorWidth(), rightPanelWidth()),
  )

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(8)
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
    layoutMode,
    verticalMode,
    sidebarVisible,
    fileTreeWidth,
    fileTreeExpanded,
    inspectorWidth,
    agentPanelWidth,
    codePanelWidth,
    contentWidth,
    scrollAcceleration,
  }
}
