import { createContext, useContext, createSignal, type Accessor, type Setter, type ParentProps } from "solid-js"
import { type AgentChain, Chain, type StepTodo, type SubStep } from "@/agent/chain"

/**
 * Chain Context - Global state for agent task chain
 * 
 * Provides:
 * - Current chain state
 * - Methods to update chain
 * - Per-step todo management
 * - Sub-plan support (nested steps within a parent step)
 * - Parallel step execution
 */

export interface ChainContextValue {
    chain: Accessor<AgentChain | null>
    setChain: Setter<AgentChain | null>

    // Chain operations
    startChain: (mode?: "safe" | "autonomous") => void
    addStep: (name: string, description: string, todos?: StepTodo[]) => void
    updateStepStatus: (status: string, tool?: string) => void
    completeStep: (output?: string) => void
    failStep: (error: string) => void
    retryStep: () => void
    setCurrentStepTodos: (todos: StepTodo[]) => void
    markTodoDone: (todoIndex: number) => void
    clearChain: () => void

    // Sub-plan operations
    startSubPlan: (stepIndex: number, reason: string, steps: { name: string; description: string }[]) => void
    endSubPlan: (stepIndex: number, success: boolean) => void

    // Parallel step operations
    updateStepByIndex: (stepIndex: number, status: string) => void
}

const ChainContext = createContext<ChainContextValue>()

export function ChainProvider(props: ParentProps) {
    const [chain, setChain] = createSignal<AgentChain | null>(null)

    const startChain = (mode: "safe" | "autonomous" = "safe") => {
        setChain(Chain.create(mode))
    }

    const addStep = (name: string, description: string, todos?: StepTodo[]) => {
        const current = chain()
        if (!current) return
        setChain(Chain.addStep(current, { name, description, todos }))
    }

    const updateStepStatus = (status: string, tool?: string) => {
        const current = chain()
        if (!current) return
        setChain(Chain.updateStepStatus(current, status as any, tool))
    }

    const completeStep = (output?: string) => {
        const current = chain()
        if (!current) return
        setChain(Chain.completeStep(current, output))
    }

    const failStep = (error: string) => {
        const current = chain()
        if (!current) return
        setChain(Chain.failStep(current, error))
    }

    const retryStep = () => {
        const current = chain()
        if (!current) return
        setChain(Chain.retryStep(current))
    }

    const setCurrentStepTodos = (todos: StepTodo[]) => {
        const current = chain()
        if (!current) return
        const idx = current.currentStep
        const updatedSteps = [...current.steps]
        if (updatedSteps[idx]) {
            updatedSteps[idx] = { ...updatedSteps[idx], todos }
        }
        setChain({ ...current, steps: updatedSteps })
    }

    const markTodoDone = (todoIndex: number) => {
        const current = chain()
        if (!current) return
        const idx = current.currentStep
        const updatedSteps = [...current.steps]
        if (updatedSteps[idx] && updatedSteps[idx].todos) {
            const updatedTodos = [...updatedSteps[idx].todos!]
            if (updatedTodos[todoIndex]) {
                updatedTodos[todoIndex] = { ...updatedTodos[todoIndex], status: "complete" }
            }
            updatedSteps[idx] = { ...updatedSteps[idx], todos: updatedTodos }
        }
        setChain({ ...current, steps: updatedSteps })
    }

    const startSubPlan = (stepIndex: number, reason: string, steps: { name: string; description: string }[]) => {
        const current = chain()
        if (!current) return
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
        setChain({ ...current, steps: updatedSteps })
    }

    const endSubPlan = (stepIndex: number, success: boolean) => {
        const current = chain()
        if (!current) return
        const updatedSteps = [...current.steps]
        if (updatedSteps[stepIndex]) {
            // Mark all remaining sub-steps as complete or failed
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
        setChain({ ...current, steps: updatedSteps })
    }

    const updateStepByIndex = (stepIndex: number, status: string) => {
        const current = chain()
        if (!current) return
        const updatedSteps = [...current.steps]
        if (updatedSteps[stepIndex]) {
            updatedSteps[stepIndex] = {
                ...updatedSteps[stepIndex],
                status: status as any,
            }
        }
        setChain({ ...current, steps: updatedSteps })
    }

    const clearChain = () => {
        setChain(null)
    }

    const value: ChainContextValue = {
        chain,
        setChain,
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
        // Return a mock context for when ChainProvider is not available
        const [chain] = createSignal<AgentChain | null>(null)
        return {
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
