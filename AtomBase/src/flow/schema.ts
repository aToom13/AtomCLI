import z from "zod"

// Support markdown in labels/descriptions
export const Markdown = z.string()

export const FlowNodeKind = z.enum(["start", "end", "task", "decision", "selector", "execution", "verification", "debugger"])

export const FlowNodeBase = z.object({
    id: z.string(),
    kind: FlowNodeKind,
    label: z.string().optional(),
})

export const FlowNodeStart = FlowNodeBase.extend({
    kind: z.literal("start"),
})

export const FlowNodeEnd = FlowNodeBase.extend({
    kind: z.literal("end"),
})

export const FlowNodeTask = FlowNodeBase.extend({
    kind: z.literal("task"),
    prompt: z.string(), // The prompt to send to LLM
})

export const FlowNodeDecision = FlowNodeBase.extend({
    kind: z.literal("decision"),
    prompt: z.string(), // Prompt explaining the choice
    choices: z.array(z.string()).optional(), // Expected choices
})

// Ralph Loop Specific Nodes
export const FlowNodeSelector = FlowNodeBase.extend({
    kind: z.literal("selector"),
    description: z.string().optional()
})

export const FlowNodeExecution = FlowNodeBase.extend({
    kind: z.literal("execution"),
    description: z.string().optional()
})

export const FlowNodeVerification = FlowNodeBase.extend({
    kind: z.literal("verification"),
    checks: z.array(z.string()).optional()
})

export const FlowNodeDebugger = FlowNodeBase.extend({
    kind: z.literal("debugger"),
    context: z.string().optional()
})

export const FlowNode = z.discriminatedUnion("kind", [
    FlowNodeStart,
    FlowNodeEnd,
    FlowNodeTask,
    FlowNodeDecision,
    FlowNodeSelector,
    FlowNodeExecution,
    FlowNodeVerification,
    FlowNodeDebugger
])

export const FlowEdge = z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(), // For decision branches (e.g. "RETRY", "SUCCESS")
    condition: z.string().optional(), // Logic for selector/decision
})

export const Flow = z.object({
    name: z.string(),
    description: z.string(),
    version: z.string().default("1.0.0"),
    nodes: z.record(z.string(), FlowNode), // ID -> Node
    edges: z.array(FlowEdge),
    startNode: z.string(),
})

export type FlowNode = z.infer<typeof FlowNode>
export type FlowEdge = z.infer<typeof FlowEdge>
export type Flow = z.infer<typeof Flow>
