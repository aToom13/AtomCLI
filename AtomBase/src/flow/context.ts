import { Chain, type AgentChain, type ChainStep } from "../agent/chain"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"

export class FlowContext {
    private variables: Record<string, any> = {}
    private chain: AgentChain

    constructor(initialVars: Record<string, any> = {}) {
        this.variables = { ...initialVars }
        this.chain = Chain.create("autonomous")
    }

    set(key: string, value: any) {
        this.variables[key] = value
    }

    get(key: string): any {
        return this.variables[key]
    }

    // --- Real AgentChain Integration ---

    startChain(mode: "safe" | "autonomous" = "autonomous") {
        this.chain = Chain.create(mode)
        Bus.publish(TuiEvent.ChainStart, { mode })
    }

    // Initialize the chain with steps
    setChain(chain: AgentChain) {
        this.chain = chain
        // If setting a full chain, we might need a distinct event or just reset
        Bus.publish(TuiEvent.ChainClear, {})
        Bus.publish(TuiEvent.ChainStart, { mode: chain.mode })
        for (const step of chain.steps) {
            Bus.publish(TuiEvent.ChainAddStep, {
                name: step.name,
                description: step.description,
                todos: step.todos?.map(t => ({ ...t, id: t.id || crypto.randomUUID() })) // Ensure IDs
            })
        }
    }

    getChain(): AgentChain {
        return this.chain
    }

    // Add a new step to the chain
    addStep(name: string, description: string = "") {
        const step: Omit<ChainStep, "id" | "status" | "retryCount" | "todos"> = {
            name,
            description,
            tool: "analyzing"
        }
        this.chain = Chain.addStep(this.chain, step)

        // Emit UI Event
        Bus.publish(TuiEvent.ChainAddStep, { name, description })

        // If first step, start execution
        if (this.chain.steps.length === 1) {
            this.chain = Chain.startExecution(this.chain)
            // ChainStart event usually handles the status, but we might need to be explicit if UI expects it
        }
        return this.chain.steps[this.chain.steps.length - 1]
    }

    // Get the current pending step
    getCurrentStep(): ChainStep | undefined {
        if (this.chain.status === "complete" || this.chain.status === "failed") return undefined
        const step = this.chain.steps[this.chain.currentStep]
        if (step && (step.status === "complete" || step.status === "failed")) return undefined
        return step
    }

    completeCurrentStep(output?: string) {
        this.chain = Chain.completeStep(this.chain, output)
        Bus.publish(TuiEvent.ChainCompleteStep, { output })
    }

    failCurrentStep(error: string) {
        this.chain = Chain.failStep(this.chain, error)
        Bus.publish(TuiEvent.ChainFailStep, { error })
    }

    updateCurrentStepStatus(status: ChainStep["status"], tool?: string) {
        this.chain = Chain.updateStepStatus(this.chain, status, tool)
        Bus.publish(TuiEvent.ChainUpdateStep, { status, tool })
    }
}
