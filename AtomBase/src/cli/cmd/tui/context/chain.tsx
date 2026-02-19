import { createContext, useContext, createSignal, type Accessor, type Setter, type ParentProps } from "solid-js"
import { type AgentChain, Chain, type StepTodo, type SubStep } from "@/agent/chain"

/**
 * Chain Context — Session-scoped chain state management
 *
 * Each session (orchestrator, sub-agent) has its OWN independent chain.
 * When viewing a session, the header reads the chain for THAT session.
 *
 * Storage: Map<sessionID, AgentChain>
 * - Orchestrator session → orchestrator's task assignments chain
 * - Sub-agent session → that agent's own step-by-step chain
 */

export interface ChainContextValue {
    /** Get the chain for a specific session */
    getChain: (sessionID: string) => AgentChain | null
    /** Legacy: global chain accessor (returns chain for "global" key) */
    chain: Accessor<AgentChain | null>
    setChain: Setter<AgentChain | null>

    // Session-scoped chain operations (sessionID optional for backwards compat)
    startChain: (mode?: "safe" | "autonomous", sessionID?: string) => void
    addStep: (name: string, description: string, todos?: StepTodo[], extra?: { sessionId?: string; agentType?: string; dependsOn?: string[]; sessionID?: string }) => void
    updateStepStatus: (status: string, tool?: string, sessionID?: string) => void
    completeStep: (output?: string, sessionID?: string) => void
    failStep: (error: string, sessionID?: string) => void
    retryStep: (sessionID?: string) => void
    setCurrentStepTodos: (todos: StepTodo[], sessionID?: string) => void
    markTodoDone: (todoIndex: number, sessionID?: string) => void
    clearChain: (sessionID?: string) => void

    // Sub-plan operations
    startSubPlan: (stepIndex: number, reason: string, steps: { name: string; description: string }[], sessionID?: string) => void
    endSubPlan: (stepIndex: number, success: boolean, sessionID?: string) => void

    // Parallel step operations
    updateStepByIndex: (stepIndex: number, status: string, sessionID?: string) => void
}

const GLOBAL_KEY = "__global__"
const ChainContext = createContext<ChainContextValue>()

