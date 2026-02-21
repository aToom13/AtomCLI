import { Chain, type AgentChain, type ChainStep } from "../agent/chain"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "flow-context" })

/**
 * FlowContext manages the execution state for the Ralph autonomous loop.
 *
 * IMPORTANT: This class coordinates with the chainupdate tool:
 * - Both FlowContext and chainupdate can emit TUI events
 * - FlowContext manages the internal chain state
 * - chainupdate tool provides UI control for the agent
 *
 * Chain state changes are automatically synchronized to the TUI via Bus events.
 */
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

  /**
   * Start a new chain. This emits ChainStart event to the TUI.
   * Note: If chainupdate tool was already used, this will reset the chain.
   */
  startChain(mode: "safe" | "autonomous" = "autonomous") {
    this.chain = Chain.create(mode)
    Bus.publish(TuiEvent.ChainStart, { mode })
    log.info("chain started", { mode, stepCount: this.chain.steps.length })
  }

  /**
   * Initialize the chain with existing steps. Syncs to TUI.
   */
  setChain(chain: AgentChain) {
    this.chain = chain
    // Clear and rebuild the TUI chain display
    Bus.publish(TuiEvent.ChainClear, {})
    Bus.publish(TuiEvent.ChainStart, { mode: chain.mode })
    for (const step of chain.steps) {
      Bus.publish(TuiEvent.ChainAddStep, {
        name: step.name,
        description: step.description,
        todos: step.todos?.map((t) => ({ ...t, id: t.id || crypto.randomUUID() })),
      })
    }
    log.info("chain set", { stepCount: chain.steps.length })
  }

  getChain(): AgentChain {
    return this.chain
  }

  /**
   * Add a new step to the chain. Automatically syncs to TUI.
   */
  addStep(name: string, description: string = "") {
    const step: Omit<ChainStep, "id" | "status" | "retryCount" | "todos"> = {
      name,
      description,
      tool: "analyzing",
    }
    this.chain = Chain.addStep(this.chain, step)

    // Emit UI Event for synchronization
    Bus.publish(TuiEvent.ChainAddStep, { name, description })

    // If first step, start execution
    if (this.chain.steps.length === 1) {
      this.chain = Chain.startExecution(this.chain)
      Bus.publish(TuiEvent.ChainUpdateStep, { status: "running" })
    }

    log.debug("step added", { name, description, totalSteps: this.chain.steps.length })
    return this.chain.steps[this.chain.steps.length - 1]
  }

  /**
   * Get the current pending step (not complete/failed)
   */
  getCurrentStep(): ChainStep | undefined {
    if (this.chain.status === "complete" || this.chain.status === "failed") return undefined
    const step = this.chain.steps[this.chain.currentStep]
    if (step && (step.status === "complete" || step.status === "failed")) return undefined
    return step
  }

  /**
   * Complete the current step and advance to the next.
   * Automatically syncs to TUI.
   */
  completeCurrentStep(output?: string) {
    const previousStep = this.chain.steps[this.chain.currentStep]
    this.chain = Chain.completeStep(this.chain, output)
    Bus.publish(TuiEvent.ChainCompleteStep, { output })
    log.info("step completed", {
      stepName: previousStep?.name,
      output: output?.slice(0, 50),
      nextStep: this.chain.steps[this.chain.currentStep]?.name,
    })
  }

  /**
   * Mark the current step as failed.
   * Automatically syncs to TUI.
   */
  failCurrentStep(error: string) {
    const previousStep = this.chain.steps[this.chain.currentStep]
    this.chain = Chain.failStep(this.chain, error)
    Bus.publish(TuiEvent.ChainFailStep, { error })
    log.warn("step failed", { stepName: previousStep?.name, error })
  }

  /**
   * Update the current step's status.
   * Automatically syncs to TUI.
   */
  updateCurrentStepStatus(status: ChainStep["status"], tool?: string) {
    this.chain = Chain.updateStepStatus(this.chain, status, tool)
    Bus.publish(TuiEvent.ChainUpdateStep, { status, tool })
    log.debug("step status updated", { status, tool })
  }

  /**
   * Mark a todo as complete in the current step.
   * This is a convenience method that wraps the ChainTodoDone event.
   */
  completeTodo(todoIndex: number) {
    Bus.publish(TuiEvent.ChainTodoDone, { todoIndex })
    log.debug("todo marked complete", { todoIndex })
  }
}
