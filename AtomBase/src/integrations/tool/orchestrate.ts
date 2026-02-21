import z from "zod"
import { Tool } from "./tool"
import { Log } from "@/util/util/log"
import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import { Agent } from "../agent/agent"
import { Identifier } from "@/core/id/id"
import { MessageV2 } from "@/core/session/message-v2"
import { Config } from "@/core/config/config"
import { PermissionNext } from "@/util/permission/next"
import { selectModel, inferCategory, type TaskCategory } from "./model-router"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"

const DESCRIPTION = `Multi-agent workflow orchestration tool for running complex multi-step tasks with parallel execution.

**HOW TO USE (2 steps):**
1. Call with action="plan" to validate your workflow
2. Call with action="execute" and the returned workflowId to run it

**WHEN TO USE:** When a user request can be broken into multiple subtasks. Examples:
- "Analyze code, write tests, and create docs" → 3 tasks, tests+docs depend on analysis
- "Refactor module A and B, then integrate" → 2 parallel tasks + 1 dependent task

**TASK CATEGORIES:** "coding" | "documentation" | "analysis" | "general"
When smart_model_routing is enabled, each task automatically gets the best model for its category.

**STEP 1 - Plan:**
\`\`\`json
{
  "action": "plan",
  "tasks": [
    { "id": "analyze", "prompt": "Analyze the codebase structure", "category": "analysis" },
    { "id": "tests", "prompt": "Write unit tests based on analysis", "category": "coding", "dependsOn": ["analyze"] },
    { "id": "docs", "prompt": "Write documentation based on analysis", "category": "documentation", "dependsOn": ["analyze"] }
  ]
}
\`\`\`
→ Returns workflowId. "analyze" runs first, then "tests" and "docs" run in parallel.

**STEP 2 - Execute:**
\`\`\`json
{ "action": "execute", "workflowId": "<returned-id>" }
\`\`\`
→ Starts tasks in the background and returns immediately. You will be notified when complete.
The notification will include a table with \`Session ID\`s. You MUST use these IDs if you need to abort/delete an agent.

**STEP 3 (optional) - Status:**
\`\`\`json
{ "action": "status", "workflowId": "<returned-id>" }
\`\`\`

**STEP 4 (optional) - Abort:**
\`\`\`json
{ "action": "abort", "sessionId": "<sub-agent-session-id>" }
\`\`\`
→ Or abort an entire workflow:
\`\`\`json
{ "action": "abort", "workflowId": "<returned-id>" }
\`\`\`\`\``

// ─── DAG Utilities ───────────────────────────────────────────

interface TaskNode {
  id: string
  prompt: string
  agent: string
  category: TaskCategory
  dependsOn: string[]
  model?: string // Optional: specific model (e.g. "atomcli/minimax-m2.5-free")
}

interface WorkflowState {
  id: string
  tasks: TaskNode[]
  results: Record<string, TaskResult>
  status: "planned" | "running" | "completed" | "failed"
  createdAt: number
}

interface TaskResult {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: string
  error?: string
  model?: { providerID: string; modelID: string }
  startedAt?: number
  completedAt?: number
  sessionId?: string // Child session ID for navigation
  retryCount?: number // Number of retries attempted
}

// In-memory workflow store (per session)
const WORKFLOWS: Map<string, WorkflowState> = new Map()

// Track agent-type to session-id mapping for session reuse across workflow runs
// Key: "parentSessionId:agentType:taskId" → sessionId
const AGENT_SESSION_MAP: Map<string, string> = new Map()

// Cleanup completed/failed workflows older than 1 hour to prevent memory leaks
const WORKFLOW_TTL_MS = 60 * 60 * 1000
function cleanupOldWorkflows() {
  const now = Date.now()
  for (const [id, wf] of WORKFLOWS.entries()) {
    if ((wf.status === "completed" || wf.status === "failed") && now - wf.createdAt > WORKFLOW_TTL_MS) {
      WORKFLOWS.delete(id)
    }
  }
}

// Default retry configuration
const DEFAULT_MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

/**
 * Topological sort of tasks. Returns ordered task IDs.
 * Throws if a cycle is detected.
 */
