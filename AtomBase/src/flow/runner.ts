import { Flow, FlowNode } from "./schema"
import { FlowContext } from "./context"
// import { Session } from "../session" 
import { Log } from "../util/log"

export class FlowRunner {
    private log = Log.create({ service: "flow-runner" })
    private flow: Flow
    private context: FlowContext
    private session: any
    private currentNodeId: string
    private steps = 0
    private maxSteps = 50
    private lastDecisionChoice: string | undefined

    constructor(flow: Flow, session: any, context: FlowContext = new FlowContext()) {
        this.flow = flow
        this.session = session
        this.context = context
        this.currentNodeId = flow.startNode
    }

    async run(): Promise<void> {
        this.log.info("Starting flow execution", { flow: this.flow.name })

        while (this.steps < this.maxSteps) {
            this.steps++
            const currentNode = this.flow.nodes[this.currentNodeId]

            if (!currentNode) {
                throw new Error(`Node not found: ${this.currentNodeId}`)
            }

            this.log.debug("Executing node", { id: currentNode.id, kind: currentNode.kind })

            if (currentNode.kind === "end") {
                this.log.info("Flow finished")
                return
            }

            await this.executeNode(currentNode)

            const nextId = this.findNextNode(currentNode)
            if (!nextId) {
                this.log.warn("No outgoing edge found, ending flow implicitly")
                return
            }
            this.currentNodeId = nextId
        }

        throw new Error(`Flow execution exceeded max steps (${this.maxSteps})`)
    }

    private async executeNode(node: FlowNode): Promise<void> {
        switch (node.kind) {
            case "start":
                break
            case "task":
                await this.runTaskNode(node)
                break
            case "decision":
                this.lastDecisionChoice = await this.runDecisionNode(node)
                break
            case "selector":
                await this.runSelectorNode(node)
                break
            case "execution":
                await this.runExecutionNode(node)
                break
            case "verification":
                await this.runVerificationNode(node)
                break
            case "debugger":
                await this.runDebuggerNode(node)
                break
        }
    }

    private async runTaskNode(node: FlowNode & { kind: "task" }) {
        this.log.info("Running Task Node", { prompt: node.prompt })
        if (node.id === "planner") {
            // Mock Planner: Adds initial steps to the chain
            this.log.info("Planner: Generating initial steps...")
            this.context.addStep("Initialize Project Structure", "Create necessary folders")
            this.context.addStep("Implement Core Logic", "Write main.ts")
            this.context.addStep("Verify Implementation", "Run tests")
        }
    }

    private async runDecisionNode(node: FlowNode & { kind: "decision" }): Promise<string> {
        this.log.info("Running Decision", { prompt: node.prompt })

        if (node.id === "has_task_check") {
            const step = this.context.getCurrentStep()
            return step ? "YES" : "NO"
        }
        if (node.id === "verify_check") {
            return "PASS"
        }
        return "UNKNOWN"
    }

    private async runSelectorNode(node: FlowNode & { kind: "selector" }) {
        const step = this.context.getCurrentStep()
        if (step) {
            this.log.info("Selected Next Step", { name: step.name, status: step.status })
            // If step is pending, mark as running?? Or leave for executor?
            // Chain.updateStepStatus(..., "running")?
        } else {
            this.log.info("No current step found.")
        }
    }

    private async runExecutionNode(node: FlowNode & { kind: "execution" }) {
        const step = this.context.getCurrentStep()
        if (!step) return

        this.log.info("Executing Step...", { name: step.name })
        this.context.updateCurrentStepStatus("running", "coding")

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 500))
        // Mark complete?? Or should verification mark complete?
        // Usually execution finishes the WORK.
        this.context.completeCurrentStep("Done via simulation")
    }

    private async runVerificationNode(node: FlowNode & { kind: "verification" }) {
        // Logic for verification
        this.log.info("Verifying...")
        await new Promise(resolve => setTimeout(resolve, 300))
    }

    private async runDebuggerNode(node: FlowNode & { kind: "debugger" }) {
        this.log.warn("Debugging failure...")
        this.context.addStep("Fix Issue", "Fix the detected error from previous step")
    }

    private findNextNode(node: FlowNode): string | undefined {
        const potentialEdges = this.flow.edges.filter(e => e.from === node.id)

        if (potentialEdges.length === 0) return undefined
        if (potentialEdges.length === 1) return potentialEdges[0].to

        for (const edge of potentialEdges) {
            if (edge.condition) {
                try {
                    // Expose 'context' to the evaluation scope
                    const context = this.context
                    // eslint-disable-next-line no-new-func
                    const conditionMet = new Function("context", `return ${edge.condition}`)(context)
                    if (conditionMet) return edge.to
                } catch (e) {
                    this.log.error("Condition eval failed", { error: e })
                }
            }

            if (edge.label && this.lastDecisionChoice) {
                if (edge.label === this.lastDecisionChoice) return edge.to
            }
        }

        return potentialEdges[0].to
    }
}
