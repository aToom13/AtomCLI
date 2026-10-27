import { WorkflowStore } from "@/core/orchestration/workflow-store"
import type { ExecutionLedger } from "@/core/execution/ledger"
import type { ExecutionRuntime } from "@/core/execution/runtime"
import { Tool } from "../tool"
import { Lock } from "@/util/util/lock"
import {
  AgentSessionStore,
  WorkflowExecutionStore,
  MAX_WORKFLOWS,
  WORKFLOW_TTL_MS,
  WorkflowStateStore,
  type WorkflowState,
} from "./state"

export function claimWorkflowExecution(workflowID: string) {
  return WorkflowExecutionStore.claim(workflowID)
}

export function releaseWorkflowExecution(workflowID: string, token: symbol) {
  WorkflowExecutionStore.release(workflowID, token)
}

export function purgeSessionMapForWorkflow(workflow: WorkflowState): void {
  for (const key of workflow.sessionMapKeys) {
    if (AgentSessionStore.owner(key) !== workflow.id) continue
    AgentSessionStore.delete(key)
  }
}

export function cleanupOldWorkflows() {
  const now = Date.now()
  for (const [id, workflow] of WorkflowStateStore.entries()) {
    const stalePlanned = workflow.status === "planned" && now - workflow.createdAt > WORKFLOW_TTL_MS
    if (
      (workflow.status === "completed" || workflow.status === "failed") &&
      now - workflow.createdAt > WORKFLOW_TTL_MS
    ) {
      purgeSessionMapForWorkflow(workflow)
      WorkflowStateStore.delete(id)
    }
    if (stalePlanned) {
      // Expire only the in-memory slot. Keep the durable plan available by ID:
      // an old user-visible workflow can still be resumed, and cleanup must
      // never hide a failed storage deletion behind a fire-and-forget promise.
      WorkflowStateStore.delete(id)
    }
  }
  while (WorkflowStateStore.size > MAX_WORKFLOWS) {
    if (!evictTerminalWorkflow()) break
  }
}

function evictTerminalWorkflow() {
  const oldest = WorkflowStateStore.entries()
    .filter(([, workflow]) => workflow.status === "completed" || workflow.status === "failed")
    .sort(([, left], [, right]) => left.createdAt - right.createdAt)
    .at(0)
  if (!oldest) return false
  purgeSessionMapForWorkflow(oldest[1])
  WorkflowStateStore.delete(oldest[0])
  return true
}

export function reserveWorkflowSlot() {
  cleanupOldWorkflows()
  return WorkflowStateStore.size < MAX_WORKFLOWS || evictTerminalWorkflow()
}

const checkpointQueue = new Map<string, Promise<void>>()

const WORKFLOW_STATUSES = new Set(["planned", "running", "resumable", "completed", "failed"])
const TASK_STATUSES = new Set(["pending", "running", "unknown", "completed", "failed", "skipped"])

function assertWorkflowState(value: unknown, source: string): asserts value is WorkflowState {
  if (!value || typeof value !== "object") throw new Error(`Invalid workflow state in ${source}`)
  const workflow = value as Record<string, unknown>
  if (
    typeof workflow.id !== "string" ||
    !WORKFLOW_STATUSES.has(String(workflow.status)) ||
    typeof workflow.createdAt !== "number" ||
    !Number.isFinite(workflow.createdAt) ||
    !Array.isArray(workflow.tasks) ||
    !Array.isArray(workflow.sessionMapKeys) ||
    !workflow.sessionMapKeys.every((key) => typeof key === "string") ||
    !workflow.results ||
    typeof workflow.results !== "object" ||
    Array.isArray(workflow.results)
  ) {
    throw new Error(`Invalid workflow state in ${source}`)
  }
  const results = workflow.results as Record<string, unknown>
  for (const task of workflow.tasks) {
    const taskRecord = task && typeof task === "object" ? (task as unknown as Record<string, unknown>) : undefined
    const taskID = taskRecord?.id
    if (!taskRecord || typeof taskID !== "string" || !Array.isArray(taskRecord.dependsOn) || !results[taskID]) {
      throw new Error(`Invalid workflow task state in ${source}`)
    }
    const result = results[taskID] as Record<string, unknown>
    if (!result || typeof result !== "object" || !TASK_STATUSES.has(String(result.status))) {
      throw new Error(`Invalid workflow task result in ${source}`)
    }
  }
}

