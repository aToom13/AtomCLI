import z from "zod"
import { Tool } from "../tool"
import { Agent } from "../../agent/agent"
import { Config } from "@/core/config/config"
import { HarnessState } from "@/core/session/harness-state"
import { Bus } from "@/core/bus"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { TaskProfile } from "@/core/routing/task-profile"
import { SubAgentRuntime } from "../subagent-runtime"
import { OrchestrationGraph } from "@/core/orchestration/graph"
import { dependencyIds } from "./dependencies"
import { canonicalOwnership, normalizeOwnership, ownershipOverlaps } from "./ownership"
import { parseModelSpecifier, validateModel } from "./models"
import { checkpoint, reserveWorkflowSlot } from "./lifecycle"
import { WorkflowStateStore, MAX_TASK_OUTPUT_BYTES, type TaskNode, type WorkflowState } from "./state"
import { TaskSchema } from "./schema"
import { Lock } from "@/util/util/lock"
import { SubAgentIsolation } from "../subagent-isolation"
const DEFAULT_MAX_RETRIES = 2
const topologicalSort = (tasks: TaskNode[]) => OrchestrationGraph.topologicalSort(tasks)

type PlanParams = {
  tasks?: Array<z.output<typeof TaskSchema>>
}

type PlanContext = Pick<Tool.Context, "sessionID">

type PlanLogger = {
  info(message: string, data?: unknown): void
}

export async function planWorkflow(params: PlanParams, ctx: PlanContext, log: PlanLogger) {
  if (!params.tasks || params.tasks.length === 0) {
    return {
      title: "Error",
      output: "tasks array is required for plan action",
      metadata: { error: true },
    }
  }

  // Normalize tasks
  let tasks: TaskNode[]
  try {
    tasks = params.tasks.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      agent: t.agent || "coder",
      category: t.category || TaskProfile.infer(t.prompt).category,
      dependsOn: t.dependsOn || [],
      acceptance: t.acceptance || [],
      model: t.model,
      sessionId: t.sessionId,
      owns: (t.owns ?? []).map((claimed) => normalizeOwnership(claimed)),
      skills: t.skills ?? [],
      maxRetries: t.budget?.maxRetries ?? DEFAULT_MAX_RETRIES,
      maxOutputChars: t.budget?.maxOutputChars ?? MAX_TASK_OUTPUT_BYTES,
      outputSchema: t.outputSchema ? SubAgentRuntime.parseSchema(t.outputSchema) : undefined,
      validationMode: t.validationMode,
      isolation: t.isolation,
      executionTimeoutSeconds: t.executionTimeoutSeconds,
    }))
  } catch (error) {
    const detail =
      error instanceof SubAgentRuntime.OutputValidationError
        ? `${error.message}: ${error.detail.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`
        : error instanceof Error
          ? error.message
          : String(error)
    return {
      title: "Invalid Workflow",
      output: detail,
      metadata: { error: true },
    }
  }

  const duplicateTaskIDs = tasks.map((task) => task.id).filter((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicateTaskIDs.length > 0) {
    return {
      title: "Invalid Workflow",
      output: `Duplicate task ID: ${[...new Set(duplicateTaskIDs)].join(", ")}`,
      metadata: { error: true },
    }
  }

  const requiredIsolation = tasks.find((task) => task.isolation === "required")
  if (requiredIsolation && !(await SubAgentIsolation.available())) {
    return {
      title: "Invalid Workflow",
      output: `Task ${requiredIsolation.id} requires Git worktree isolation, but the active workspace is not a git worktree. Use isolation=auto only if shared-workspace ownership and permissions meet the user's requirements; required is never downgraded.`,
      metadata: { error: true },
    }
  }

  const availableAgents = new Set((await Agent.list()).map((agent) => agent.name))
  const unknownAgent = tasks.find((task) => !availableAgents.has(task.agent))
  if (unknownAgent) {
    return {
      title: "Invalid Workflow",
      output: `Unknown agent: ${unknownAgent.agent}`,
      metadata: { error: true },
    }
  }
  try {
    const resolved = tasks.map((task) => (task.owns ?? []).map((claimed) => canonicalOwnership(claimed)))
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i]
        const b = tasks[j]
        const ordered = dependencyIds(a, tasks).includes(b.id) || dependencyIds(b, tasks).includes(a.id)
        if (ordered) continue
        const overlap = (a.owns ?? []).find((left, ai) =>
          (b.owns ?? []).some(
            (right, bi) => ownershipOverlaps(left, right) || ownershipOverlaps(resolved[i][ai], resolved[j][bi]),
          ),
        )
        if (overlap !== undefined) {
          throw new Error(
            `Parallel tasks ${a.id} and ${b.id} claim overlapping ownership: ${overlap || "project root"}`,
          )
        }
      }
    }
    for (const task of tasks) {
      if (task.model) {
        const model = parseModelSpecifier(task.model)
        await validateModel(model)
      }
    }
  } catch (error) {
    return {
      title: "Invalid Workflow",
      output: (error as Error).message,
      metadata: { error: true },
    }
  }

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
  using _capacityLock = await Lock.write("workflow-capacity")
  if (!reserveWorkflowSlot()) {
    return {
      title: "Workflow capacity reached",
      output: "Finish or abort an active workflow before planning another one",
      metadata: { error: true },
    }
  }
  const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const workflow: WorkflowState = {
    id: workflowId,
    parentSessionID: ctx.sessionID,
    tasks,
    results: Object.fromEntries(tasks.map((t) => [t.id, { status: "pending" as const }])),
    status: "planned",
    createdAt: Date.now(),
    sessionMapKeys: [], // F24: populated during execution
    // A workflow must never replace a taskflow explicitly owned by the
    // parent agent. The sub-agent panel already exposes workflow agents.
    ownsTaskflowUI: !HarnessState.hasActivePlan(ctx.sessionID),
  }
  WorkflowStateStore.set(workflowId, workflow)
  await checkpoint(workflow)

  // Publish Chain UI events only when no parent-owned taskflow exists.
  // AgentTool uses this planner internally for single spawns; clearing
  // here used to erase the user's task list on every agent creation.
  if (workflow.ownsTaskflowUI) {
    try {
      await Bus.publish(TuiEvent.ChainClear, { sessionID: ctx.sessionID, workflowId })
      await Bus.publish(TuiEvent.ChainStart, { mode: "safe", sessionID: ctx.sessionID, workflowId })
      for (const task of tasks) {
        const deps = task.dependsOn.length > 0 ? ` (needs: ${task.dependsOn.join(", ")})` : ""
        await Bus.publish(TuiEvent.ChainAddStep, {
          stepId: task.id,
          workflowId,
          name: `${task.id}`,
          description: `@${task.agent} [${task.category}]${deps}: ${task.prompt.slice(0, 80)}`,
          agentType: task.agent,
          dependsOn: task.dependsOn.length > 0 ? task.dependsOn : undefined,
          sessionID: ctx.sessionID,
        })
      }
      await Bus.publish(TuiEvent.ChainUpdateStep, {
        status: "pending",
        sessionID: ctx.sessionID,
        workflowId,
      })
    } catch {
      /* TUI may not be active */
    }
  }

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
