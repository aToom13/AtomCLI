import { createMemo, createSignal, createEffect, onCleanup, batch } from "solid-js"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useLocal } from "@tui/context/local"
import { useTerminalDimensions } from "@opentui/solid"
import { MacOSScrollAccel } from "@opentui/core"
import { useKV } from "../../../context/kv"
import { CustomSpeedScroll } from "../context"
import { TeamLead, BrowserTeamPersistence } from "@/agent-teams"
import type { AgentIdentity } from "@/agent-teams/types"

/**
 * Find the best free model from connected providers.
 * Priority:
 *   1. Free models from connected providers (pricing.input === 0 && pricing.output === 0)
 *   2. Any model from connected providers
 *   3. Fallback to current selection
 */
function findBestFreeModel(
  providers: { id: string; models: Record<string, { pricing?: { input: number; output: number }; name?: string }> }[],
  connectedProviderIds: string[],
  currentModel?: { providerID: string; modelID: string },
): { providerID: string; modelID: string } | undefined {
  // First, try to find a free model from connected providers
  for (const providerId of connectedProviderIds) {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider?.models) continue

    for (const [modelId, modelInfo] of Object.entries(provider.models)) {
      // Check if model is free (both input and output price are 0)
      if (modelInfo.pricing?.input === 0 && modelInfo.pricing?.output === 0) {
        console.log(`[TeamLead] Found free model: ${providerId}/${modelId} (${modelInfo.name || modelId})`)
        return { providerID: providerId, modelID: modelId }
      }
    }
  }

  // Second, try any model from connected providers
  for (const providerId of connectedProviderIds) {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider?.models) continue

    const firstModel = Object.keys(provider.models)[0]
    if (firstModel) {
      console.log(`[TeamLead] Using first available model from connected provider: ${providerId}/${firstModel}`)
      return { providerID: providerId, modelID: firstModel }
    }
  }

  // Fallback to current model
  console.log("[TeamLead] No free/connected model found, falling back to current selection")
  return currentModel
}

export type SessionState = ReturnType<typeof useSessionState>

export function useSessionState() {
  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const sdk = useSDK()
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

  // Agent Teams mode — derived from session metadata
  const teamsMode = createMemo(() => !!(session() as any)?.metadata?.team?.active)
  const [teamLead, setTeamLead] = createSignal<TeamLead | undefined>(undefined)
  // Reactive agent list — updated whenever agents spawn or change status
  const [teamAgents, setTeamAgents] = createSignal<AgentIdentity[]>([])
  // Track synced child sessions to avoid re-syncing
  const _syncedChildSessions = new Set<string>()

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

  // ─── Agent Teams: Initialize TeamLead ──────────────────────────
  createEffect(() => {
    const sess = session() as any
    if (teamsMode() && !teamLead() && sess?.metadata?.team?.task) {
      const task = sess.metadata.team.task

      // Get current model/agent from local context
      const currentModel = local.model.current()
      const currentAgent = local.agent.current()

      // Find the best free model from connected providers
      const connectedProviders = sync.data.provider_next.connected
      const bestModel = findBestFreeModel(sync.data.provider, connectedProviders, currentModel)

      if (!bestModel) {
        console.warn("[TeamLead] No model available (no connected providers), cannot start agents")
        return
      }

      console.log(`[TeamLead] Using model: ${bestModel.providerID}/${bestModel.modelID}`)

      const lead = new TeamLead({
        config: {
          goal: task,
          sessionId: sess.id,
          maxConcurrentAgents: 3,
          persist: false,
        },
        persistence: new BrowserTeamPersistence(),
        sdkClient: sdk.client,
        model: { providerID: bestModel.providerID, modelID: bestModel.modelID },
        agentName: currentAgent?.name,
      })

      // Wire up reactive agent signals
      lead.eventBus.on("agent:spawned", () => {
        setTeamAgents([...lead.getAgents()])
      })
      lead.eventBus.on("agent:status", () => {
        setTeamAgents([...lead.getAgents()])
      })

      setTeamLead(lead)

      // Start agent spawning (async)
      lead.start().catch((err) => {
        console.error("[TeamLead] Failed to start:", err)
      })

      onCleanup(() => {
        lead.destroy()
        _syncedChildSessions.clear()
      })
    }
  })

  // ─── Agent Teams: Sync child sessions ──────────────────────────
  // Child sessions need to be synced for their messages to appear in sync.data
  createEffect(() => {
    const lead = teamLead()
    if (!lead) return

    const sessionMap = lead.getAgentSessionMap()
    for (const [, childSessionId] of sessionMap) {
      if (!_syncedChildSessions.has(childSessionId)) {
        _syncedChildSessions.add(childSessionId)
        // Sync the child session to get its messages
        sync.session.sync(childSessionId).catch((err) => {
          console.error(`[TeamLead] Failed to sync child session ${childSessionId}:`, err)
        })
      }
    }
  })

  // ─── Agent Teams: Client-side event bridge ─────────────────────
  // Watches child session messages/parts and forwards to AgentEventBus.
  // Uses a tracker to avoid duplicate output.
  const _forwarded = new Map<string, number>() // agentId -> last forwarded text length

  createEffect(() => {
    const lead = teamLead()
    const agents = teamAgents()
    if (!lead || agents.length === 0) return

    const sessionMap = lead.getAgentSessionMap()

    for (const [agentId, childSessionId] of sessionMap) {
      // 1. Check for child session messages (reactive — triggers on SSE updates)
      const childMsgs = sync.data.message[childSessionId]
      if (!childMsgs || childMsgs.length === 0) continue

      // Find latest assistant message
      const assistantMsg = childMsgs.findLast((m: any) => m.role === "assistant")
      if (!assistantMsg) continue

      // 2. Get parts for this message (stored separately in sync.data.part)
      const parts = sync.data.part[assistantMsg.id]
      if (!parts || parts.length === 0) continue

      // 3. Collect all text content from parts
      let totalText = ""
      for (const part of parts) {
        if ((part as any).type === "text" && (part as any).text) {
          totalText += (part as any).text
        }
      }

      // 4. Emit only NEW content (delta tracking)
      const lastLen = _forwarded.get(agentId) ?? 0
      if (totalText.length > lastLen) {
        const delta = totalText.slice(lastLen)
        lead.agentOutput(agentId, delta)
        _forwarded.set(agentId, totalText.length)
      }

      // 5. Update agent status based on message completion
      if ((assistantMsg.time as any)?.completed) {
        lead.updateAgentStatus(agentId, "done", "Tamamlandı")
      } else {
        // Only update to "working" if not already done
        const agent = lead.getAgent(agentId)
        if (agent && agent.status !== "done") {
          lead.updateAgentStatus(agentId, "working", "Çalışıyor...")
        }
      }

      // 6. Forward tool call parts
      for (const part of parts) {
        const p = part as any
        if (p.type === "tool-call" && p.state?.status === "running") {
          lead.agentAction(agentId, p.name ?? p.tool ?? "tool")
        }
      }
    }
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
    // Agent Teams
    teamsMode,
    teamLead,
    setTeamLead,
    teamAgents,
  }
}
