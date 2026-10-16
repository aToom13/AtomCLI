import { Bus } from "@/core/bus"
import { HarnessState } from "@/core/session/harness-state"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { SubAgent } from "../subagent"
import { Session } from "@/core/session"
import { SessionReuse } from "../session-reuse"
import { WorkflowStateStore } from "./state"
import { checkpoint, findWorkflow } from "./lifecycle"

export async function statusWorkflow(workflowId: string | undefined, sessionID: string) {
  if (!workflowId)
    return { title: "Error", output: "workflowId is required for status action", metadata: { error: true } }
  let workflow: Awaited<ReturnType<typeof findWorkflow>>
  try {
    workflow = await findWorkflow(workflowId)
  } catch (error) {
    return {
      title: "Invalid Workflow",
      output: error instanceof Error ? error.message : String(error),
      metadata: { error: true },
    }
  }
  if (!workflow) return { title: "Error", output: `Workflow "${workflowId}" not found`, metadata: { error: true } }
  if (workflow.parentSessionID !== sessionID) {
    return {
      title: "Error",
      output: `Workflow "${workflowId}" does not belong to the current session`,
      metadata: { error: true },
    }
  }
  const parts = [
    `## Workflow Status: ${workflow.status}`,
    "",
    "| Task | Agent | Category | Status | Session ID | Model |",
    "|:-----|:------|:---------|:-------|:-----------|:------|",
  ]
  for (const task of workflow.tasks) {
    const result = workflow.results[task.id]
    const statusEmoji = {
      pending: "⏳",
      running: "🔄",
      unknown: "❓",
      completed: "✅",
      failed: "❌",
      skipped: "⏭️",
    }[result.status]
    const model = result.model ? `${result.model.providerID}/${result.model.modelID}` : "-"
    parts.push(
      `| ${task.id} | ${task.agent} | ${task.category} | ${statusEmoji} ${result.status} | ${result.sessionId || "-"} | ${model} |`,
    )
    if (result.error) parts.push(`Task ${task.id}: ${result.error}`)
    if (result.recovery)
      parts.push(
        `Task ${task.id} recovered; previous failure: ${result.recovery.previousError ?? "recorded in invocation history"}`,
      )
  }
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const durable = workflow.activeExecution ? ExecutionRuntime.tasks(workflow.activeExecution.executionID) : []
  const execution = workflow.activeExecution ? ExecutionRuntime.view(workflow.activeExecution.executionID) : undefined
  const invocations = workflow.tasks.flatMap((task) =>
    (workflow.results[task.id].invocationIDs ?? []).flatMap((id) => {
      const invocation = ExecutionRuntime.invocation(id)
      return invocation ? [{ taskID: task.id, ...invocation, blocker: ExecutionRuntime.blocker(`child:${id}`) }] : []
    }),
  )
  if (execution)
    parts.push(
      "",
      `Root execution: ${execution.id}; lifecycle=${execution.lifecycle}; phase=${execution.phase}; outcome=${execution.outcome ?? "not terminal"}; recoveryRequired=${execution.recoveryRequired}.`,
      `Durable tasks: ${durable.map((task) => `${task.id}=${task.status}`).join(", ")}`,
      `Child invocations: ${JSON.stringify(invocations)}`,
      "Report these observed results after required artifact/test checks. An expected child failure remains failed; do not recover, waive, or retry it merely to finish a negative test report. Unavailable forensic details may be reported as unverified. Internal storage discovery is unnecessary for this status report.",
    )
  const recoveryTasks = workflow.tasks
    .filter((task) => workflow.results[task.id].status === "failed")
    .map((task) => {
      const record = durable.find((item) => item.id === `workflow:${workflow.id}:${task.id}`)
      return {
        taskId: task.id,
        expectedVersion: record?.version,
        expectedRevision: record?.revision,
        owns: task.owns,
        acceptance: record?.acceptance,
        error: workflow.results[task.id].error,
      }
    })
  if (recoveryTasks.length)
    parts.push(
      "For an authorized recovery, verified alternative completion is available: agent(action='workflow', workflow_action='recover', workflowId, recovery={taskId, expectedVersion, expectedRevision, artifacts, verificationCommand}). A failed workflow can instead be reported with a terminal non-success root outcome.",
      JSON.stringify(recoveryTasks),
    )
  return {
    title: `Status: ${workflow.status}`,
    output: parts.join("\n"),
    metadata: {
      error: false,
      workflowId,
      status: workflow.status,
      tasks: Object.fromEntries(workflow.tasks.map((task) => [task.id, workflow.results[task.id].status])),
      recoveryTasks,
      execution,
      durableTasks: durable.map(({ id, status, version, revision, createdAt, updatedAt, submittedAt, verifiedAt }) => ({
        id,
        status,
        version,
        revision,
        createdAt,
        updatedAt,
        submittedAt,
        verifiedAt,
      })),
      invocations,
    },
  }
}