function topologicalSort(tasks: TaskNode[]): string[] {
  const graph = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const task of tasks) {
    graph.set(task.id, [])
    inDegree.set(task.id, 0)
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!graph.has(dep)) {
        throw new Error(`Task "${task.id}" depends on unknown task "${dep}"`)
      }
      graph.get(dep)!.push(task.id)
      inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1)
    }
  }

  // Kahn's algorithm
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)

    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== tasks.length) {
    const remaining = tasks.filter((t) => !sorted.includes(t.id)).map((t) => t.id)
    throw new Error(`Circular dependency detected among tasks: ${remaining.join(", ")}`)
  }

  return sorted
}

/**
 * Get tasks that are ready to run (all dependencies completed).
 */
function getReadyTasks(workflow: WorkflowState): TaskNode[] {
  return workflow.tasks.filter((task) => {
    const result = workflow.results[task.id]
    if (!result || result.status !== "pending") return false

    // All dependencies must be completed
    return task.dependsOn.every((depId) => {
      const depResult = workflow.results[depId]
      return depResult && depResult.status === "completed"
    })
  })
}

/**
 * Check if any dependency has failed — if so, skip this task.
 * IMPORTANT: Only skip if task HAS dependencies. Independent tasks should NEVER be skipped.
 */
function shouldSkipDueToFailedDependency(task: TaskNode, workflow: WorkflowState): boolean {
  // Independent tasks (no dependencies) should never be skipped
  if (task.dependsOn.length === 0) return false

  // Only skip if a direct dependency has failed or been skipped
  return task.dependsOn.some((depId) => {
    const depResult = workflow.results[depId]
    return depResult && (depResult.status === "failed" || depResult.status === "skipped")
  })
}

/**
 * Legacy function for backwards compatibility
 */
function hasFailedDependency(task: TaskNode, workflow: WorkflowState): boolean {
  return shouldSkipDueToFailedDependency(task, workflow)
}

// ─── Tool Definition ─────────────────────────────────────────

const TaskSchema = z.object({
  id: z.string().describe("Unique task identifier"),
  prompt: z.string().describe("The prompt/instruction for the agent"),
  agent: z.string().optional().describe("Agent type to use (defaults to 'coder')"),
  category: z
    .enum(["coding", "documentation", "analysis", "general"])
    .optional()
    .describe("Task category for smart model routing (auto-inferred from prompt if not specified)"),
  dependsOn: z.array(z.string()).optional().describe("IDs of tasks that must complete before this one"),
  model: z
    .string()
    .optional()
    .describe("Specific model to use (e.g. 'atomcli/minimax-m2.5-free'). If not specified, smart routing is used"),
})

