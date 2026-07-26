import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { parseJsonIfString } from "@/util/util/zod"

const TaskFlowTodoSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
})

const TaskFlowStepSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  todos: z.array(z.union([z.string(), TaskFlowTodoSchema])).optional(),
})

const parameters = z.object({
  action: z
    .enum(["start", "update", "complete", "fail", "clear"])
    .describe("Taskflow action: 'start' plan, 'update' step/todo status, 'complete', 'fail', or 'clear'"),
  plan: parseJsonIfString(z.array(TaskFlowStepSchema))
    .optional()
    .describe("List of steps with optional todos for action='start'"),
  step_id: z.string().optional().describe("Step ID or index (0-based) for update/complete/fail"),
  todo_id: z.string().optional().describe("Optional Todo ID or index (0-based) for update"),
  status: z
    .enum(["pending", "running", "completed", "failed"])
    .optional()
    .describe("Step status for update"),
  todo_status: z
    .enum(["pending", "in_progress", "completed", "cancelled"])
    .optional()
    .describe("Todo status for update"),
  output: z.string().optional().describe("Output or completion message"),
})

export const TaskFlowTool = Tool.define("taskflow", {
  description: [
    "Unified progress tracking tool combining step planning and todo item management.",
    "Use action='start' with a plan array to initialize your workflow.",
    "Use action='update' to update step or todo status as you execute.",
    "Use action='complete' when a step or the whole flow finishes.",
    "Use action='clear' when done.",
  ].join("\n"),
  parameters,
  async execute(params, ctx) {
    await ctx.ask({
      permission: "taskflow",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    switch (params.action) {
      case "start": {
        await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
        await new Promise((resolve) => setTimeout(resolve, 10))

        if (params.plan && params.plan.length > 0) {
          await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID })

          for (let idx = 0; idx < params.plan.length; idx++) {
            const step = params.plan[idx]
            if (!step.name || step.name.length < 2) continue

            const todos = step.todos?.map((t, i) => {
              const content = typeof t === "string" ? t : t.content
              const st = typeof t === "string" ? "pending" : t.status
              const mappedStatus = st === "completed" ? "complete" : st === "cancelled" ? "failed" : st || "pending"
              return {
                id: typeof t === "string" ? `todo-${i}` : t.id || `todo-${i}`,
                content,
                status: mappedStatus as "pending" | "in_progress" | "complete" | "failed",
              }
            })

            await Bus.publish(TuiEvent.ChainAddStep, {
              name: step.name,
              description: step.name,
              todos,
              sessionID: ctx.sessionID,
            })
          }
          await Bus.publish(TuiEvent.ChainUpdateStep, { status: "running", sessionID: ctx.sessionID })
        }

        return {
          title: `Taskflow started with ${params.plan?.length ?? 0} steps`,
          output: `Taskflow initialized with ${params.plan?.length ?? 0} steps. Update step/todo progress as work proceeds.`,
          metadata: { steps: params.plan?.length ?? 0, step_id: undefined, status: undefined },
        }
      }

      case "update": {
        if (params.todo_id !== undefined || params.todo_status !== undefined) {
          const todoIdx = params.todo_id ? parseInt(params.todo_id, 10) : 0
          if (!isNaN(todoIdx) && (params.todo_status === "completed" || params.todo_status === undefined)) {
            await Bus.publish(TuiEvent.ChainTodoDone, { todoIndex: todoIdx, sessionID: ctx.sessionID })
          }
        }

        if (params.status) {
          const mappedStatus = params.status === "completed" ? "complete" : params.status === "failed" ? "failed" : "running"
          if (params.step_id !== undefined) {
            const stepIdx = parseInt(params.step_id, 10)
            if (!isNaN(stepIdx)) {
              await Bus.publish(TuiEvent.ChainParallelUpdate, {
                stepIndex: stepIdx,
                status: mappedStatus as any,
                sessionID: ctx.sessionID,
              })
            }
          } else {
            await Bus.publish(TuiEvent.ChainUpdateStep, {
              status: mappedStatus as any,
              sessionID: ctx.sessionID,
            })
          }
        }

        return {
          title: `Taskflow updated`,
          output: `Updated step ${params.step_id ?? "current"} (status: ${params.status ?? "unchanged"}, todo: ${params.todo_status ?? "unchanged"})`,
          metadata: { steps: undefined, step_id: params.step_id ?? "", status: params.status ?? "" },
        }
      }

      case "complete": {
        await Bus.publish(TuiEvent.ChainCompleteStep, {
          output: params.output,
          sessionID: ctx.sessionID,
        })
        return {
          title: "Taskflow step completed ✓",
          output: params.output || "Taskflow step completed",
          metadata: { steps: undefined, step_id: undefined, status: "completed" },
        }
      }

      case "fail": {
        await Bus.publish(TuiEvent.ChainFailStep, {
          error: params.output || "Taskflow step failed",
          sessionID: ctx.sessionID,
        })
        return {
          title: "Taskflow step failed ✗",
          output: params.output || "Taskflow step failed",
          metadata: { steps: undefined, step_id: undefined, status: "failed" },
        }
      }

      case "clear": {
        await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
        return {
          title: "Taskflow cleared",
          output: "Taskflow cleared",
          metadata: { steps: undefined, step_id: undefined, status: "cleared" },
        }
      }
    }
  },
})
