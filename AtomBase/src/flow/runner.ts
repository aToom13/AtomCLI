import { Flow, FlowNode } from "./schema"
import { FlowContext } from "./context"
import { Log } from "../util/log"
import { UI } from "../cli/ui"
import { EOL } from "os"
import type { AtomcliClient } from "@atomcli/sdk/v2"

interface FlowRunnerOptions {
    sdk: AtomcliClient
    sessionID: string
}

export class FlowRunner {
    private log = Log.create({ service: "flow-runner" })
    private flow: Flow
    private context: FlowContext
    private sdk: AtomcliClient
    private sessionID: string
    private currentNodeId: string
    private steps = 0
    private maxSteps = 50
    private lastDecisionChoice: string | undefined

    constructor(flow: Flow, context: FlowContext = new FlowContext(), options: FlowRunnerOptions) {
        this.flow = flow
        this.context = context
        this.sdk = options.sdk
        this.sessionID = options.sessionID
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

    /**
     * Send a prompt to the server agent and stream the response to console.
     * Returns the accumulated text response from the agent.
     */
    private async executePrompt(message: string): Promise<string> {
        // Subscribe to events before sending prompt
        const events = await this.sdk.event.subscribe()
        let responseText = ""
        let errorMsg: string | undefined

        const eventProcessor = (async () => {
            for await (const event of events.stream) {
                if (event.type === "message.part.updated") {
                    const part = event.properties.part
                    if (part.sessionID !== this.sessionID) continue

                    if (part.type === "tool" && part.state.status === "completed") {
                        const tool = part.tool
                        const title =
                            part.state.title ||
                            (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "")
                        if (title) {
                            UI.println(
                                UI.Style.TEXT_DIM + `  │ `,
                                UI.Style.TEXT_INFO_BOLD + tool.padEnd(7, " "),
                                "",
                                UI.Style.TEXT_NORMAL + title,
                            )
                        }
                        // Print bash command output
                        if (part.tool === "bash" && part.state.output?.trim()) {
                            UI.println()
                            UI.println(part.state.output)
                        }
                    }

                    if (part.type === "text" && part.time?.end) {
                        responseText += part.text
                        // Print the agent's text response
                        UI.println()
                        process.stdout.write(UI.markdown(part.text) + EOL)
                        UI.println()
                    }
                }

                if (event.type === "session.error") {
                    const props = event.properties
                    if (props.sessionID !== this.sessionID || !props.error) continue
                    let err = String(props.error.name)
                    if ("data" in props.error && props.error.data && "message" in props.error.data) {
                        err = String(props.error.data.message)
                    }
                    errorMsg = err
                    UI.error(err)
                }

                if (event.type === "session.idle" && event.properties.sessionID === this.sessionID) {
                    break
                }
            }
        })()

        // Send prompt asynchronously
        await this.sdk.session.promptAsync({
            sessionID: this.sessionID,
            parts: [{ type: "text", text: message }],
        })

        // Wait for all events to complete
        await eventProcessor

        if (errorMsg) {
            throw new Error(`Agent error: ${errorMsg}`)
        }

        return responseText
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
        UI.println()
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "▶ Planner" + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_DIM + "  Generating execution plan..." + UI.Style.TEXT_NORMAL)

        const prompt = node.prompt +
            `\n\nIMPORTANT: After your analysis, output a JSON block with the steps you plan to take:
\`\`\`json
[
  { "name": "Step Name", "description": "What to do" }
]
\`\`\`
Keep it to 3-6 concrete steps.`

        const response = await this.executePrompt(prompt)

        // Parse steps from response
        const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (jsonMatch) {
            try {
                const steps = JSON.parse(jsonMatch[1])
                if (Array.isArray(steps)) {
                    // Clear the initial step that was just a placeholder
                    for (const step of steps) {
                        this.context.addStep(step.name, step.description || "")
                    }
                    UI.println(UI.Style.TEXT_SUCCESS + `  ✓ Plan generated with ${steps.length} steps` + UI.Style.TEXT_NORMAL)
                    return
                }
            } catch {
                // Fall through to default steps
            }
        }

        // Fallback: add generic steps if parsing failed
        this.log.warn("Could not parse plan steps from agent response, using defaults")
        this.context.addStep("Analyze", "Analyze the codebase and requirements")
        this.context.addStep("Implement", "Make the required changes")
        this.context.addStep("Verify", "Verify the changes work correctly")
        UI.println(UI.Style.TEXT_WARNING + "  ⚠ Using fallback plan (3 steps)" + UI.Style.TEXT_NORMAL)
    }

