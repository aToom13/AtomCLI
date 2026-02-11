import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"

const DESCRIPTION = `Manage the task chain progress bar in the UI. Shows your work plan and real-time progress to the user.

**RULES — FOLLOW THESE STRICTLY:**
1. ALWAYS call "start" FIRST when beginning any multi-step task
2. Update status FREQUENTLY as you work (every tool call if possible)
3. Mark todos as done when you complete them — this is critical for user visibility
4. When a step has problems, create a sub-plan instead of giving up
5. Call "clear" when ALL work is finished

**Actions:**
- "start": Create a new chain with steps. Each step can have optional todos.
- "add_step": Dynamically add a new step to the chain.
- "update": Update current step status (e.g., coding, searching_web, analyzing).
- "set_todos": Set/replace todo items on the current step.
- "todo_done": Mark a todo item as complete (0-based index).
- "complete": Mark current step as complete, advance to next.
- "fail": Mark current step as failed.
- "sub_plan": When a step has issues, create a nested sub-plan to resolve them. The main plan stays fixed; the sub-plan handles the problem within that specific step.
- "sub_plan_end": End the current sub-plan and return to the main plan.
- "parallel_update": Update a specific step by index (for parallel execution).
- "clear": Remove the chain when done.

**Sub-Plan Example:**
When step 2 "Build API" fails because of a missing dependency:
1. chainupdate action="sub_plan" step_index=1 reason="Missing express dependency" sub_steps=[{"name":"Install express","description":"npm install express"},{"name":"Fix import","description":"Update import path"}]
2. Work on sub-steps...
3. chainupdate action="sub_plan_end" step_index=1 success=true
4. Continue with main plan step 2

**Parallel Example:**
Mark step 0 and step 1 as both running:
1. chainupdate action="parallel_update" step_index=0 status="coding"
2. chainupdate action="parallel_update" step_index=1 status="searching_web"

**Status Values:** pending, running, coding, searching_web, searching_code, reading_file, writing_file, running_command, analyzing, thinking
`

const StepWithTodosSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    todos: z.array(z.string()).optional()
})

const SubStepSchema = z.object({
    name: z.string(),
    description: z.string(),
})

