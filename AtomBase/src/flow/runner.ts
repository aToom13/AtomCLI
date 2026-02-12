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

        const prompt = `${node.prompt}

## CRITICAL INSTRUCTIONS
You MUST follow these rules exactly:

1. First, analyze the request carefully.
2. Break it down into 3-6 concrete, actionable steps.
3. At the END of your response, output a JSON code block with the steps.

## REQUIRED OUTPUT FORMAT
You MUST end your response with this exact JSON format:

\`\`\`json
[
  { "name": "Step 1 Title", "description": "Clear description of what to do" },
  { "name": "Step 2 Title", "description": "Clear description of what to do" }
]
\`\`\`

## EXAMPLE
For "Add a login page":
\`\`\`json
[
  { "name": "Create Login Component", "description": "Create LoginForm component with email/password fields" },
  { "name": "Add Authentication Logic", "description": "Implement auth service with JWT token handling" },
  { "name": "Connect to API", "description": "Wire login form to POST /auth/login endpoint" },
  { "name": "Test Login Flow", "description": "Verify successful and failed login scenarios" }
]
\`\`\`

Do NOT skip the JSON block. It is REQUIRED.`

        const response = await this.executePrompt(prompt)

        // Parse steps from response with multiple fallback patterns
        const steps = this.parseJsonSteps(response)
        if (steps && steps.length > 0) {
            for (const step of steps) {
                this.context.addStep(step.name, step.description || "")
            }
            UI.println(UI.Style.TEXT_SUCCESS + `  ✓ Plan generated with ${steps.length} steps` + UI.Style.TEXT_NORMAL)
            return
        }

        // Fallback: add generic steps if parsing failed
        this.log.warn("Could not parse plan steps from agent response, using defaults")
        this.context.addStep("Analyze", "Analyze the codebase and requirements")
        this.context.addStep("Implement", "Make the required changes")
        this.context.addStep("Verify", "Verify the changes work correctly")
        UI.println(UI.Style.TEXT_WARNING + "  ⚠ Using fallback plan (3 steps)" + UI.Style.TEXT_NORMAL)
    }

    /**
     * Try multiple JSON extraction patterns to parse steps from a response.
     */
    private parseJsonSteps(response: string): Array<{ name: string; description: string }> | null {
        // Pattern 1: Standard fenced code block
        const fencedMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (fencedMatch) {
            try {
                const parsed = JSON.parse(fencedMatch[1].trim())
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) return parsed
            } catch { /* try next pattern */ }
        }

        // Pattern 2: Raw JSON array (no code fences)
        const rawMatch = response.match(/(\[\s*\{[\s\S]*?\}\s*\])/)
        if (rawMatch) {
            try {
                const parsed = JSON.parse(rawMatch[1])
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) return parsed
            } catch { /* try next pattern */ }
        }

        // Pattern 3: Extract numbered list as steps
        const listMatch = [...response.matchAll(/^\d+\.\s*\*\*(.+?)\*\*[:\s]*(.+)$/gm)]
        if (listMatch.length >= 2) {
            return listMatch.map(m => ({ name: m[1].trim(), description: m[2].trim() }))
        }

        return null
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
            const prompt = `## Decision Required

${node.prompt}

**Context:** Step "${step?.name || "unknown"}" has been executed.

## RULES
- You MUST respond with EXACTLY one word.
- Your response must be one of: ${choices.join(" or ")}
- Do NOT add any explanation or additional text.
- Do NOT use quotes or punctuation.

## Example valid responses:
${choices.map(c => `${c}`).join("\n")}

Your answer:`

            const response = await this.executePrompt(prompt)
            const cleaned = response.trim().toUpperCase().replace(/[^A-Z]/g, " ").trim()

            // Find the closest match — check exact first, then includes
            const exactMatch = choices.find(c => cleaned === c)
            if (exactMatch) {
                UI.println(UI.Style.TEXT_DIM + `  → Decision: ${exactMatch}` + UI.Style.TEXT_NORMAL)
                return exactMatch
            }
            const partialMatch = choices.find(c => cleaned.includes(c))
            const matched = partialMatch || choices[0]
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

        const prompt = `## Task Execution

You are executing step ${this.context.getChain().currentStep + 1} of ${this.context.getChain().steps.length}.

**Task:** ${step.name}
**Description:** ${step.description || "No description provided"}

## Instructions
1. Use the available tools (file read/write, bash, search, etc.) to complete this task.
2. Work systematically — read relevant files first, then make changes.
3. After making changes, verify they compile/run correctly.
4. When finished, provide a brief summary of what you accomplished.

## Success Criteria
- All required changes are made
- Code compiles without errors
- The task objectives are met

Begin execution now.`

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

        const prompt = `## Verification Checklist

Verify the implementation of the most recent changes.

### Check each item:
1. **Code Correctness**: Are there any syntax errors, typos, or logical bugs?
2. **Completeness**: Does the implementation cover all requirements?
3. **Integration**: Do the changes work with existing code without breaking anything?
4. **Edge Cases**: Are obvious edge cases handled?

### Actions to take:
- Read the modified files to check for issues
- Run any relevant tests or build commands
- Verify the output matches expectations

### Your verdict:
After checking, state clearly:
- "PASS" if everything looks correct
- "FAIL" followed by a list of specific issues if problems were found`

        await this.executePrompt(prompt)
    }

    private async runDebuggerNode(node: FlowNode & { kind: "debugger" }) {
        UI.println()
        UI.println(UI.Style.TEXT_DANGER_BOLD + "▶ Debugging" + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_DIM + "  Previous step failed, attempting fix..." + UI.Style.TEXT_NORMAL)

        const failedStep = this.context.getChain().steps.find(s => s.status === "failed")
        const prompt = `## Debug & Fix Required

The previous step failed verification.
${failedStep ? `\n**Failed Step:** ${failedStep.name}\n**Error:** ${failedStep.error || "Unknown error"}` : ""}

### Instructions:
1. Read the relevant files to understand what went wrong
2. Identify the root cause of the failure
3. Fix the issue using the available tools
4. Verify your fix resolves the problem

Do NOT just describe the problem — actually FIX it using tools.`

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