    private async runDecisionNode(node: FlowNode & { kind: "decision" }): Promise<string> {
        // "has_task_check" is a local check — no LLM needed
        if (node.id === "has_task_check") {
            const step = this.context.getCurrentStep()
            return step ? "YES" : "NO"
        }

        // "verify_check" asks the LLM to evaluate
        if (node.id === "verify_check") {
            const step = this.context.getCurrentStep()
            UI.println()
            UI.println(UI.Style.TEXT_INFO_BOLD + "⚡ Decision:" + UI.Style.TEXT_NORMAL + ` ${node.prompt}`)

            const choices = node.choices || ["YES", "NO"]
            const prompt = `${node.prompt}

Context: Step "${step?.name || "unknown"}" has been executed.

Respond with EXACTLY one of these choices: ${choices.join(", ")}
Your response must be ONLY the choice word, nothing else.`

            const response = await this.executePrompt(prompt)
            const choice = response.trim().toUpperCase()

            // Find the closest match
            const matched = choices.find(c => choice.includes(c)) || choices[0]
            UI.println(UI.Style.TEXT_DIM + `  → Decision: ${matched}` + UI.Style.TEXT_NORMAL)
            return matched
        }

        return "UNKNOWN"
    }

    private async runSelectorNode(node: FlowNode & { kind: "selector" }) {
        const step = this.context.getCurrentStep()
        if (step) {
            UI.println()
            UI.println(
                UI.Style.TEXT_INFO_BOLD + "◆ Next Step:" + UI.Style.TEXT_NORMAL +
                ` ${step.name}` +
                (step.description ? UI.Style.TEXT_DIM + ` — ${step.description}` + UI.Style.TEXT_NORMAL : "")
            )
        } else {
            this.log.info("No more steps remaining")
        }
    }

    private async runExecutionNode(node: FlowNode & { kind: "execution" }) {
        const step = this.context.getCurrentStep()
        if (!step) return

        UI.println()
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "▶ Executing:" + UI.Style.TEXT_NORMAL + ` ${step.name}`)
        if (step.description) {
            UI.println(UI.Style.TEXT_DIM + `  ${step.description}` + UI.Style.TEXT_NORMAL)
        }

        this.context.updateCurrentStepStatus("running", "coding")

        const prompt = `Execute the following task:

**Task:** ${step.name}
**Description:** ${step.description || "No description provided"}

Use the available tools (file read/write, bash, search, etc.) to complete this task.
When done, confirm what you did.`

        try {
            const response = await this.executePrompt(prompt)
            this.context.completeCurrentStep(response.slice(0, 200))
            UI.println(UI.Style.TEXT_SUCCESS + `  ✓ Step completed` + UI.Style.TEXT_NORMAL)
        } catch (e) {
            this.context.failCurrentStep(String(e))
            UI.println(UI.Style.TEXT_DANGER + `  ✗ Step failed: ${e}` + UI.Style.TEXT_NORMAL)
        }
    }

    private async runVerificationNode(node: FlowNode & { kind: "verification" }) {
        const step = this.context.getCurrentStep()
        UI.println()
        UI.println(UI.Style.TEXT_WARNING_BOLD + "▶ Verifying" + UI.Style.TEXT_NORMAL)

        const prompt = `Verify the implementation of the most recent changes.

Check for:
- Code correctness and completeness
- No obvious bugs or errors
- The changes match the requested task

If you find issues, describe them. If everything looks good, confirm it passes.`

        await this.executePrompt(prompt)
    }

    private async runDebuggerNode(node: FlowNode & { kind: "debugger" }) {
        UI.println()
        UI.println(UI.Style.TEXT_DANGER_BOLD + "▶ Debugging" + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_DIM + "  Previous step failed, attempting fix..." + UI.Style.TEXT_NORMAL)

        const prompt = `The previous step failed verification. Analyze what went wrong and fix the issues.
Use the available tools to investigate and correct the problems.`

        const response = await this.executePrompt(prompt)
        this.context.addStep("Fix Issue", "Fix detected error from previous step")
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