export function ChainProvider(props: ParentProps) {
    // Session-scoped chain storage
    const [chains, setChains] = createSignal<Record<string, AgentChain>>({})

    // Helper: resolve sessionID (fallback to global key)
    const key = (sessionID?: string) => sessionID || GLOBAL_KEY

    // Helper: get chain for a session
    const getChainForSession = (sessionID: string): AgentChain | null => {
        return chains()[sessionID] ?? chains()[GLOBAL_KEY] ?? null
    }

    // Helper: update chain for a session
    const updateChainForSession = (sessionID: string, updater: (chain: AgentChain) => AgentChain) => {
        setChains((prev) => {
            const k = sessionID
            const current = prev[k]
            if (!current) return prev
            return { ...prev, [k]: updater(current) }
        })
    }

    const startChain = (mode: "safe" | "autonomous" = "safe", sessionID?: string) => {
        const k = key(sessionID)
        setChains((prev) => ({ ...prev, [k]: Chain.create(mode) }))
    }

    const addStep = (name: string, description: string, todos?: StepTodo[], extra?: { sessionId?: string; agentType?: string; dependsOn?: string[]; sessionID?: string }) => {
        const k = key(extra?.sessionID)
        updateChainForSession(k, (current) =>
            Chain.addStep(current, {
                name,
                description,
                todos,
                sessionId: extra?.sessionId,
                agentType: extra?.agentType,
                dependsOn: extra?.dependsOn,
            }),
        )
    }

    const updateStepStatus = (status: string, tool?: string, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) =>
            Chain.updateStepStatus(current, status as any, tool),
        )
    }

    const completeStep = (output?: string, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => Chain.completeStep(current, output))
    }

    const failStep = (error: string, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => Chain.failStep(current, error))
    }

    const retryStep = (sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => Chain.retryStep(current))
    }

    const setCurrentStepTodos = (todos: StepTodo[], sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => {
            const idx = current.currentStep
            const updatedSteps = [...current.steps]
            if (updatedSteps[idx]) {
                updatedSteps[idx] = { ...updatedSteps[idx], todos }
            }
            return { ...current, steps: updatedSteps }
        })
    }

    const markTodoDone = (todoIndex: number, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => {
            const idx = current.currentStep
            const updatedSteps = [...current.steps]
            if (updatedSteps[idx] && updatedSteps[idx].todos) {
                const updatedTodos = [...updatedSteps[idx].todos!]
                if (updatedTodos[todoIndex]) {
                    updatedTodos[todoIndex] = { ...updatedTodos[todoIndex], status: "complete" }
                }
                updatedSteps[idx] = { ...updatedSteps[idx], todos: updatedTodos }
            }
            return { ...current, steps: updatedSteps }
        })
    }

    const startSubPlan = (stepIndex: number, reason: string, steps: { name: string; description: string }[], sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => {
            const updatedSteps = [...current.steps]
            if (updatedSteps[stepIndex]) {
                const subSteps: SubStep[] = steps.map((s, i) => ({
                    id: `sub-${stepIndex}-${i}`,
                    name: s.name,
                    description: s.description,
                    status: i === 0 ? "running" : "pending",
                }))
                updatedSteps[stepIndex] = {
                    ...updatedSteps[stepIndex],
                    subSteps,
                    subPlanActive: true,
                    subPlanReason: reason,
                }
            }
            return { ...current, steps: updatedSteps }
        })
    }

    const endSubPlan = (stepIndex: number, success: boolean, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => {
            const updatedSteps = [...current.steps]
            if (updatedSteps[stepIndex]) {
                const subSteps = updatedSteps[stepIndex].subSteps?.map(s => ({
                    ...s,
                    status: (s.status === "pending" || s.status === "running")
                        ? (success ? "complete" as const : "failed" as const)
                        : s.status,
                }))
                updatedSteps[stepIndex] = {
                    ...updatedSteps[stepIndex],
                    subSteps,
                    subPlanActive: false,
                }
            }
            return { ...current, steps: updatedSteps }
        })
    }

    const updateStepByIndex = (stepIndex: number, status: string, sessionID?: string) => {
        updateChainForSession(key(sessionID), (current) => {
            const updatedSteps = [...current.steps]
            if (updatedSteps[stepIndex]) {
                updatedSteps[stepIndex] = {
                    ...updatedSteps[stepIndex],
                    status: status as any,
                }
            }
            return { ...current, steps: updatedSteps }
        })
    }

    const clearChain = (sessionID?: string) => {
        const k = key(sessionID)
        setChains((prev) => {
            const next = { ...prev }
            delete next[k]
            return next
        })
    }

    // Legacy: global chain accessor that tries the global key
    const globalChain = () => chains()[GLOBAL_KEY] ?? null

    const value: ChainContextValue = {
        getChain: getChainForSession,
        chain: globalChain,
        setChain: (() => { }) as any,
        startChain,
        addStep,
        updateStepStatus,
        completeStep,
        failStep,
        retryStep,
        setCurrentStepTodos,
        markTodoDone,
        clearChain,
        startSubPlan,
        endSubPlan,
        updateStepByIndex,
    }

    return (
        <ChainContext.Provider value={value}>
            {props.children}
        </ChainContext.Provider>
    )
}

export function useChain() {
    const ctx = useContext(ChainContext)
    if (!ctx) {
        const [chain] = createSignal<AgentChain | null>(null)
        return {
            getChain: () => null,
            chain,
            setChain: () => { },
            startChain: () => { },
            addStep: () => { },
            updateStepStatus: () => { },
            completeStep: () => { },
            failStep: () => { },
            retryStep: () => { },
            setCurrentStepTodos: () => { },
            markTodoDone: () => { },
            clearChain: () => { },
            startSubPlan: () => { },
            endSubPlan: () => { },
            updateStepByIndex: () => { },
        } as ChainContextValue
    }
    return ctx
}