export function checkpoint(workflow: WorkflowState | string) {
  const id = typeof workflow === "string" ? workflow : workflow.id
  const previous = checkpointQueue.get(id) ?? Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(async () => {
      const latest = WorkflowStateStore.get(id) ?? (typeof workflow === "string" ? undefined : workflow)
      if (latest) await WorkflowStore.save(latest)
    })
  checkpointQueue.set(id, current)
  return current.finally(() => {
    if (checkpointQueue.get(id) === current) checkpointQueue.delete(id)
  })
}

export function markInterruptedTasksUnknown(workflow: WorkflowState) {
  let changed = false
  WorkflowStateStore.update(workflow.id, (current) => {
    for (const result of Object.values(current.results)) {
      if (result.status !== "running") continue
      result.status = "unknown"
      result.error = "Previous process stopped while this task was running; reconcile its outcome before retrying"
      changed = true
    }
    if (changed || current.status === "running") {
      current.status = "resumable"
      current.error = "Workflow has tasks with an unknown outcome and requires reconciliation"
    }
  })
  return changed
}

export async function findWorkflow(id: string) {
  const active = WorkflowStateStore.get(id)
  if (active) {
    assertWorkflowState(active, "memory")
    await reconcileDurableTaskProjection(active)
    return WorkflowStateStore.get(id)
  }
  using _capacityLock = await Lock.write("workflow-capacity")
  const stored = await WorkflowStore.load<WorkflowState>(id)
  if (!stored) return undefined
  assertWorkflowState(stored, "storage")
  if (!reserveWorkflowSlot()) throw new Error(`Workflow capacity reached (${MAX_WORKFLOWS} active workflows)`)
  WorkflowStateStore.set(id, stored)
  await reconcileDurableTaskProjection(stored)
  return WorkflowStateStore.get(id)
}

// Only ledger acceptance is a completed task; submitted output still needs verification.
export function durableTaskResult(task: ExecutionLedger.Task, executing = false) {
  return {
    ledgerState: {
      status: task.status,
      reason:
        task.status === "running" && !executing
          ? "No active workflow owner; recovery required"
          : task.status === "blocked" || task.status === "needs_revision"
            ? task.evidence.at(-1)
            : ["submitted", "verifying"].includes(task.status)
              ? "Waiting for criterion verification"
              : undefined,
    },
    status:
      task.status === "accepted"
        ? ("completed" as const)
        : task.status === "failed" ||
            task.status === "cancelled" ||
            (task.status === "needs_revision" &&
              (task.execution?.attempts ?? 0) >= (task.execution?.maxRetries ?? 2) + 1)
          ? ("failed" as const)
          : task.status === "running" && executing
            ? ("running" as const)
            : ["running", "blocked", "submitted", "verifying"].includes(task.status)
              ? ("unknown" as const)
              : ("pending" as const),
    output: task.evidence.join("\n"),
    error: ["submitted", "verifying"].includes(task.status)
      ? "Waiting for criterion verification"
      : ["failed", "cancelled"].includes(task.status)
        ? task.evidence.at(-1) || `Durable task ${task.status}`
        : undefined,
  }
}

export async function reconcileDurableTaskProjection(workflow: WorkflowState) {
  if (!workflow.activeExecution) return
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const tasks = ExecutionRuntime.tasks(workflow.activeExecution.executionID)
  let changed = false
  WorkflowStateStore.update(workflow.id, (current) => {
    for (const task of current.tasks) {
      const durable = tasks.find(
        (item) => item.id === (current.atomicRootID ? task.id : `workflow:${workflow.id}:${task.id}`),
      )
      const result = current.results[task.id]
      if (!durable) {
        if (result.ledgerState?.status !== "missing") {
          result.ledgerState = { status: "missing", reason: "No durable task record" }
          changed = true
        }
        if (result.status === "completed") {
          result.status = "unknown"
          result.error = "No durable acceptance evidence"
          changed = true
        }
        continue
      }
      const projected = durableTaskResult(durable, WorkflowExecutionStore.has(workflow.id))
      if (durable.status === "needs_revision" && projected.status === "pending") {
        if (
          result.status === "pending" &&
          Object.keys(result).length === 2 &&
          JSON.stringify(result.ledgerState) === JSON.stringify(projected.ledgerState)
        )
          continue
        current.results[task.id] = { status: "pending", ledgerState: projected.ledgerState }
        changed = true
        continue
      }
      if (
        result.status === projected.status &&
        result.error === projected.error &&
        JSON.stringify(result.ledgerState) === JSON.stringify(projected.ledgerState)
      )
        continue
      current.results[task.id] = {
        ...result,
        ...projected,
        output: result.output || projected.output,
      }
      changed = true
    }
    const results = Object.values(current.results)
    if (current.status !== "running" && results.every((result) => result.status === "completed")) {
      if (current.status !== "completed") changed = true
      current.status = "completed"
    } else if (current.status === "completed" && results.some((result) => result.status !== "completed")) {
      current.status = "resumable"
      changed = true
    }
  })
  if (changed) await checkpoint(workflow.id)
}

