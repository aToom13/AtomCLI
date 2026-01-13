import { createContext, useContext, createSignal, type Accessor, type Setter, type ParentProps } from "solid-js"
import { type AgentChain, Chain, type StepTodo } from "@/agent/chain"

/**
 * Chain Context - Global state for agent task chain
 * 
 * Provides:
 * - Current chain state
 * - Methods to update chain
 * - Per-step todo management
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
        } as ChainContextValue
    }
    return ctx
}
