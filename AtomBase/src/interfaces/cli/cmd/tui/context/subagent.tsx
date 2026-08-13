import { createContext, useContext, createSignal, type ParentProps, type Accessor } from "solid-js"

/**
 * SubAgent Context — Tracks active sub-agents across the TUI.
 *
 * Managed by use-sdk-events.tsx which listens to SubAgentActive/SubAgentDone/SubAgentReactivate
 * events from the Bus and updates this context. The SubAgentPanel reads from
 * this context to render active agent cards.
 *
 * Agent lifecycle:
 *   running → waiting (task done, awaiting new orders) → running (re-tasked) → ...
 *   Only removed when orchestrator explicitly closes them.
 */

export interface ActiveSubAgent {
  sessionId: string
  agentType: string
  description: string
  status: "running" | "waiting"
  parentSessionId?: string
  /** Latest output/context returned to orchestrator */
  lastOutput?: string
}

export interface SubAgentContextValue {
  agents: Accessor<ActiveSubAgent[]>
  parentSessionId: Accessor<string | undefined>
  addAgent: (agent: Omit<ActiveSubAgent, "status">) => void
  markWaiting: (sessionId: string, lastOutput?: string) => void
  reactivate: (sessionId: string, description?: string) => void
  findByType: (agentType: string) => ActiveSubAgent | undefined
  removeAgent: (sessionId: string) => void
  clear: () => void
  /** Restore agents derived from persisted child sessions after reconnect/restart. */
  hydrate: (agents: ActiveSubAgent[]) => void
  /** SubAgent panel visibility toggle */
  panelVisible: Accessor<boolean>
  togglePanel: () => void
  setPanelVisible: (v: boolean) => void
}

const SubAgentContext = createContext<SubAgentContextValue>()

export function SubAgentProvider(props: ParentProps) {
  const [agents, setAgents] = createSignal<ActiveSubAgent[]>([])
  // Start closed — panel opens automatically when the first sub-agent becomes active.
  // This avoids taking up screen real estate when no agents are running.
  const [panelVisible, setPanelVisible] = createSignal(false)
  const togglePanel = () => setPanelVisible((v) => !v)

  const addAgent = (agent: Omit<ActiveSubAgent, "status">) => {
    setAgents((prev) => {
      // If agent with same sessionId exists, reactivate it
      const existing = prev.find((a) => a.sessionId === agent.sessionId)
      if (existing) {
        return prev.map((a) =>
          a.sessionId === agent.sessionId ? { ...a, status: "running" as const, description: agent.description } : a,
        )
      }
      return [...prev, { ...agent, status: "running" }]
    })
    // Auto-open panel when first agent becomes active
    setPanelVisible(true)
  }

  const markWaiting = (sessionId: string, lastOutput?: string) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.sessionId === sessionId ? { ...a, status: "waiting" as const, lastOutput: lastOutput ?? a.lastOutput } : a,
      ),
    )
  }

  const reactivate = (sessionId: string, description?: string) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.sessionId === sessionId ? { ...a, status: "running" as const, description: description ?? a.description } : a,
      ),
    )
  }

  const findByType = (agentType: string) => {
    return agents().find((a) => a.agentType === agentType && (a.status === "waiting" || a.status === "running"))
  }

  const removeAgent = (sessionId: string) => {
    setAgents((prev) => {
      const next = prev.filter((a) => a.sessionId !== sessionId)
      // Auto-close when the last agent is removed
      if (next.length === 0) setPanelVisible(false)
      return next
    })
  }

  const clear = () => {
    setAgents([])
    setPanelVisible(false)
  }

  const hydrate = (recovered: ActiveSubAgent[]) => {
    setAgents((current) => {
      const live = new Map(current.map((agent) => [agent.sessionId, agent]))
      return recovered.map((agent) => {
        const existing = live.get(agent.sessionId)
        return existing?.status === "running" ? { ...agent, ...existing } : { ...existing, ...agent }
      })
    })
    if (recovered.some((agent) => agent.status === "running")) setPanelVisible(true)
  }

  const parentSessionId = () => agents()[0]?.parentSessionId

  return (
    <SubAgentContext.Provider
      value={{
        agents,
        parentSessionId,
        addAgent,
        markWaiting,
        reactivate,
        findByType,
        removeAgent,
        clear,
        hydrate,
        panelVisible,
        togglePanel,
        setPanelVisible,
      }}
    >
      {props.children}
    </SubAgentContext.Provider>
  )
}

export function useSubAgents(): SubAgentContextValue {
  const ctx = useContext(SubAgentContext)
  if (!ctx) {
    // Fallback for when provider is not available
    const [agents] = createSignal<ActiveSubAgent[]>([])
    return {
      agents,
      parentSessionId: () => undefined,
      addAgent: () => {},
      markWaiting: () => {},
      reactivate: () => {},
      findByType: () => undefined,
      removeAgent: () => {},
      clear: () => {},
      hydrate: () => {},
      panelVisible: () => false,
      togglePanel: () => {},
      setPanelVisible: () => {},
    }
  }
  return ctx
}