export const ChainUpdateTool = Tool.define("chainupdate", {
    description: DESCRIPTION,
    parameters: z.object({
        action: z.enum([
            "start", "add_step", "update", "complete", "fail", "clear",
            "set_todos", "todo_done",
            "sub_plan", "sub_plan_end",
            "parallel_update"
        ]).describe("The action to perform on the chain"),
        // start action
        steps: z.union([
            z.array(z.string()),
            z.array(StepWithTodosSchema)
        ]).optional()
            .describe("Step names (strings) or step objects with todos for 'start' action"),
        // add_step action
        step_name: z.string().optional()
            .describe("Name of the new step for 'add_step' action"),
        step_description: z.string().optional()
            .describe("Description for 'add_step' action"),
        step_todos: z.array(z.string()).optional()
            .describe("Todos for 'add_step' action"),
        // update action
        status: z.enum([
            "pending", "running", "coding", "searching_web", "searching_code",
            "reading_file", "writing_file", "running_command", "analyzing",
            "thinking", "complete", "failed", "retrying"
        ]).optional()
            .describe("Status for 'update' and 'parallel_update' actions"),
        tool: z.string().optional()
            .describe("Tool name being used for 'update' action"),
        // todo actions
        todos: z.array(z.string()).optional()
            .describe("Todo items for 'set_todos' action"),
        todo_index: z.number().optional()
            .describe("Index (0-based) for 'todo_done' action"),
        // complete/fail actions
        output: z.string().optional()
            .describe("Output message for 'complete' action"),
        error: z.string().optional()
            .describe("Error message for 'fail' action"),
        // sub_plan action
        step_index: z.number().optional()
            .describe("Step index (0-based) for sub_plan, sub_plan_end, and parallel_update"),
        reason: z.string().optional()
            .describe("Reason for creating a sub-plan"),
        sub_steps: z.array(SubStepSchema).optional()
            .describe("Steps for the sub-plan"),
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
                        if (typeof step === "string") {
                            await Bus.publish(TuiEvent.ChainAddStep, {
                                name: step,
                                description: step
                            })
                        } else {
                            const todos = step.todos?.map((t, i) => ({
                                id: `todo-${i}`,
                                content: t,
                                status: "pending" as const
                            }))
                            await Bus.publish(TuiEvent.ChainAddStep, {
                                name: step.name,
                                description: step.description || step.name,
                                todos
                            })
                        }
                    }
                    await Bus.publish(TuiEvent.ChainUpdateStep, { status: "running" })
                }
                return {
                    title: `Chain started with ${params.steps?.length ?? 0} steps`,
                    output: `Chain initialized. Update status frequently, mark todos done, and use sub_plan for issues.`,
                    metadata: {},
                }

            case "add_step":
                if (params.step_name) {
                    const todos = params.step_todos?.map((t, i) => ({
                        id: `todo-${crypto.randomUUID().slice(0, 8)}`,
                        content: t,
                        status: "pending" as const
                    }))
                    await Bus.publish(TuiEvent.ChainAddStep, {
                        name: params.step_name,
                        description: params.step_description || params.step_name,
                        todos
                    })
                    return {
                        title: `Added: ${params.step_name}`,
                        output: `New step "${params.step_name}" added to the chain`,
                        metadata: {},
                    }
                }
                return { title: "Error", output: "step_name is required", metadata: {} }

            case "update":
                if (params.status) {
                    await Bus.publish(TuiEvent.ChainUpdateStep, {
                        status: params.status,
                        tool: params.tool,
                    })
                }
                return {
                    title: `${params.status}${params.tool ? ` (${params.tool})` : ""}`,
                    output: `Step status: ${params.status}`,
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
                    title: `${params.todos?.length ?? 0} todos set`,
                    output: `Todos set for current step`,
                    metadata: {},
                }

            case "todo_done":
                if (params.todo_index !== undefined) {
                    await Bus.publish(TuiEvent.ChainTodoDone, { todoIndex: params.todo_index })
                }
                return {
                    title: `Todo #${(params.todo_index ?? 0) + 1} ✓`,
                    output: `Marked todo ${params.todo_index} as complete`,
                    metadata: {},
                }

            case "complete":
                await Bus.publish(TuiEvent.ChainCompleteStep, {
                    output: params.output,
                })
                return {
                    title: "Step completed ✓",
                    output: params.output || "Step complete, advancing to next",
                    metadata: {},
                }

            case "fail":
                await Bus.publish(TuiEvent.ChainFailStep, {
                    error: params.error ?? "Unknown error"
                })
                return {
                    title: "Step failed ✗",
                    output: `Failed: ${params.error}. Consider using sub_plan to resolve the issue.`,
                    metadata: {},
                }

            case "sub_plan":
                if (params.step_index !== undefined && params.sub_steps && params.reason) {
                    await Bus.publish(TuiEvent.ChainSubPlanStart, {
                        stepIndex: params.step_index,
                        reason: params.reason,
                        steps: params.sub_steps,
                    })
                    return {
                        title: `Sub-plan for step ${params.step_index + 1}`,
                        output: `Created sub-plan with ${params.sub_steps.length} steps: ${params.reason}`,
                        metadata: {},
                    }
                }
                return { title: "Error", output: "step_index, reason, and sub_steps are required", metadata: {} }

            case "sub_plan_end":
                if (params.step_index !== undefined) {
                    const success = params.error === undefined
                    await Bus.publish(TuiEvent.ChainSubPlanEnd, {
                        stepIndex: params.step_index,
                        success,
                    })
                    return {
                        title: success ? "Sub-plan completed ✓" : "Sub-plan failed ✗",
                        output: success ? "Sub-plan resolved, returning to main plan" : `Sub-plan failed: ${params.error}`,
                        metadata: {},
                    }
                }
                return { title: "Error", output: "step_index is required", metadata: {} }

            case "parallel_update":
                if (params.step_index !== undefined && params.status) {
                    await Bus.publish(TuiEvent.ChainParallelUpdate, {
                        stepIndex: params.step_index,
                        status: params.status,
                    })
                    return {
                        title: `Step ${params.step_index + 1}: ${params.status}`,
                        output: `Updated step ${params.step_index + 1} to ${params.status}`,
                        metadata: {},
                    }
                }
                return { title: "Error", output: "step_index and status are required", metadata: {} }

            case "clear":
                await Bus.publish(TuiEvent.ChainClear, {})
                return {
                    title: "Chain cleared",
                    output: "Task chain cleared",
                    metadata: {},
                }
        }
    },
})
