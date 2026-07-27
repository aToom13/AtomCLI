/**
 * HarnessState — Centralized in-memory harness state for a session.
 *
 * Provides three services used across the harness:
 *   1. TaskFlowStateMachine  — enforces pending→running→completed/failed transitions
 *   2. EditedFilesTracker    — counts edited files and detects critical edits
 *   3. ExecutionLogs         — ring buffer of last N bash command outputs
 *
 * All state is per-session and per-project via Instance.state().
 */

import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "harness-state" })

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskFlowStatus = "pending" | "running" | "completed" | "failed"

export interface TaskFlowStep {
  id: string
  name: string
  status: TaskFlowStatus
}

export interface ExecutionLog {
  command: string
  /** Combined stdout + stderr, truncated to MAX_LOG_BYTES */
  output: string
  exitCode: number | null
  timestamp: number
}

export interface SessionHarness {
  /** TaskFlow state machine */
  steps: TaskFlowStep[]
  /** Files modified via edit/write tools in this session */
  editedFiles: Set<string>
  /** Ring buffer of last N bash executions */
  executionLogs: ExecutionLog[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EXECUTION_LOGS = 5
const MAX_LOG_BYTES = 10_000

/** Files matching this pattern trigger an immediate critical-edit warning */
const CRITICAL_FILE_RE = /(auth|config|database|migration|\.env|secret|password|credential)/i

// ─── State factory (per project instance) ────────────────────────────────────

const store = Instance.state(
  (): Map<string, SessionHarness> => new Map(),
  async () => {
    // No async cleanup needed — GC handles Maps
  },
)

function getSession(sessionID: string): SessionHarness {
  const map = store()
  let session = map.get(sessionID)
  if (!session) {
    session = { steps: [], editedFiles: new Set(), executionLogs: [] }
    map.set(sessionID, session)
  }
  return session
}

// ─── TaskFlowStateMachine ─────────────────────────────────────────────────────

export namespace HarnessState {
  // ── TaskFlow ──────────────────────────────────────────────────────────────

  /**
   * Register a new plan, resetting any existing state for this session.
   */
  export function startPlan(sessionID: string, steps: { id: string; name: string }[]): void {
    const s = getSession(sessionID)
    s.steps = steps.map((step) => ({ ...step, status: "pending" as const }))
    log.info("taskflow plan started", { sessionID, count: steps.length })
  }

  /**
   * Transition a specific step to a new status.
   * Throws a descriptive ToolError string on invalid transitions.
   */
  export function transitionStep(
    sessionID: string,
    stepId: string,
    to: "running" | "completed" | "failed",
  ): void {
    const s = getSession(sessionID)
    const step = s.steps.find((x) => x.id === stepId)

    if (!step) {
      // Step not tracked — may have been started without HarnessState.startPlan
      // Gracefully no-op to avoid breaking pre-existing taskflow usage
      return
    }

    const from = step.status

    if (to === "running") {
      if (from !== "pending") {
        throw new Error(
          `[HarnessState] Cannot set step "${stepId}" to running — current status is "${from}". ` +
            `Only pending steps can be set to running.`,
        )
      }
      // Enforce single running step at a time
      const alreadyRunning = s.steps.find((x) => x.status === "running")
      if (alreadyRunning && alreadyRunning.id !== stepId) {
        throw new Error(
          `[HarnessState] Cannot set step "${stepId}" to running — step "${alreadyRunning.id}" is already running. ` +
            `Complete or fail the current step first.`,
        )
      }
      step.status = "running"
    } else if (to === "completed" || to === "failed") {
      if (from !== "running") {
        throw new Error(
          `[HarnessState] Cannot ${to === "completed" ? "complete" : "fail"} step "${stepId}" — ` +
            `current status is "${from}". You must call taskflow update with status="running" for this step first.`,
        )
      }
      step.status = to
    }

    log.info("taskflow step transition", { sessionID, stepId, from, to: step.status })
  }

  /**
   * Clear the plan. Returns any warnings about unfinished steps.
   * Never throws — always clears (Option B: warn + force clear).
   */
  export function clearPlan(sessionID: string): { warnings: string[] } {
    const s = getSession(sessionID)
    const warnings: string[] = []

    const incomplete = s.steps.filter((x) => x.status === "pending" || x.status === "running")
    if (incomplete.length > 0) {
      const names = incomplete.map((x) => `"${x.name}" (${x.status})`).join(", ")
      warnings.push(
        `⚠️ taskflow clear called with ${incomplete.length} unfinished step(s): ${names}. ` +
          `Plan cleared anyway — ensure all steps were truly completed.`,
      )
    }

    s.steps = []
    log.info("taskflow plan cleared", { sessionID, hadWarnings: warnings.length > 0 })
    return { warnings }
  }

  /** True if there is at least one registered step (even if some are completed). */
  export function hasActivePlan(sessionID: string): boolean {
    const s = getSession(sessionID)
    return s.steps.length > 0
  }

  /** Returns the currently running step ID, if any. */
  export function getRunningStep(sessionID: string): string | undefined {
    return getSession(sessionID).steps.find((x) => x.status === "running")?.id
  }

  /** Raw copy of all steps (for introspection / system reminders). */
  export function getSteps(sessionID: string): ReadonlyArray<TaskFlowStep> {
    return getSession(sessionID).steps
  }

  // ── EditedFilesTracker ────────────────────────────────────────────────────

  /**
   * Record that a file was modified. Relative or absolute path — both accepted.
   */
  export function addEditedFile(sessionID: string, filePath: string): void {
    getSession(sessionID).editedFiles.add(filePath)
    log.info("file edit tracked", { sessionID, filePath, total: getSession(sessionID).editedFiles.size })
  }

  /** How many distinct files have been modified in this session. */
  export function getEditedFileCount(sessionID: string): number {
    return getSession(sessionID).editedFiles.size
  }

  /** True if any edited file matches the critical file regex. */
  export function hasCriticalEdit(sessionID: string): boolean {
    for (const f of getSession(sessionID).editedFiles) {
      if (CRITICAL_FILE_RE.test(f)) return true
    }
    return false
  }

  /** Returns a copy of all edited file paths. */
  export function getEditedFiles(sessionID: string): string[] {
    return Array.from(getSession(sessionID).editedFiles)
  }

  // ── ExecutionLogs ─────────────────────────────────────────────────────────

  /**
   * Push a bash execution result into the ring buffer.
   * Truncates output to MAX_LOG_BYTES to prevent memory bloat.
   */
  export function pushExecutionLog(
    sessionID: string,
    entry: { command: string; output: string; exitCode: number | null },
  ): void {
    const s = getSession(sessionID)
    const truncated =
      entry.output.length > MAX_LOG_BYTES
        ? entry.output.slice(0, MAX_LOG_BYTES) + "\n\n[...truncated]"
        : entry.output

    s.executionLogs.push({ ...entry, output: truncated, timestamp: Date.now() })

    // Enforce ring buffer size
    if (s.executionLogs.length > MAX_EXECUTION_LOGS) {
      s.executionLogs.shift()
    }
  }

  /**
   * Returns the last N execution logs for a session.
   * Returns a shallow copy — do not mutate.
   */
  export function getLastLogs(sessionID: string, n = MAX_EXECUTION_LOGS): ExecutionLog[] {
    const logs = getSession(sessionID).executionLogs
    return logs.slice(-n)
  }

  /**
   * Formats execution logs into an XML-tagged string suitable for prompt injection.
   */
  export function formatLogsForPrompt(sessionID: string): string {
    const logs = getLastLogs(sessionID)
    if (logs.length === 0) return ""

    const entries = logs
      .map((l, i) => {
        const exitInfo = l.exitCode !== null ? ` exit_code="${l.exitCode}"` : ""
        return [
          `  <command_${i + 1}${exitInfo}>`,
          `    <cmd>${l.command}</cmd>`,
          `    <output>${l.output.trim()}</output>`,
          `  </command_${i + 1}>`,
        ].join("\n")
      })
      .join("\n")

    return [`<harness_execution_logs count="${logs.length}">`, entries, `</harness_execution_logs>`].join("\n")
  }

  // ── Session reset ─────────────────────────────────────────

  /** Full reset of harness state for a session (e.g. on session close). */
  export function reset(sessionID: string): void {
    store().delete(sessionID)
  }

  // ── OrchestratorLock ──────────────────────────────────────
  //
  // Tracks whether the orchestrate execute tool is currently running for a
  // given session. Used by insertReminders() in prompt.ts to inject a
  // "BLOCKING ORCHESTRATION MODE" reminder so the main agent doesn't claim
  // it is doing parallel work while orchestrate is blocking.

  /**
   * Mark this session as being in blocking orchestration mode.
   * Call at the start of orchestrate(action="execute").
   */
  export function lockOrchestrator(sessionID: string, workflowId: string): void {
    const s = getSession(sessionID)
    ;(s as any)._orchestratorWorkflowId = workflowId
    log.info("orchestrator locked", { sessionID, workflowId })
  }

  /**
   * Clear the orchestration lock when execute finishes or errors.
   */
  export function unlockOrchestrator(sessionID: string): void {
    const s = getSession(sessionID)
    delete (s as any)._orchestratorWorkflowId
    log.info("orchestrator unlocked", { sessionID })
  }

  /**
   * Returns the active workflow ID if orchestrate execute is running,
   * or undefined if idle.
   */
  export function getActiveWorkflowId(sessionID: string): string | undefined {
    return (getSession(sessionID) as any)._orchestratorWorkflowId
  }

  // ── QASessionRegistry ─────────────────────────────────────
  //
  // One persistent QA reviewer session per (orchestratorSessionID, taskID).
  // Reviewer sessions are reused across retries so the reviewer accumulates
  // context of every previous FAIL verdict and cannot be "reset-shopped".
  //
  // Key: "parentSessionId:taskId" → QA reviewer session ID

  const QA_SESSION_MAP: Map<string, string> = new Map()

  /**
   * Retrieve the persistent QA session ID for a task, if one exists.
   */
  export function getQASession(orchestratorSessionID: string, taskId: string): string | undefined {
    return QA_SESSION_MAP.get(`${orchestratorSessionID}:${taskId}`)
  }

  /**
   * Register a QA session ID for a task after first spawn.
   */
  export function setQASession(orchestratorSessionID: string, taskId: string, qaSessionId: string): void {
    QA_SESSION_MAP.set(`${orchestratorSessionID}:${taskId}`, qaSessionId)
    log.info("QA session registered", { orchestratorSessionID, taskId, qaSessionId })
  }

  /**
   * Clear QA session mapping for a task (e.g. on workflow cleanup).
   */
  export function clearQASession(orchestratorSessionID: string, taskId: string): void {
    QA_SESSION_MAP.delete(`${orchestratorSessionID}:${taskId}`)
  }

  /**
   * Clear all QA sessions for an orchestrator session (e.g. on workflow abort).
   */
  export function clearAllQASessions(orchestratorSessionID: string): void {
    const prefix = `${orchestratorSessionID}:`
    for (const key of QA_SESSION_MAP.keys()) {
      if (key.startsWith(prefix)) QA_SESSION_MAP.delete(key)
    }
  }
}