export async function abortWorkflow(input: { workflowId?: string; sessionId?: string }, sessionID: string) {
  if (!input.sessionId && !input.workflowId)
    return {
      title: "Error",
      output: "Either sessionId or workflowId is required for abort action",
      metadata: { error: true },
    }
  let workflow: Awaited<ReturnType<typeof findWorkflow>>
  try {
    workflow = input.workflowId ? await findWorkflow(input.workflowId) : undefined
  } catch (error) {
    return {
      title: "Invalid Workflow",
      output: error instanceof Error ? error.message : String(error),
      metadata: { error: true },
    }
  }
  if (input.workflowId) {
    if (!workflow)
      return { title: "Error", output: `Workflow "${input.workflowId}" not found`, metadata: { error: true } }
    if (workflow.parentSessionID !== sessionID)
      return {
        title: "Error",
        output: `Workflow "${input.workflowId}" does not belong to the current session`,
        metadata: { error: true },
      }
  }
  if (input.sessionId) {
    const child = await Session.get(input.sessionId).catch(() => undefined)
    if (!SessionReuse.isAllowed(child, sessionID))
      return {
        title: "Error",
        output: `Session "${input.sessionId}" is not a child of the current session`,
        metadata: { error: true },
      }
    if (workflow) {
      const workflowSessionIDs = new Set<string>()
      for (const task of workflow.tasks) {
        if (task.sessionId) workflowSessionIDs.add(task.sessionId)
        const result = workflow.results[task.id]
        if (result?.sessionId) workflowSessionIDs.add(result.sessionId)
        for (const qaSessionID of HarnessState.getQASessions(sessionID, task.id)) {
          workflowSessionIDs.add(qaSessionID)
        }
      }
      if (!workflowSessionIDs.has(input.sessionId)) {
        return {
          title: "Error",
          output: `Session "${input.sessionId}" is not part of workflow "${workflow.id}"`,
          metadata: { error: true },
        }
      }
    }
  }
  let abortedCount = 0
  const attempted = new Set<string>()
  const cancellationErrors = new Map<string, string>()
  const cancelSession = async (target: string) => {
    if (attempted.has(target)) return
    attempted.add(target)
    try {
      await SubAgent.cancel(target)
    } catch (error) {
      cancellationErrors.set(target, String(error instanceof Error ? error.message : error).slice(0, 2000))
      return
    }
    try {
      await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: target })
    } catch {}
    abortedCount++
  }
  if (input.sessionId) {
    await cancelSession(input.sessionId)
  }
  if (workflow) {
    if (["planned", "running", "resumable"].includes(workflow.status)) {
      const cancelSessions: Array<{ taskID: string; sessionID: string }> = []
      const removeSessions: string[] = []
      workflow =
        WorkflowStateStore.update(workflow.id, (current) => {
          current.status = "failed"
          current.error = "Aborted by orchestrator"
          for (const task of current.tasks) {
            const result = current.results[task.id]
            if (result.status === "running" || result.status === "unknown") {
              result.status = "failed"
              result.error = "Aborted by orchestrator"
              if (result.sessionId) cancelSessions.push({ taskID: task.id, sessionID: result.sessionId })
            } else if (result.status === "pending") result.status = "skipped"
            else if (result.sessionId) removeSessions.push(result.sessionId)
          }
        }) ?? workflow

      const failedTasks = new Set<string>()
      for (const { taskID, sessionID: runningSessionID } of cancelSessions) {
        await cancelSession(runningSessionID)
        if (cancellationErrors.has(runningSessionID)) failedTasks.add(taskID)
        for (const qaSessionId of HarnessState.getQASessions(sessionID, taskID)) {
          await cancelSession(qaSessionId)
          if (cancellationErrors.has(qaSessionId)) failedTasks.add(taskID)
        }
      }
      for (const sessionID of removeSessions) {
        try {
          await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: sessionID })
        } catch {}
        abortedCount++
      }

      if (failedTasks.size) {
        WorkflowStateStore.update(workflow.id, (current) => {
          current.status = "resumable"
          current.error = "Cancellation incomplete; retry abort to stop remaining sessions"
          for (const id of failedTasks) {
            current.results[id].status = "unknown"
            current.results[id].error = current.error
          }
        })
      }
      await checkpoint(workflow.id)
      if (!failedTasks.size && workflow.ownsTaskflowUI && !HarnessState.hasActivePlan(sessionID)) {
        try {
          await Bus.publish(TuiEvent.ChainClear, { sessionID, workflowId: workflow.id })
        } catch {}
      }
    }
  }
  if (cancellationErrors.size) {
    return {
      title: "Abort Incomplete",
      output: `Cancellation failed for ${cancellationErrors.size} sessions; retry abort.\n${[...cancellationErrors].map(([id, error]) => `${id}: ${error}`).join("\n")}`,
      metadata: { error: true, aborted: abortedCount },
    }
  }
  return {
    title: "Abort Successful",
    output: `Aborted/Removed ${abortedCount} tasks/sessions from UI.`,
    metadata: { error: false, aborted: abortedCount },
  }
}