export const OrchestrateTool = Tool.define("orchestrate", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["plan", "execute", "status", "abort"]).describe("Action to perform"),
    tasks: z.array(TaskSchema).optional().describe("Task list for 'plan' action"),
    workflowId: z.string().optional().describe("Workflow ID for 'execute', 'status', and 'abort' actions"),
    sessionId: z.string().optional().describe("Session ID to abort when action is 'abort'"),
  }),
  async execute(params, ctx): Promise<any> {
    const log = Log.create({ service: "tool.orchestrate", sessionID: ctx.sessionID })

    switch (params.action) {
      // ─── PLAN ────────────────────────────────────────────
      case "plan": {
        if (!params.tasks || params.tasks.length === 0) {
          return {
            title: "Error",
            output: "tasks array is required for plan action",
            metadata: { error: true },
          }
        }

        // Normalize tasks
        const tasks: TaskNode[] = params.tasks.map((t) => ({
          id: t.id,
          prompt: t.prompt,
          agent: t.agent || "coder",
          category: t.category || inferCategory(t.prompt),
          dependsOn: t.dependsOn || [],
          model: t.model, // Include specified model
        }))

        // Validate DAG
        let sortedOrder: string[]
        try {
          sortedOrder = topologicalSort(tasks)
        } catch (e) {
          return {
            title: "Invalid Workflow",
            output: (e as Error).message,
            metadata: { error: true },
          }
        }

        // Create workflow
        const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const workflow: WorkflowState = {
          id: workflowId,
          tasks,
          results: Object.fromEntries(tasks.map((t) => [t.id, { status: "pending" as const }])),
          status: "planned",
          createdAt: Date.now(),
        }
        WORKFLOWS.set(workflowId, workflow)

        // Publish Chain UI events for real-time progress tracking
        try {
          await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
          await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID })
          for (const task of tasks) {
            const deps = task.dependsOn.length > 0 ? ` (needs: ${task.dependsOn.join(", ")})` : ""
            await Bus.publish(TuiEvent.ChainAddStep, {
              name: `${task.id}`,
              description: `@${task.agent} [${task.category}]${deps}: ${task.prompt.slice(0, 80)}`,
              agentType: task.agent,
              dependsOn: task.dependsOn.length > 0 ? task.dependsOn : undefined,
              sessionID: ctx.sessionID,
            })
          }
          await Bus.publish(TuiEvent.ChainUpdateStep, { status: "pending", sessionID: ctx.sessionID })
        } catch { /* TUI may not be active */ }

        // Build execution layers (groups of parallelizable tasks)
        const layers: string[][] = []
        const placed = new Set<string>()
        for (const taskId of sortedOrder) {
          const task = tasks.find((t) => t.id === taskId)!
          // Find the layer: must be after all deps
          let layer = 0
          for (const dep of task.dependsOn) {
            const depLayer = layers.findIndex((l) => l.includes(dep))
            if (depLayer >= 0) layer = Math.max(layer, depLayer + 1)
          }
          while (layers.length <= layer) layers.push([])
          layers[layer].push(taskId)
          placed.add(taskId)
        }

        const config = await Config.get()
        const smartRouting = config.experimental?.smart_model_routing === true

        const parts: string[] = [
          `## Workflow Planned`,
          ``,
          `**ID:** \`${workflowId}\``,
          `**Tasks:** ${tasks.length}`,
          `**Smart Model Routing:** ${smartRouting ? "✅ Enabled" : "❌ Disabled"}`,
          ``,
          `### Execution Plan:`,
        ]

        for (let i = 0; i < layers.length; i++) {
          const parallel = layers[i].length > 1 ? " (parallel)" : ""
          parts.push(`\n**Layer ${i + 1}${parallel}:**`)
          for (const taskId of layers[i]) {
            const task = tasks.find((t) => t.id === taskId)!
            const deps = task.dependsOn.length > 0 ? ` ← [${task.dependsOn.join(", ")}]` : ""
            parts.push(`- \`${task.id}\` @${task.agent} [${task.category}]${deps}`)
          }
        }

        parts.push(`\n> Use \`orchestrate(action="execute", workflowId="${workflowId}")\` to run.`)

        log.info("workflow planned", {
          workflowId,
          taskCount: tasks.length,
          layerCount: layers.length,
        })

        return {
          title: `Workflow: ${tasks.length} tasks`,
          output: parts.join("\n"),
          metadata: {
            error: false,
            workflowId,
            taskCount: tasks.length,
            layers: layers.length,
            smartRouting,
          },
        }
      }

      // ─── EXECUTE ─────────────────────────────────────────
      case "execute": {
        if (!params.workflowId) {
          return {
            title: "Error",
            output: "workflowId is required for execute action",
            metadata: { error: true },
          }
        }

        const workflow = WORKFLOWS.get(params.workflowId)
        if (!workflow) {
          return {
            title: "Error",
            output: `Workflow "${params.workflowId}" not found`,
            metadata: { error: true },
          }
        }

        if (workflow.status === "running") {
          return {
            title: "Error",
            output: "Workflow is already running",
            metadata: { error: true },
          }
        }

        workflow.status = "running"
        // Track index of current task in Chain for parallel_update
        const taskIndexMap: Record<string, number> = {}
        workflow.tasks.forEach((t, i) => { taskIndexMap[t.id] = i })
        log.info("workflow executing", { workflowId: params.workflowId })

        const config = await Config.get()

        // Get the parent message model as fallback
        const parentMsg = await MessageV2.get({
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
        })
        if (parentMsg.info.role !== "assistant") {
          return { title: "Error", output: "Not assistant message", metadata: { error: true } }
        }
        const fallbackModel = {
          providerID: parentMsg.info.providerID,
          modelID: parentMsg.info.modelID,
        }

        // Get parent session permissions
        const parentSession = await Session.get(ctx.sessionID).catch(() => null)
        const parentPermissions = parentSession?.permission ?? []

        const completedTasks: string[] = []
        const failedTasks: string[] = []

        // Start execution in background
        const runWorkflow = async () => {
          try {
            // Execute in waves
            while (true) {
              // Mark tasks with failed deps as skipped
              // IMPORTANT: Only skip tasks that HAVE dependencies and whose dependencies failed
              for (const task of workflow.tasks) {
                const result = workflow.results[task.id]
                if (result.status === "pending" && shouldSkipDueToFailedDependency(task, workflow)) {
                  result.status = "skipped"
                  result.error = "Skipped due to failed dependency"
                  log.warn("task skipped due to failed dependency", { taskId: task.id })
                }
              }

              const ready = getReadyTasks(workflow)
              if (ready.length === 0) break

              // Run ready tasks in parallel
              const promises = ready.map(async (task) => {
                const result = workflow.results[task.id]
                result.status = "running"
                result.startedAt = Date.now()

                // Update Chain UI: mark this task as running
                const stepIdx = taskIndexMap[task.id]
                try {
                  await Bus.publish(TuiEvent.ChainParallelUpdate, { stepIndex: stepIdx, status: "running", sessionID: ctx.sessionID })
                } catch { /* TUI may not be active */ }

                // Select model: task'te belirtilen model veya SMART routing
                let model: { providerID: string; modelID: string }
                if (task.model) {
                  // Parse "provider/model" format
                  const [providerID, modelID] = task.model.split("/")
                  if (!providerID || !modelID) {
                    throw new Error(
                      `Invalid model format: ${task.model}. Use "provider/model" (e.g. "atomcli/minimax-m2.5-free")`,
                    )
                  }
                  model = { providerID, modelID }
                  log.info("using specified model", { taskId: task.id, model: task.model })
                } else {
                  model = await selectModel(task.category, fallbackModel)
                }
                result.model = model

                // Resolve agent
                const agent = await Agent.get(task.agent)
                if (!agent) throw new Error(`Unknown agent: ${task.agent}`)

                // Build context from completed dependency outputs
                const depContext = task.dependsOn
                  .map((depId) => {
                    const depResult = workflow.results[depId]
                    if (depResult?.output) {
                      return `<dependency_output task="${depId}">\n${depResult.output}\n</dependency_output>`
                    }
                    return ""
                  })
                  .filter(Boolean)
                  .join("\n\n")

                const fullPrompt = depContext ? `${depContext}\n\n${task.prompt}` : task.prompt

                // Subagent permissions
                const subPermissions: PermissionNext.Rule[] = [
                  { permission: "todowrite", pattern: "*", action: "deny" as const },
                  { permission: "todoread", pattern: "*", action: "deny" as const },
                  { permission: "task", pattern: "*", action: "deny" as const },
                ]
                const inheritedPermissions = PermissionNext.merge(parentPermissions, subPermissions)

                // Execute task with retry logic
                let taskSuccess = false
                let lastError: string | undefined

                for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES && !taskSuccess; attempt++) {
                  try {
                    // Try to reuse existing session for this agent type
                    const sessionKey = `${ctx.sessionID}:${task.agent}:${task.id}`
                    const existingSessionId = AGENT_SESSION_MAP.get(sessionKey)
                    let session: any

                    if (existingSessionId) {
                      // Reuse existing session
                      session = await Session.get(existingSessionId).catch(() => null)
                      if (session) {
                        // Notify TUI: reactivate existing agent
                        try {
                          await Bus.publish(TuiEvent.SubAgentReactivate, {
                            sessionId: session.id,
                            description: `[${task.category}] ${task.id}`,
                          })
                        } catch { /* TUI may not be available */ }
                      }
                    }

                    if (!session) {
                      // Create new child session
                      session = await Session.create({
                        parentID: ctx.sessionID,
                        title: `[${task.category}] ${task.id} (@${task.agent})`,
                        permission: inheritedPermissions,
                      })
                      // Store mapping for future reuse
                      AGENT_SESSION_MAP.set(sessionKey, session.id)

                      // Notify TUI: new sub-agent active
                      try {
                        await Bus.publish(TuiEvent.SubAgentActive, {
                          sessionId: session.id,
                          agentType: task.agent,
                          description: `[${task.category}] ${task.id}`,
                        })
                      } catch { /* TUI may not be available */ }
                    }

                    // Store session ID for UI navigation
                    result.sessionId = session.id

                    const messageID = Identifier.ascending("message")
                    const promptParts = await SessionPrompt.resolvePromptParts(fullPrompt)

                    const promptResult = await SessionPrompt.prompt({
                      messageID,
                      sessionID: session.id,
                      model: {
                        modelID: model.modelID,
                        providerID: model.providerID,
                      },
                      agent: agent.name,
                      tools: {
                        todowrite: false,
                        todoread: false,
                        task: false,
                      },
                      parts: promptParts,
                    })

                    const text = promptResult.parts.findLast((x) => x.type === "text")?.text ?? ""

                    result.status = "completed"
                    result.output = text
                    result.completedAt = Date.now()
                    result.retryCount = attempt
                    completedTasks.push(task.id)
                    taskSuccess = true

                    // Update Chain UI: mark step as complete
                    try {
                      await Bus.publish(TuiEvent.ChainParallelUpdate, { stepIndex: stepIdx, status: "complete", sessionID: ctx.sessionID })
                    } catch { /* TUI may not be active */ }

                    // Notify TUI: agent done (waiting state), pass output for context transfer
                    try {
                      await Bus.publish(TuiEvent.SubAgentDone, {
                        sessionId: session.id,
                        lastOutput: text.slice(0, 2000),
                      })
                    } catch { /* TUI may not be active */ }

                    log.info("task completed", {
                      taskId: task.id,
                      sessionId: session.id,
                      model: `${model.providerID}/${model.modelID}`,
                      duration: result.completedAt - (result.startedAt || 0),
                      attempts: attempt + 1,
                    })
                  } catch (e) {
                    lastError = (e as Error).message

                    if (attempt < DEFAULT_MAX_RETRIES) {
                      log.warn("task failed, retrying", {
                        taskId: task.id,
                        attempt: attempt + 1,
                        maxRetries: DEFAULT_MAX_RETRIES,
                        error: lastError,
                      })

                      // Exponential backoff
                      const delay = RETRY_DELAY_MS * Math.pow(2, attempt)
                      await new Promise((resolve) => setTimeout(resolve, delay))
                    }
                  }
                }

                if (!taskSuccess && lastError) {
                  result.status = "failed"
                  result.error = lastError
                  result.completedAt = Date.now()
                  failedTasks.push(task.id)

                  // Update Chain UI: mark step as failed
                  try {
                    await Bus.publish(TuiEvent.ChainParallelUpdate, { stepIndex: stepIdx, status: "failed", sessionID: ctx.sessionID })
                  } catch { /* TUI may not be active */ }

                  log.error("task failed after all retries", {
                    taskId: task.id,
                    maxRetries: DEFAULT_MAX_RETRIES,
                    error: lastError,
                  })
                }
              })

              // Wait for all tasks to complete
              await Promise.all(promises)
            }

            // Determine overall status
            workflow.status = failedTasks.length > 0 ? "failed" : "completed"

            // Clear Chain UI on finish
            try {
              await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID })
            } catch { /* TUI may not be active */ }

            // Cleanup old workflows to prevent memory leaks
            cleanupOldWorkflows()

            // Build summary
            const parts: string[] = [
              `## Workflow ${workflow.status === "completed" ? "✅ Completed" : "⚠️ Completed with Errors"}`,
              ``,
              `| Task | Status | Session ID | Model | Duration |`,
              `|:-----|:-------|:-----------|:------|:---------|`,
            ]

            for (const task of workflow.tasks) {
              const r = workflow.results[task.id]
              const statusEmoji = {
                pending: "⏳",
                running: "🔄",
                completed: "✅",
                failed: "❌",
                skipped: "⏭️",
              }[r.status]
              const modelStr = r.model ? `${r.model.providerID}/${r.model.modelID}` : "-"
              const duration = r.startedAt && r.completedAt ? `${((r.completedAt - r.startedAt) / 1000).toFixed(1)}s` : "-"
              const retryInfo = r.retryCount ? ` (${r.retryCount} retries)` : ""
              const sessionStr = r.sessionId || "-"
              parts.push(`| ${task.id} | ${statusEmoji} ${r.status}${retryInfo} | ${sessionStr} | ${modelStr} | ${duration} |`)
            }

            if (failedTasks.length > 0) {
              parts.push(`\n### Errors:`)
              for (const taskId of failedTasks) {
                const r = workflow.results[taskId]
                parts.push(`- **${taskId}:** ${r.error}`)
              }
            }

            // Include completed outputs
            for (const taskId of completedTasks) {
              const r = workflow.results[taskId]
              if (r.output) {
                parts.push(`\n### Output: ${taskId}`)
                // Truncate long outputs
                const truncated = r.output.length > 4000 ? r.output.slice(0, 4000) + "\n... (truncated)" : r.output
                parts.push(truncated)
              }
            }

            // Notify parent session with results
            const promptText = `<system_notification>\nBackground execution for workflow ${params.workflowId} completed.\nResults:\n${parts.join("\n")}\n</system_notification>\n\nPlease summarize these results to the user.`
            await SessionPrompt.prompt({
              sessionID: ctx.sessionID,
              parts: [{ type: "text", text: promptText }],
            }).catch((err) => {
              log.error("failed to send result prompt back to orchestrator", { error: err.message })
            })

          } catch (err) {
            log.error("workflow background execution failed", { error: (err as Error).message })
          }
        }

        // Detach execution
        setTimeout(runWorkflow, 0)

        // Return immediately
        return {
          title: "Workflow Started",
          output: `Workflow ${params.workflowId} has been started in the background. You will receive a system notification when it completes. \n\nYou can continue working on other things or answer user questions while waiting.`,
          metadata: {
            error: false,
            workflowId: params.workflowId,
            status: "running"
          },
        }
      }

      // ─── STATUS ──────────────────────────────────────────
      case "status": {
        if (!params.workflowId) {
          return {
            title: "Error",
            output: "workflowId is required for status action",
            metadata: { error: true },
          }
        }

        const workflow = WORKFLOWS.get(params.workflowId)
        if (!workflow) {
          return {
            title: "Error",
            output: `Workflow "${params.workflowId}" not found`,
            metadata: { error: true },
          }
        }

        const parts: string[] = [
          `## Workflow Status: ${workflow.status}`,
          ``,
          `| Task | Agent | Category | Status | Session ID | Model |`,
          `|:-----|:------|:---------|:-------|:-----------|:------|`,
        ]

        for (const task of workflow.tasks) {
          const r = workflow.results[task.id]
          const statusEmoji = {
            pending: "⏳",
            running: "🔄",
            completed: "✅",
            failed: "❌",
            skipped: "⏭️",
          }[r.status]
          const modelStr = r.model ? `${r.model.providerID}/${r.model.modelID}` : "-"
          const sessionStr = r.sessionId || "-"
          parts.push(`| ${task.id} | ${task.agent} | ${task.category} | ${statusEmoji} ${r.status} | ${sessionStr} | ${modelStr} |`)
        }

        return {
          title: `Status: ${workflow.status}`,
          output: parts.join("\n"),
          metadata: {
            error: false,
            workflowId: params.workflowId,
            status: workflow.status,
            tasks: Object.fromEntries(workflow.tasks.map((t) => [t.id, workflow.results[t.id].status])),
          },
        }
      }

      // ─── ABORT ───────────────────────────────────────────
      case "abort": {
        if (!params.sessionId && !params.workflowId) {
          return {
            title: "Error",
            output: "Either sessionId or workflowId is required for abort action",
            metadata: { error: true },
          }
        }

        let abortedCount = 0

        // Abort single session
        if (params.sessionId) {
          SessionPrompt.cancel(params.sessionId)
          try {
            await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: params.sessionId })
          } catch { /* ignore */ }
          abortedCount++
        }

        // Abort workflow and its tasks
        if (params.workflowId) {
          const workflow = WORKFLOWS.get(params.workflowId)
          if (workflow) {
            if (workflow.status === "running") {
              workflow.status = "failed"
            }
            // Always try to remove UI elements even if not running
            for (const task of workflow.tasks) {
              const r = workflow.results[task.id]
              if (r.status === "running") {
                r.status = "failed"
                r.error = "Aborted by orchestrator"
                if (r.sessionId) {
                  SessionPrompt.cancel(r.sessionId)
                  try {
                    await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: r.sessionId })
                  } catch { /* ignore */ }
                  abortedCount++
                }
              } else if (r.status === "pending") {
                r.status = "skipped"
              } else if (r.sessionId) {
                // Agent is already done/waiting, but we should remove it from the UI
                try {
                  await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: r.sessionId })
                } catch { /* ignore */ }
                abortedCount++
              }
            }
          }
        }

        return {
          title: "Abort Successful",
          output: `Aborted/Removed ${abortedCount} tasks/sessions from UI.`,
          metadata: { error: false, aborted: abortedCount },
        }
      }

      default:
        return {
          title: "Unknown Action",
          output: "Unknown action. Valid actions: plan, execute, status",
          metadata: { error: true },
        }
    }
  },
})

// Export internals for testing
export const _internals = {
  topologicalSort,
  getReadyTasks,
  hasFailedDependency,
  WORKFLOWS,
}
