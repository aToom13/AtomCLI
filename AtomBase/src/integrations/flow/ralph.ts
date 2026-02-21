import { Flow, FlowNode, FlowEdge } from "./schema"

export function createRalphFlow(request: string): Flow {
    // Define Nodes
    const nodes: Record<string, FlowNode> = {
        "start": { id: "start", kind: "start", label: "Start Analysis" },

        // 1. Planner Phase: Generates the initial steps in the AgentChain
        "planner": {
            id: "planner",
            kind: "task",
            prompt: `Analyze the user request: "${request}".\nBreak this down into logical atomic steps for the AgentChain.`
        },

        // 2. Selector Loop Entry
        "selector": {
            id: "selector",
            kind: "selector"
        },

        // 3. Decision: Do we have a CURRENT pending step?
        "has_task_check": {
            id: "has_task_check",
            kind: "decision",
            prompt: "Is there a current step being processed?",
            choices: ["YES", "NO"]
        },

        // 4. Execution Phase
        "executor": {
            id: "executor",
            kind: "execution"
        },

        // 5. Verification Phase
        "verifier": {
            id: "verifier",
            kind: "verification"
        },

        // 6. Verification Decision
        "verify_check": {
            id: "verify_check",
            kind: "decision",
            prompt: "Did the step pass verification?",
            choices: ["PASS", "FAIL"]
        },

        // 7. Debugger (On Fail)
        "debugger": {
            id: "debugger",
            kind: "debugger"
        },

        "end": { id: "end", kind: "end" }
    }

    // Define Edges
    const edges: FlowEdge[] = [
        { from: "start", to: "planner" },
        { from: "planner", to: "selector" },

        { from: "selector", to: "has_task_check" },

        // If NO current step (all done or empty), End
        { from: "has_task_check", to: "end", condition: "!context.getCurrentStep()" },

        // If YES current step, Execute it
        { from: "has_task_check", to: "executor", condition: "context.getCurrentStep()" },

        { from: "executor", to: "verifier" },
        { from: "verifier", to: "verify_check" },

        // Pass -> Back to Selector (to pick next)
        { from: "verify_check", to: "selector", label: "PASS" },

        // Fail -> Debugger -> Back to Selector
        { from: "verify_check", to: "debugger", label: "FAIL" },
        { from: "debugger", to: "selector" }
    ]

    return {
        name: "Ralph Auto-Dev Loop",
        description: "Autonomous Planning, Execution, and Debugging Loop",
        version: "2.0.0",
        nodes,
        edges,
        startNode: "start"
    }
}
