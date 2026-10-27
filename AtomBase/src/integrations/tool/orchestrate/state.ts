import type { TaskCategory } from "../model-router"
import type { WorkflowBlackboard } from "@/core/orchestration/blackboard"
import type { SubAgentRuntime } from "../subagent-runtime"
import type { ExecutionLedger } from "@/core/execution/ledger"

export type TaskNode = {
  id: string
  prompt: string
  agent: string
  category: TaskCategory
  dependsOn: string[]
  acceptance?: ExecutionLedger.TaskAcceptance[]
  model?: string
  sessionId?: string
  owns?: string[]
  skills?: string[]
  maxRetries?: number
  maxOutputChars?: number
  outputSchema?: SubAgentRuntime.OutputSchema
  validationMode?: SubAgentRuntime.ValidationMode
  isolation?: "auto" | "required"
  executionTimeoutSeconds?: number
}

export type TaskResult = {
  status: "pending" | "running" | "unknown" | "completed" | "failed" | "skipped"
  ledgerState?: { status: ExecutionLedger.TaskStatus | "missing"; reason?: string }
  output?: string
  error?: string
  model?: { providerID: string; modelID: string }
  startedAt?: number
  completedAt?: number
  sessionId?: string
  invocationIDs?: string[]
  recovery?: { previousError?: string; evidence: string; recoveredAt: number }
  retryCount?: number
  artifacts?: WorkflowBlackboard.Artifact[]
  structuredOutput?: unknown
  structuredError?: SubAgentRuntime.StructuredError
  review?: { status: "passed" | "rejected" | "inconclusive"; summary: string }
  isolation?: {
    baseCommit: string
    resultTree: string
    changedFiles: string[]
    patchBytes: number
    applied: boolean
  }
}

export type WorkflowState = {
  id: string
  parentSessionID?: string
  tasks: TaskNode[]
  results: Record<string, TaskResult>
  status: "planned" | "running" | "resumable" | "completed" | "failed"
  createdAt: number
  sessionMapKeys: string[]
  atomicRootID?: string
  ownsTaskflowUI?: boolean
  error?: string
  activeExecution?: { executionID: string; blockerID: string }
}

const workflows = new Map<string, WorkflowState>()
const activeExecutions = new Map<string, symbol>()
export const MAX_WORKFLOWS = 100
export const MAX_TASKS = 50
export const MAX_PARALLEL_TASKS = 4
export const MAX_TASK_OUTPUT_BYTES = 100 * 1024
export const MAX_DEPENDENCY_CONTEXT_BYTES = 200 * 1024
export const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const agentSessions = new Map<string, string>()
const agentSessionOwners = new Map<string, string>()
export const WORKFLOW_TTL_MS = 60 * 60 * 1000

export const WorkflowStateStore = {
  get: (id: string) => {
    const workflow = workflows.get(id)
    return workflow ? structuredClone(workflow) : undefined
  },
  set: (id: string, workflow: WorkflowState) => workflows.set(id, structuredClone(workflow)),
  update(id: string, update: (workflow: WorkflowState) => void) {
    const workflow = workflows.get(id)
    if (!workflow) return undefined
    update(workflow)
    return structuredClone(workflow)
  },
  delete: (id: string) => workflows.delete(id),
  entries: () => Array.from(workflows, ([id, workflow]) => [id, structuredClone(workflow)] as const),
  keys: () => Array.from(workflows.keys()),
  get size() {
    return workflows.size
  },
}

export const WorkflowExecutionStore = {
  claim(id: string) {
    if (activeExecutions.has(id)) return undefined
    const token = Symbol(id)
    activeExecutions.set(id, token)
    return token
  },
  release(id: string, token: symbol) {
    if (activeExecutions.get(id) !== token) return false
    activeExecutions.delete(id)
    return true
  },
  has: (id: string) => activeExecutions.has(id),
}

export const AgentSessionStore = {
  get: (key: string) => agentSessions.get(key),
  set(key: string, sessionID: string, workflowID: string) {
    agentSessions.set(key, sessionID)
    agentSessionOwners.set(key, workflowID)
  },
  owner: (key: string) => agentSessionOwners.get(key),
  delete(key: string) {
    agentSessions.delete(key)
    agentSessionOwners.delete(key)
  },
}
