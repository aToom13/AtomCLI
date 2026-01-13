import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"

const DESCRIPTION = `Use this tool to update the task chain progress bar in the UI.

Call this tool at the START of your work to set up the chain, and then update it as you complete steps.

Actions:
- "start": Start a new chain with steps and their todos
- "update": Update current step status  
- "todo_done": Mark a specific todo as complete (by index, 0-based)
- "complete": Mark current step complete and move to next
- "fail": Mark current step as failed
- "clear": Clear the chain when done

Example usage:
1. At start of task, call with action="start" and steps with todos:
   chainupdate action="start" steps=[
     {"name": "Research", "todos": ["Search web", "Read docs", "Take notes"]},
     {"name": "Code", "todos": ["Create file", "Write function", "Add tests"]},
     {"name": "Test", "todos": ["Run tests", "Fix bugs"]}
   ]

2. As you work, call with action="update" and status="coding" etc.
3. When you complete a todo: action="todo_done" todo_index=0 (marks first todo as done)
4. When step done, call with action="complete"
5. At end, call with action="clear"

IMPORTANT: Call "todo_done" for each todo you complete! This shows progress to the user.
`

const StepWithTodosSchema = z.object({
    name: z.string(),
    todos: z.array(z.string()).optional()
})

export const ChainUpdateTool = Tool.define("chainupdate", {
    description: DESCRIPTION,
    parameters: z.object({
        action: z.enum(["start", "update", "complete", "fail", "clear", "set_todos", "todo_done"])
            .describe("The action to perform on the chain"),
        steps: z.union([
            z.array(z.string()),
            z.array(StepWithTodosSchema)
        ]).optional()
            .describe("Step names (strings) or step objects with todos for 'start' action"),
        status: z.enum([
            "pending", "running", "coding", "searching_web", "searching_code",
            "reading_file", "writing_file", "running_command", "analyzing",
            "thinking", "complete", "failed", "retrying"
        ]).optional()
            .describe("Status for 'update' action"),
        todos: z.array(z.string()).optional()
            .describe("Todo items for 'set_todos' action - sets todos on current step"),
        todo_index: z.number().optional()
            .describe("Index of todo to mark complete (0-based) for 'todo_done' action"),
        error: z.string().optional()
            .describe("Error message for 'fail' action"),
    }),
    async execute(params, ctx) {
        // Auto-allow this tool (no permission needed for UI updates)
        await ctx.ask({
            permission: "chainupdate",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
        })

        switch (params.action) {
            case "start":
                if (params.steps && params.steps.length > 0) {
                    await Bus.publish(TuiEvent.ChainStart, { mode: "safe" })

                    for (const step of params.steps) {
                        // Handle both string and object formats
                        if (typeof step === "string") {
                            await Bus.publish(TuiEvent.ChainAddStep, {
                                name: step,
                                description: step
                            })
                        } else {
                            // Step object with todos
                            const todos = step.todos?.map((t, i) => ({
                                id: `todo-${i}`,
                                content: t,
                                status: "pending" as const
                            }))
                            await Bus.publish(TuiEvent.ChainAddStep, {
                                name: step.name,
                                description: step.name,
                                todos
                            })
                        }
                    }
                    // Start first step
                    await Bus.publish(TuiEvent.ChainUpdateStep, { status: "running" })
                }
                return {
                    title: `Chain started with ${params.steps?.length ?? 0} steps`,
                    output: `Chain initialized with steps and todos`,
                    metadata: {},
                }

            case "update":
                if (params.status) {
                    await Bus.publish(TuiEvent.ChainUpdateStep, {
                        status: params.status
                    })
                }
                return {
                    title: `Status: ${params.status}`,
                    output: `Chain step updated to: ${params.status}`,
                    metadata: {},
                }

            case "set_todos":
                if (params.todos) {
                    const todos = params.todos.map((t, i) => ({
                        id: `todo-${i}`,
                        content: t,
                        status: "pending" as const
                    }))
                    await Bus.publish(TuiEvent.ChainSetTodos, { todos })
                }
                return {
                    title: `Set ${params.todos?.length ?? 0} todos`,
                    output: `Todos set for current step`,
                    metadata: {},
                }

            case "todo_done":
                if (params.todo_index !== undefined) {
                    await Bus.publish(TuiEvent.ChainTodoDone, { todoIndex: params.todo_index })
                }
                return {
                    title: `Todo ${params.todo_index} complete`,
                    output: `Marked todo ${params.todo_index} as complete`,
                    metadata: {},
                }

            case "complete":
                await Bus.publish(TuiEvent.ChainCompleteStep, {})
                return {
                    title: "Step completed",
                    output: "Current step marked as complete, moving to next step",
                    metadata: {},
                }

            case "fail":
                await Bus.publish(TuiEvent.ChainFailStep, {
                    error: params.error ?? "Unknown error"
                })
                return {
                    title: "Step failed",
                    output: `Step failed: ${params.error}`,
                    metadata: {},
                }

            case "clear":
                await Bus.publish(TuiEvent.ChainClear, {})
                return {
                    title: "Chain cleared",
                    output: "Task chain has been cleared",
                    metadata: {},
                }
        }
    },
})
