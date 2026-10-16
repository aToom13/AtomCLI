import type { ExecutionLedger } from "../ledger"
import { Lock } from "@/util/util/lock"

type Store = ReturnType<typeof ExecutionLedger.open>
type RuntimeContext = ExecutionLedger.Context

export function createTaskRuntimeModule(input: {
  context: (
    sessionID: string,
    execution?: RuntimeContext,
  ) => Promise<{ store: Store; executionContext: RuntimeContext } | undefined>
  BudgetExceededError: new (reason: string, executionID?: string) => Error
  publishTaskUpdated?: (event: {
    sessionID: string
    executionID: string
    taskID: string
    status: ExecutionLedger.TaskStatus
    revision: number
    version: number
  }) => void | Promise<unknown>
}) {
  async function publish(sessionID: string, executionID: string, task: ExecutionLedger.Task | undefined) {
    if (!task) return
    await input.publishTaskUpdated?.({
      sessionID,
      executionID,
      taskID: task.id,
      status: task.status,
      revision: task.revision,
      version: task.version,
    })
  }
  async function getTask(value: { sessionID: string; execution: RuntimeContext; taskID: string }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    return resolved.store.task(value.execution.executionID, value.taskID)
  }
  async function registerTask(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    parentTaskID?: string
    revision?: number
    goal: string
    owner: string
    agent: string
    skill?: string
    dependsOn?: string[]
    acceptance?: ExecutionLedger.TaskAcceptance[]
    supersedes?: string
    source?: "task" | "taskflow" | "orchestrate"
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const result = resolved.store.registerTask({
      id: value.taskID,
      executionID: value.execution.executionID,
      parentTaskID: value.parentTaskID,
      revision: value.revision,
      goal: value.goal,
      owner: value.owner,
      agent: value.agent,
      skill: value.skill,
      dependsOn: value.dependsOn,
      acceptance: value.acceptance,
      supersedes: value.supersedes,
      sessionID: value.sessionID,
      source: value.source,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
    })
    if (!result.registered) throw new input.BudgetExceededError(result.reason, value.execution.executionID)
    await publish(value.sessionID, value.execution.executionID, result.task)
    return result.task
  }

  async function transitionTask(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
    status: ExecutionLedger.TaskStatus
    evidence?: string
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const result = resolved.store.transitionTask({
      executionID: value.execution.executionID,
      taskID: value.taskID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      expectedVersion: value.expectedVersion,
      status: value.status,
      evidence: value.evidence,
    })
    if (!result.transitioned) throw new input.BudgetExceededError(result.reason, value.execution.executionID)
    await publish(value.sessionID, value.execution.executionID, result.task)
    return result.task
  }

  async function invalidateTaskDependents(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    evidence: string
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const count = resolved.store.invalidateDependents({
      executionID: value.execution.executionID,
      taskID: value.taskID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      evidence: value.evidence,
    })
    if (count)
      for (const task of resolved.store.tasks(value.execution.executionID))
        if (task.status === "needs_revision") await publish(value.sessionID, value.execution.executionID, task)
    return count
  }

  async function recordTaskChecks(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
    checks: ExecutionLedger.TaskCheckInput[]
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const result = resolved.store.recordTaskChecks({
      executionID: value.execution.executionID,
      taskID: value.taskID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      expectedVersion: value.expectedVersion,
      actorID: value.sessionID,
      checks: value.checks,
    })
    if (!result.recorded) throw new input.BudgetExceededError(result.reason, value.execution.executionID)
    await publish(value.sessionID, value.execution.executionID, result.task)
    return result.task
  }

  async function recordAutomaticTaskChecks(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
    checks: ExecutionLedger.AutomaticTaskCheckInput[]
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const result = resolved.store.recordAutomaticTaskChecks({
      executionID: value.execution.executionID,
      taskID: value.taskID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      expectedVersion: value.expectedVersion,
      checks: value.checks,
    })
    if (!result.recorded) throw new input.BudgetExceededError(result.reason, value.execution.executionID)
    await publish(value.sessionID, value.execution.executionID, result.task)
    return result.task
  }

  async function recordTaskVerification(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
    checks: ExecutionLedger.TaskCheckInput[]
    automaticChecks: ExecutionLedger.AutomaticTaskCheckInput[]
    reviewerID?: string
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.task(value.execution.executionID, value.taskID)
    const { HarnessState } = await import("@/core/session/harness-state")
    const changedFiles = HarnessState.getEditedFiles(value.sessionID)
    if (task && changedFiles.length) {
      const { TaskVerification } = await import("../task-verification")
      const { activeOwnershipRoot } = await import("@/integrations/tool/orchestrate/ownership")
      const cwd = activeOwnershipRoot()
      await TaskVerification.assertStaticChecks(changedFiles, cwd, value.sessionID)
    }
    const result = resolved.store.recordTaskVerification({
      executionID: value.execution.executionID,
      taskID: value.taskID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      expectedVersion: value.expectedVersion,
      actorID: value.sessionID,
      checks: value.checks,
      automaticChecks: value.automaticChecks,
      reviewerID: value.reviewerID,
    })
    if (!result.recorded) throw new input.BudgetExceededError(result.reason, value.execution.executionID)
    await publish(value.sessionID, value.execution.executionID, result.task)
    return result.task
  }

  async function invalidateOpenTasks(value: { sessionID: string; execution: RuntimeContext; evidence: string }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const count = resolved.store.invalidateOpenTasks({
      executionID: value.execution.executionID,
      ownerID: value.execution.ownerID,
      fence: value.execution.fence,
      evidence: value.evidence,
    })
    if (count)
      for (const task of resolved.store.tasks(value.execution.executionID))
        if (task.status === "needs_revision") await publish(value.sessionID, value.execution.executionID, task)
    return count
  }

  async function startAtomicWork(value: {
    sessionID: string
    execution: RuntimeContext
    messageID: string
    goal: string
    agent: string
  }) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.startAtomicWork({ ...value, ...value.execution })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  async function queueAtomicMessage(value: {
    sessionID: string
    execution: RuntimeContext
    messageID: string
    text: string
  }) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.queueAtomicMessage({ ...value, ...value.execution })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  async function updateAtomicPlan(
    value: Omit<Parameters<Store["updateAtomicPlan"]>[0], "ownerID" | "fence" | "executionID"> & {
      sessionID: string
      execution: RuntimeContext
    },
  ) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.updateAtomicPlan({ ...value, ...value.execution })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  async function assertAtomicReady(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
  }) {
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    return resolved.store.assertAtomicReady({ ...value, ...value.execution })
  }
  async function beginAtomicAttempt(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
  }) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.beginAtomicAttempt({ ...value, ...value.execution })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  async function pauseAtomicTask(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedRevision: number
    isolated: boolean
  }) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.pauseAtomicTask({ ...value, ...value.execution })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  async function setAtomicTaskSession(value: {
    sessionID: string
    execution: RuntimeContext
    taskID: string
    expectedVersion: number
    childSessionID: string
  }) {
    using _lock = await Lock.write(`execution-tasks:${value.execution.executionID}`)
    const resolved = await input.context(value.sessionID, value.execution)
    if (!resolved) throw new input.BudgetExceededError("not_active", value.execution.executionID)
    const task = resolved.store.setAtomicTaskSession({ ...value, ...value.execution, sessionID: value.childSessionID })
    await publish(value.sessionID, value.execution.executionID, task)
    return task
  }
  return {
    startAtomicWork,
    queueAtomicMessage,
    updateAtomicPlan,
    assertAtomicReady,
    beginAtomicAttempt,
    pauseAtomicTask,
    setAtomicTaskSession,
    getTask,
    registerTask,
    transitionTask,
    recordTaskChecks,
    recordAutomaticTaskChecks,
    recordTaskVerification,
    invalidateTaskDependents,
    invalidateOpenTasks,
  }
}
