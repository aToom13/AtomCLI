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

/**
 * Verdict produced by the blocking reviewer sub-agent for the MAIN agent's
 * edits. Persisted per session so re-reviews can be skipped when nothing
 * changed since the last PASS, and so FAIL attempts accumulate context
 * (prevents reset-shopping by the main agent).
 *
 * STATUS MEANING:
 *   - "pass"  — last review PASSED the file set recorded in `fileSet`.
 *   - "fail"  — last review REJECTED the file set; needsReview stays true
 *               until a review passes. Also used for invalidated verdicts
 *               (new edits landed) — attempts are reset to 0 so the reviewer
 *               can re-spawn.
 *   - "pending" — a review claim is IN PROGRESS (set by beginReview). This is
 *               the ONLY meaning of "pending". It is never produced by
 *               invalidation — doing so would wedge `taskflow clear` because
 *               beginReview refuses to re-claim a pending verdict.
 */
export interface ReviewVerdict {
  status: "pass" | "fail" | "pending"
  /** Reviewer's reason — for fail this is the list of issues to fix */
  reason?: string
  /** Edited file set that was reviewed (snapshot at review time) */
  fileSet: string[]
  /** Consecutive fail attempts so far (resets when the file set changes) */
  attempts: number
  /** Lifetime fail attempts across file-set changes — never resets, prevents reset-shopping */
  totalFailAttempts: number
  reviewedAt: number
  /** Previous verdict preserved while a review claim is pending — restored by releaseReview */
  prev?: ReviewVerdict
}

export interface SessionHarness {
  /** TaskFlow state machine */
  steps: TaskFlowStep[]
  /** Cadence and revision state for bounded taskflow prompt reminders. */
  taskflowReminder?: {
    lastToolCallCount?: number
    lastReminderAt: number
    lastReminderRevision: number
    statusRevision: number
    lastStatusUpdateAt: number
  }
  /** Files modified via edit/write tools in this session */
  editedFiles: Set<string>
  /** Ring buffer of last N bash executions */
  executionLogs: ExecutionLog[]
  /** Reviewer verdict for the main agent's edits, if a review ran */
  reviewVerdict?: ReviewVerdict
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EXECUTION_LOGS = 5
const MAX_LOG_BYTES = 10_000
const MAX_COMMAND_BYTES = 2_000
export const TASKFLOW_REMINDER_TOOL_INTERVAL = 5
export const TASKFLOW_REMINDER_INTERVAL_MS = 5 * 60 * 1_000

/** Hard cap on tracked edited files per session — prevents unbounded memory growth. */
export const MAX_EDITED_FILES_TRACKED = 1_000
/** Lifetime fail ceiling multiplier: max_attempts * this = total fails allowed before block. */
export const REVIEW_TOTAL_ATTEMPT_MULTIPLIER = 3

/** Files matching this pattern trigger an immediate critical-edit warning */
const CRITICAL_FILE_RE = /(auth|config|database|migration|\.env|secret|password|credential)/i

/**
 * Escape untrusted text for embedding inside XML-tagged prompt sections.
 * File paths and execution-log output are attacker-influenceable (repo/test
 * content can print fake closing tags), so escape before wrapping to prevent
 * prompt-injection via XML tag breakout.
 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

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

/** Compare two file lists ignoring order (used for verdict staleness). */
function sameFileSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((f, i) => f === sortedB[i])
}

// ─── TaskFlowStateMachine ─────────────────────────────────────────────────────

export namespace HarnessState {
  // ── TaskFlow ──────────────────────────────────────────────────────────────

  /**
   * Register a new plan, resetting any existing state for this session.
   */
  export function startPlan(sessionID: string, steps: { id: string; name: string }[]): void {
    const s = getSession(sessionID)
    const now = Date.now()
    s.steps = steps.map((step) => ({ ...step, status: "pending" as const }))
    s.taskflowReminder = {
      lastReminderAt: now,
      lastReminderRevision: 0,
      statusRevision: 0,
      lastStatusUpdateAt: now,
    }
    log.info("taskflow plan started", { sessionID, count: steps.length })
  }

