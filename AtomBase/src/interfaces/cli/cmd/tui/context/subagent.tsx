import { createContext, useContext, createSignal, type ParentProps, type Accessor } from "solid-js"

/**
 * SubAgent Context — Tracks active sub-agents across the TUI.
 *
 * Managed by use-sdk-events.tsx which listens to SubAgentActive/SubAgentDone/SubAgentReactivate
 * events from the Bus and updates this context. The SubAgentPanel reads from
 * this context to render active agent cards.
 *
 * Agent lifecycle:
 *   running → waiting/failed → running (re-tasked) → ...
 *   Only removed when orchestrator explicitly closes them.
 */

export interface ActiveSubAgent {
  sessionId: string
  agentType: string
  description: string
  status: "running" | "waiting" | "failed"
  parentSessionId?: string
  /** Parent taskflow step active when this agent started. */
  parentStepId?: string
  /** Latest output/context returned to orchestrator */
  lastOutput?: string
  runtime?: string
  startedAt?: number
  updatedAt?: number
  activities?: SubAgentActivity[]
}

export type SubAgentActivity = {
  kind: "tool" | "transcript" | "command"
  label: string
  status?: "pending" | "running" | "completed" | "error"
  output?: string
  time: number
}

export interface SubAgentContextValue {
  agents: Accessor<ActiveSubAgent[]>
  parentSessionId: Accessor<string | undefined>
  addAgent: (agent: Omit<ActiveSubAgent, "status">) => void
  markWaiting: (sessionId: string, lastOutput?: string, completedAt?: number) => void
  markFailed: (sessionId: string, error: string) => void
  reactivate: (
    sessionId: string,
    description?: string,
    parentSessionId?: string,
    parentStepId?: string,
    startedAt?: number,
  ) => void
  recordActivity: (sessionId: string, activity: SubAgentActivity) => void
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
        return prev.map((a) => (a.sessionId === agent.sessionId ? { ...a, ...agent, status: "running" as const } : a))
      }
      return [...prev, { ...agent, status: "running", startedAt: agent.startedAt ?? Date.now(), updatedAt: Date.now() }]
    })
    // Auto-open panel when first agent becomes active
    setPanelVisible(true)
  }

  const markWaiting = (sessionId: string, lastOutput?: string, completedAt?: number) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.sessionId === sessionId
          ? {
              ...a,
              status: "waiting" as const,
              lastOutput: lastOutput ?? a.lastOutput,
              updatedAt: completedAt ?? Date.now(),
            }
          : a,
      ),
    )
  }

  const markFailed = (sessionId: string, error: string) => {
    setAgents((prev) =>
      prev.map((agent) =>
        agent.sessionId === sessionId
          ? { ...agent, status: "failed" as const, lastOutput: error, updatedAt: Date.now() }
          : agent,
      ),
    )
  }

  const reactivate = (
    sessionId: string,
    description?: string,
    parentSessionId?: string,
    parentStepId?: string,
    startedAt?: number,
  ) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.sessionId === sessionId
          ? {
              ...a,
              status: "running" as const,
              description: description ?? a.description,
              parentSessionId: parentSessionId ?? a.parentSessionId,
              parentStepId: parentStepId ?? a.parentStepId,
              startedAt: startedAt ?? Date.now(),
              updatedAt: Date.now(),
            }
          : a,
      ),
    )
  }

  const recordActivity = (sessionId: string, activity: SubAgentActivity) => {
    setAgents((prev) =>
      prev.map((agent) =>
        agent.sessionId === sessionId
          ? {
              ...agent,
              updatedAt: activity.time,
              activities: [...(agent.activities ?? []), activity].slice(-20),
            }
          : agent,
      ),
    )
  }

  const findByType = (agentType: string) => {
    return agents().find((a) => a.agentType === agentType)
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
        markFailed,
        reactivate,
        recordActivity,
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
      markFailed: () => {},
      reactivate: () => {},
      recordActivity: () => {},
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

/**
 * Return running sub-agents associated with a taskflow step.
 *
 * New lifecycle events carry an exact parentStepId. The current-step fallback
 * keeps recovered/legacy sessions useful without showing an agent beneath the
 * wrong non-current step.
 */
export function runningAgentsForStep(
  agents: ActiveSubAgent[],
  stepId: string,
  isCurrent: boolean,
  parentSessionId?: string,
): ActiveSubAgent[] {
  const running = agents.filter(
    (agent) =>
      agent.status === "running" &&
      (!parentSessionId || !agent.parentSessionId || agent.parentSessionId === parentSessionId),
  )
  const exact = running.filter((agent) => agent.parentStepId === stepId)
  if (exact.length > 0) return exact
  if (!isCurrent) return []
  return running.filter((agent) => !agent.parentStepId)
}
