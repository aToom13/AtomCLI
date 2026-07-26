import z from "zod"
import { Tool } from "./tool"
import { TaskTool } from "./task"
import { OrchestrateTool } from "./orchestrate"

const parameters = z.object({
  action: z
    .enum(["spawn", "workflow", "abort", "status"])
    .default("spawn")
    .describe(
      "Action to perform: 'spawn' for a single subagent task, 'workflow' for a multi-task DAG, 'abort' to cancel, 'status' to check progress",
    ),

  // Parameters for action='spawn' (subagent task execution)
  subagent_type: z
    .string()
    .optional()
    .describe("The specialized agent type to use (e.g., 'explore', 'coder', 'checker') for action='spawn'"),
  prompt: z.string().optional().describe("The task prompt for the agent to perform (for action='spawn')"),
  description: z.string().optional().describe("A short (3-5 words) description of the task (for action='spawn')"),

  // Parameters for action='workflow' (multi-step DAG)
  workflow_action: z
    .enum(["plan", "execute", "status", "abort"])
    .optional()
    .describe("Sub-action for workflow: 'plan', 'execute', 'status', or 'abort'"),
  workflowId: z.string().optional().describe("Workflow ID returned from action='workflow' with workflow_action='plan'"),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        category: z.enum(["coding", "documentation", "analysis", "general"]).optional(),
        dependsOn: z.array(z.string()).optional(),
        agent: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .optional()
    .describe("Task list for action='workflow' plan"),

  session_id: z.string().optional().describe("Session ID to continue or abort"),
})

export const AgentTool = Tool.define("agent", async (ctx) => {
  const taskToolInstance = await TaskTool.init(ctx)
  const orchestrateToolInstance = await OrchestrateTool.init(ctx)

  const description = [
    "Unified Agent tool for launching background subagents or executing multi-step DAG workflows.",
    "",
    "ACTIONS:",
    "1. action='spawn': Run a single background subagent (specify subagent_type, prompt, description)",
    "2. action='workflow': Execute a multi-task DAG workflow with parallel execution (workflow_action='plan'|'execute')",
    "3. action='abort': Cancel a running subagent session or workflow (specify session_id or workflowId)",
    "4. action='status': Check workflow or subagent status (specify workflowId or session_id)",
  ].join("\n")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "workflow") {
        const wfAction = params.workflow_action || (params.tasks ? "plan" : "execute")
        return orchestrateToolInstance.execute(
          {
            action: wfAction as any,
            workflowId: params.workflowId,
            tasks: params.tasks as any,
          },
          ctx,
        )
      }

      if (params.action === "abort") {
        if (params.workflowId) {
          return orchestrateToolInstance.execute({ action: "abort", workflowId: params.workflowId }, ctx)
        }
        return taskToolInstance.execute({ action: "abort", session_id: params.session_id }, ctx)
      }

      if (params.action === "status") {
        if (params.workflowId) {
          return orchestrateToolInstance.execute({ action: "status", workflowId: params.workflowId }, ctx)
        }
        if (params.session_id) {
          return {
            title: "Task Status",
            output: `Session ${params.session_id} status requested. Check active task status via session manager.`,
            metadata: { sessionId: params.session_id },
          }
        }
        throw new Error("Parameter 'workflowId' or 'session_id' is required for action='status'")
      }

      // Default: action === "spawn" (single subagent task)
      return taskToolInstance.execute(
        {
          action: "run",
          subagent_type: params.subagent_type,
          prompt: params.prompt,
          description: params.description,
          session_id: params.session_id,
        },
        ctx,
      )
    },
  }
})