  /**
   * Transition a specific step to a new status.
   * Throws a descriptive ToolError string on invalid transitions.
   */
  export function transitionStep(sessionID: string, stepId: string, to: "running" | "completed" | "failed"): void {
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

    recordPlanStatusUpdate(sessionID)
    log.info("taskflow step transition", { sessionID, stepId, from, to: step.status })
  }

  /** Record a taskflow status/todo update that is not represented by a step transition. */
  export function recordPlanStatusUpdate(sessionID: string): void {
    const s = getSession(sessionID)
    if (!s.taskflowReminder || s.steps.length === 0) return
    s.taskflowReminder.statusRevision++
    s.taskflowReminder.lastStatusUpdateAt = Date.now()
  }

  /**
   * Consume a due taskflow reminder. Tool cadence is based on distinct tool
   * parts in the current session transcript; wall-clock cadence is evaluated
   * on the next model turn and never wakes an idle session by itself.
   */
  export function consumeTaskflowReminder(input: { sessionID: string; toolCallCount: number; now?: number }):
    | {
        trigger: "tools" | "time" | "tools+time"
        toolCallsSinceLast: number
        statusUnchanged: boolean
        statusAgeMs: number
        steps: ReadonlyArray<TaskFlowStep>
      }
    | undefined {
    const s = getSession(input.sessionID)
    if (s.steps.length === 0 || !s.taskflowReminder) return undefined

    const now = input.now ?? Date.now()
    const reminder = s.taskflowReminder
    if (reminder.lastToolCallCount === undefined || input.toolCallCount < reminder.lastToolCallCount) {
      reminder.lastToolCallCount = input.toolCallCount
    }

    const toolCallsSinceLast = input.toolCallCount - reminder.lastToolCallCount
    const toolsDue = toolCallsSinceLast >= TASKFLOW_REMINDER_TOOL_INTERVAL
    const timeDue = now - reminder.lastReminderAt >= TASKFLOW_REMINDER_INTERVAL_MS
    if (!toolsDue && !timeDue) return undefined

    const statusUnchanged = reminder.statusRevision === reminder.lastReminderRevision
    const result = {
      trigger: toolsDue && timeDue ? ("tools+time" as const) : toolsDue ? ("tools" as const) : ("time" as const),
      toolCallsSinceLast,
      statusUnchanged,
      statusAgeMs: Math.max(0, now - reminder.lastStatusUpdateAt),
      steps: s.steps.map((step) => ({ ...step })),
    }
    reminder.lastToolCallCount = input.toolCallCount
    reminder.lastReminderAt = now
    reminder.lastReminderRevision = reminder.statusRevision
    return result
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
    s.taskflowReminder = undefined
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
    const s = getSession(sessionID)
    if (s.editedFiles.size >= MAX_EDITED_FILES_TRACKED && !s.editedFiles.has(filePath)) {
      log.warn("edited file tracking cap reached — ignoring new file", {
        sessionID,
        filePath,
        cap: MAX_EDITED_FILES_TRACKED,
      })
      return
    }
    s.editedFiles.add(filePath)
    // A new edit makes any previous PASS stale — force re-review.
    invalidateReviewVerdict(sessionID)
    log.info("file edit tracked", { sessionID, filePath, total: s.editedFiles.size })
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

  /**
   * Merge edited files from a child/descendant session into a target session's
   * tracker. Sub-agent edits are tracked under the sub-agent's OWN session ID
   * (processor.ts records edits with the session that ran the tool), so without
   * aggregation a main agent could bypass the review gate by delegating all
   * edits to sub-agents (task/orchestrate). Called by the review gate at clear
   * time so the gate reviews the union of parent + descendant edits.
   *
   * Returns the number of files newly added to the target.
   */
  export function mergeEditedFiles(targetSessionID: string, sourceSessionID: string): number {
    const source = getSession(sourceSessionID)
    if (source.editedFiles.size === 0) return 0
    const target = getSession(targetSessionID)
    let added = 0
    for (const f of source.editedFiles) {
      if (!target.editedFiles.has(f)) {
        if (target.editedFiles.size >= MAX_EDITED_FILES_TRACKED) break
        target.editedFiles.add(f)
        added++
      }
    }
    if (added > 0) {
      invalidateReviewVerdict(targetSessionID)
      log.info("merged edited files across sessions", { targetSessionID, sourceSessionID, added })
    }
    return added
  }

  // ── ReviewVerdictRegistry ────────────────────────────────────────────────
  //
  // Tracks the reviewer verdict for the MAIN agent's edits. The gate currently
  // runs on `taskflow clear` (review-gate.ts is the ONLY caller of needsReview).
  // A turn-end safety net in processor.ts is deferred to Phase 2 — do not rely
  // on this registry being consulted at turn end yet.
  //
  // A verdict is stale (and needsReview becomes true) whenever:
  //   - no verdict exists yet, or
  //   - the last verdict was a fail (retry), or
  //   - the edited file set changed since the last review.

  /**
   * Claim the right to run a review. Atomic guard against double-spawn:
   * the ai SDK executes multiple tool calls in one message in parallel, so
   * two concurrent `taskflow clear` calls could both see "no verdict" and
   * both spawn a reviewer. Because this function is synchronous, only the
   * first caller wins — subsequent callers get `false` and short-circuit.
   *
   * Returns true if this caller may proceed to spawn the reviewer.
   */
  export function beginReview(sessionID: string): boolean {
    const s = getSession(sessionID)
    if (s.reviewVerdict?.status === "pending") return false
    const prev = s.reviewVerdict
    s.reviewVerdict = {
      status: "pending",
      fileSet: getEditedFiles(sessionID),
      attempts: prev ? prev.attempts : 0,
      totalFailAttempts: prev ? prev.totalFailAttempts : 0,
      reviewedAt: Date.now(),
      prev,
    }
    return true
  }

  /**
   * Release a claimed review without recording a verdict. Used when the
   * reviewer could not run (infrastructure error) — the pending claim must be
   * cleared so the next `taskflow clear` can re-attempt the review instead of
   * being permanently wedged behind a stale `pending` verdict.
   */
  export function releaseReview(sessionID: string): void {
    const s = getSession(sessionID)
    if (s.reviewVerdict?.status !== "pending") return
    const prev = s.reviewVerdict.prev
    s.reviewVerdict = prev
    log.warn("review claim released without verdict", { sessionID })
  }

  /**
   * Record the reviewer's verdict for the reviewed edited file set.
   *
   * The verdict is recorded against the file set SNAPSHOT taken at
   * `beginReview` time (the set the reviewer actually saw), NOT the live set
   * at record time. If parallel edits land while the review runs, the verdict
   * covers the snapshot and `needsReview` sees the live set differs — forcing
   * a re-review instead of letting a PASS cover files the reviewer never saw.
   *
   * Fail attempts only accumulate while the reviewed file set is UNCHANGED
   * between attempts. If the agent fixes issues (changing the file set),
   * `invalidateReviewVerdict` resets attempts to 0, so a fresh review can
   * re-run — prevents permanent exhaustion deadlock on a stale file set.
   */
  export function recordReviewVerdict(sessionID: string, verdict: { status: "pass" | "fail"; reason?: string }): void {
    const s = getSession(sessionID)
    const prev = s.reviewVerdict
    // Record against the beginReview snapshot when a claim exists, otherwise
    // the current file set (direct calls in tests / simple flows).
    const fileSet = prev ? prev.fileSet : getEditedFiles(sessionID)
    s.reviewVerdict = {
      status: verdict.status,
      reason: verdict.reason,
      fileSet,
      attempts: verdict.status === "fail" ? (prev ? prev.attempts + 1 : 1) : 0,
      totalFailAttempts:
        verdict.status === "fail" ? (prev?.totalFailAttempts ?? 0) + 1 : (prev?.totalFailAttempts ?? 0),
      reviewedAt: Date.now(),
    }
    log.info("review verdict recorded", {
      sessionID,
      status: verdict.status,
      attempts: s.reviewVerdict.attempts,
      totalFailAttempts: s.reviewVerdict.totalFailAttempts,
    })
  }

  /** Current review verdict, if any review has run. */
  export function getReviewVerdict(sessionID: string): ReviewVerdict | undefined {
    return getSession(sessionID).reviewVerdict
  }

  /**
   * True if a blocking review must run before the main agent is allowed to
   * finish. False when: no files were edited, a PASS covers the current file
   * set, or no review is pending/required.
   */
  export function needsReview(sessionID: string): boolean {
    const files = getEditedFiles(sessionID)
    if (files.length === 0) return false
    const verdict = getSession(sessionID).reviewVerdict
    if (!verdict) return true
    if (verdict.status !== "pass") return true
    // PASS is stale if new edits landed after the review snapshot
    return !sameFileSet(verdict.fileSet, files)
  }

  /**
   * Invalidate a stored verdict when a new edit lands after the review.
   *
   * PASS → fail with attempts = 0 (re-review required). A FAIL is only
   * invalidated when the edited file set CHANGES — that proves the agent fixed
   * different content, so attempts reset and the reviewer can re-spawn (escape
   * from exhaustion). Editing a file already in the reviewed set keeps the FAIL
   * and its attempts.
   *
   * NOTE: invalidation NEVER sets status = "pending". `pending` is reserved for
   * an in-progress review claim (beginReview); beginReview refuses to re-claim
   * a pending verdict, so an invalidated verdict left as `pending` would
   * permanently wedge `taskflow clear`. `needsReview` already returns true for
   * both "fail" and a stale "pass" (file-set mismatch), so a "fail" with
   * attempts = 0 is a safe, re-claimable representation of "needs review".
   */
  export function invalidateReviewVerdict(sessionID: string): void {
    const s = getSession(sessionID)
    if (!s.reviewVerdict) return
    if (s.reviewVerdict.status === "pass") {
      s.reviewVerdict.status = "fail"
      s.reviewVerdict.attempts = 0
      s.reviewVerdict.reason = "Invalidated: new edits landed after last review"
      log.info("review verdict invalidated by new edit", { sessionID })
      return
    }
    if (s.reviewVerdict.status === "fail") {
      const fileSet = getEditedFiles(sessionID)
      if (!sameFileSet(s.reviewVerdict.fileSet, fileSet)) {
        s.reviewVerdict.attempts = 0
        s.reviewVerdict.reason = "Invalidated: edited file set changed after failed review"
        log.info("fail verdict invalidated by changed file set", { sessionID })
      }
    }
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
      entry.output.length > MAX_LOG_BYTES ? entry.output.slice(0, MAX_LOG_BYTES) + "\n\n[...truncated]" : entry.output
    const command =
      entry.command.length > MAX_COMMAND_BYTES
        ? entry.command.slice(0, MAX_COMMAND_BYTES) + "\n\n[...command truncated]"
        : entry.command

    s.executionLogs.push({ ...entry, command, output: truncated, timestamp: Date.now() })

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
          `    <cmd>${escapeXmlText(l.command)}</cmd>`,
          `    <output>${escapeXmlText(l.output.trim())}</output>`,
          `  </command_${i + 1}>`,
        ].join("\n")
      })
      .join("\n")

    return [`<harness_execution_logs count="${logs.length}">`, entries, `</harness_execution_logs>`].join("\n")
  }

  // ── Session reset ─────────────────────────────────────────

  /** Full reset of harness state for a session (e.g. on session close). */
  export function reset(sessionID: string): void {
    REVIEWER_SESSION_MAP.delete(sessionID)
    REVIEWER_SESSION_TS.delete(sessionID)
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
  const QA_SESSION_TS: Map<string, number> = new Map()
  const QA_SESSION_TTL_MS = 60 * 60 * 1000
  const MAX_QA_SESSIONS = 100

  function pruneQASessions(): void {
    const now = Date.now()
    for (const [key, ts] of QA_SESSION_TS) {
      if (now - ts > QA_SESSION_TTL_MS) {
        QA_SESSION_MAP.delete(key)
        QA_SESSION_TS.delete(key)
      }
    }
    while (QA_SESSION_MAP.size > MAX_QA_SESSIONS) {
      let oldest: string | undefined
      let oldestTs = Infinity
      for (const [key, ts] of QA_SESSION_TS) {
        if (ts < oldestTs) {
          oldestTs = ts
          oldest = key
        }
      }
      if (oldest === undefined) break
      QA_SESSION_MAP.delete(oldest)
      QA_SESSION_TS.delete(oldest)
    }
  }

  /**
   * Retrieve the persistent QA session ID for a task, if one exists.
   */
  export function getQASession(orchestratorSessionID: string, taskId: string): string | undefined {
    return QA_SESSION_MAP.get(`${orchestratorSessionID}:${taskId}`)
  }

  /**
   * Register a QA session ID for a task after first spawn. Bounded: entries
   * older than 1 hour are pruned on set; when the map exceeds the cap the
   * oldest entries (by timestamp) are evicted — mirrors the reviewer session
   * registry to prevent unbounded memory growth in long-lived servers.
   */
  export function setQASession(orchestratorSessionID: string, taskId: string, qaSessionId: string): void {
    pruneQASessions()
    const key = `${orchestratorSessionID}:${taskId}`
    QA_SESSION_MAP.set(key, qaSessionId)
    QA_SESSION_TS.set(key, Date.now())
    log.info("QA session registered", { orchestratorSessionID, taskId, qaSessionId })
  }

  /**
   * Clear QA session mapping for a task (e.g. on workflow cleanup).
   */
  export function clearQASession(orchestratorSessionID: string, taskId: string): void {
    const key = `${orchestratorSessionID}:${taskId}`
    QA_SESSION_MAP.delete(key)
    QA_SESSION_TS.delete(key)
  }

  /**
   * Clear all QA sessions for an orchestrator session (e.g. on workflow abort).
   */
  export function clearAllQASessions(orchestratorSessionID: string): void {
    const prefix = `${orchestratorSessionID}:`
    for (const key of QA_SESSION_MAP.keys()) {
      if (key.startsWith(prefix)) {
        QA_SESSION_MAP.delete(key)
        QA_SESSION_TS.delete(key)
      }
    }
  }

  // ── MainReviewerSessionRegistry ──────────────────────────
  //
  // One persistent reviewer session per MAIN agent session. The reviewer is
  // reused across all review attempts for a session so it accumulates context
  // of every previous FAIL verdict and cannot be "reset-shopped" by the main
  // agent (same rationale as QASessionRegistry, but for the main loop).
  //
  // Key: sessionID → reviewer session ID
  //
  // Bounded: entries older than 1 hour are pruned on set (mirrors
  // MAX_WORKFLOWS pattern in orchestrate.ts); when the map exceeds the cap the
  // oldest entries are evicted. This prevents unbounded memory growth in
  // long-lived server sessions.

  const REVIEWER_SESSION_MAP: Map<string, string> = new Map()
  const REVIEWER_SESSION_TS: Map<string, number> = new Map()
  const REVIEWER_SESSION_TTL_MS = 60 * 60 * 1000
  const MAX_REVIEWER_SESSIONS = 100

  function pruneReviewerSessions(): void {
    const now = Date.now()
    for (const [key, ts] of REVIEWER_SESSION_TS) {
      if (now - ts > REVIEWER_SESSION_TTL_MS) {
        REVIEWER_SESSION_MAP.delete(key)
        REVIEWER_SESSION_TS.delete(key)
      }
    }
    while (REVIEWER_SESSION_MAP.size > MAX_REVIEWER_SESSIONS) {
      // Evict by MIN timestamp, not insertion order — timestamps can diverge
      // from insertion order after resets/re-registrations.
      let oldest: string | undefined
      let oldestTs = Infinity
      for (const [key, ts] of REVIEWER_SESSION_TS) {
        if (ts < oldestTs) {
          oldestTs = ts
          oldest = key
        }
      }
      if (oldest === undefined) break
      REVIEWER_SESSION_MAP.delete(oldest)
      REVIEWER_SESSION_TS.delete(oldest)
    }
  }

  /**
   * Retrieve the persistent reviewer session ID for a main session.
   */
  export function getReviewerSession(sessionID: string): string | undefined {
    return REVIEWER_SESSION_MAP.get(sessionID)
  }

  /**
   * Register the reviewer session ID for a main session after first spawn.
   */
  export function setReviewerSession(sessionID: string, reviewerSessionId: string): void {
    pruneReviewerSessions()
    REVIEWER_SESSION_MAP.set(sessionID, reviewerSessionId)
    REVIEWER_SESSION_TS.set(sessionID, Date.now())
    log.info("main reviewer session registered", { sessionID, reviewerSessionId })
  }

  /**
   * Clear the reviewer session mapping for a main session (e.g. on reset).
   */
  export function clearReviewerSession(sessionID: string): void {
    REVIEWER_SESSION_MAP.delete(sessionID)
    REVIEWER_SESSION_TS.delete(sessionID)
  }
}