export async function refreshWorkflowRecovery(workflow: WorkflowState) {
  if (workflow.status !== "running" || WorkflowExecutionStore.has(workflow.id)) return false
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const blocker = workflow.activeExecution ? ExecutionRuntime.blocker(workflow.activeExecution.blockerID) : undefined
  const stale =
    !workflow.activeExecution || !ExecutionRuntime.executionLeaseActive(workflow.activeExecution.executionID)
  if (!stale && (!blocker || ["pending", "running", "resumable"].includes(blocker.state))) return false
  markInterruptedTasksUnknown(workflow)
  await checkpoint(workflow.id)
  return true
}

export type WorkflowBlockerHandle = {
  execution: ExecutionRuntime.Context
  id: string
  version: number
  state: string
}

export async function activateWorkflowBlocker(workflow: WorkflowState, ctx: Tool.Context) {
  const execution = ctx.extra?.execution as ExecutionRuntime.Context | undefined
  if (!execution) return undefined
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  let blocker = await ExecutionRuntime.registerBlocker({
    sessionID: ctx.sessionID,
    execution,
    blockerID: `workflow:${execution.executionID}:${workflow.id}`,
    kind: "workflow",
    producerID: workflow.id,
    resourceScope: `workflow:${workflow.id}`,
  })
  if (blocker.state !== "pending" && blocker.state !== "resumable") {
    throw new Error(`Workflow execution blocker is ${blocker.state}; reconciliation is required before dispatch`)
  }
  blocker = await ExecutionRuntime.transitionBlocker({
    sessionID: ctx.sessionID,
    execution,
    blockerID: blocker.id,
    expectedVersion: blocker.version,
    state: "running",
  })
  return { execution, id: blocker.id, version: blocker.version, state: blocker.state } satisfies WorkflowBlockerHandle
}

export async function settleWorkflowBlocker(
  handle: WorkflowBlockerHandle | undefined,
  ctx: Tool.Context,
  state: "resolved" | "failed" | "cancelled" | "unknown",
  evidence: string,
  resolutionCode: string,
) {
  if (!handle) return
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const blocker = await ExecutionRuntime.transitionBlocker({
    sessionID: ctx.sessionID,
    execution: handle.execution,
    blockerID: handle.id,
    expectedVersion: handle.version,
    state,
    evidence,
    resolutionCode,
  })
  handle.version = blocker.version
  handle.state = blocker.state
}

export async function resolveAcceptedTaskChildren(
  workflow: WorkflowState,
  taskID: string,
  ctx: Tool.Context,
  execution: ExecutionRuntime.Context,
) {
  const { ExecutionRuntime } = await import("@/core/execution/runtime")
  const task = await ExecutionRuntime.getTask({
    sessionID: ctx.sessionID,
    execution,
    taskID: `workflow:${workflow.id}:${taskID}`,
  })
  if (task?.status !== "accepted") throw new Error("Task acceptance is required before child reconciliation")
  const result = workflow.results[taskID]
  for (const blocker of ExecutionRuntime.snapshot(ctx.sessionID).blockers) {
    if (
      blocker.executionID !== execution.executionID ||
      blocker.kind !== "child" ||
      !["failed", "cancelled"].includes(blocker.state)
    )
      continue
    const invocation = ExecutionRuntime.invocation(blocker.invocationID)
    const belongs =
      result.invocationIDs?.includes(blocker.invocationID) ||
      (!result.invocationIDs?.length &&
        invocation?.sessionID === result.sessionId &&
        invocation.createdAt >= (result.startedAt ?? workflow.createdAt))
    if (!belongs) continue
    const previous = ExecutionRuntime.blocker(blocker.id)!
    await ExecutionRuntime.transitionBlocker({
      sessionID: ctx.sessionID,
      execution,
      blockerID: blocker.id,
      expectedVersion: blocker.version,
      state: "resolved",
      resolutionCode: "task_accepted_alternative",
      evidence: `${previous.evidence ?? blocker.state}; obligation satisfied by accepted task ${task.id}@${task.revision}`,
    })
  }
}
