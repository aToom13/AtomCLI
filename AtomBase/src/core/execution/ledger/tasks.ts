import { AtomicLedger } from "./atomic"
import { Database } from "bun:sqlite"
import z from "zod"
import { LedgerTypes as ExecutionLedger } from "./types"

const MAX_TASK_TEXT_BYTES = 100_000
const MAX_TASKS_PER_EXECUTION = 1_000

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): { status: string; plan_revision: number } | undefined
  ownershipValid(current: { status: string }, ownerID: string | undefined, fence: number, now: number): boolean
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties?: Record<string, unknown>,
  ): void
}

function bounded(value: string | undefined, label: string) {
  if (value && new TextEncoder().encode(value).byteLength > MAX_TASK_TEXT_BYTES)
    throw new Error(`${label} exceeds ${MAX_TASK_TEXT_BYTES} bytes`)
  return value ?? null
}

function encode(value: unknown, label: string) {
  return bounded(JSON.stringify(value ?? []), label)!
}

function decode<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

const CheckSchema = z.object({
  criterionID: z.string().min(1).max(100),
  verifier: z.enum(["reviewer", "parent"]),
  passed: z.boolean(),
  evidence: z.string().min(1).max(10_000),
})

const AutomaticCheckSchema = z.object({
  criterionID: z.string().min(1).max(100),
  command: z.string().min(1).max(10_000),
  exitCode: z.number().int(),
  evidence: z.string().min(1).max(10_000),
})

export function createTaskModule(ctx: Context) {
  const { db, transaction } = ctx

  function task(executionID: string, taskID: string): ExecutionLedger.Task | undefined {
    const row = db
      .query<any, [string, string]>(
        `SELECT id, execution_id, parent_task_id, revision, goal, owner, agent, skill, session_id, source,
        depends_on, acceptance, evidence, checks, status, supersedes, version, created_at, updated_at,
        submitted_at, verified_at, definition FROM execution_task WHERE execution_id = ? AND id = ?`,
      )
      .get(executionID, taskID)
    if (!row) return
    const definition = row.definition ? JSON.parse(row.definition) : {}
    return {
      ...definition,
      id: row.id,
      executionID: row.execution_id,
      parentTaskID: row.parent_task_id ?? undefined,
      revision: row.revision,
      goal: row.goal,
      owner: row.owner,
      agent: row.agent,
      skill: row.skill ?? undefined,
      sessionID: row.session_id ?? undefined,
      source: row.source,
      dependsOn: decode<string[]>(row.depends_on, []),
      acceptance: decode<ExecutionLedger.TaskAcceptance[]>(row.acceptance, []),
      evidence: decode<string[]>(row.evidence, []),
      checks: decode<ExecutionLedger.TaskCheck[]>(row.checks, []),
      status: row.status,
      supersedes: row.supersedes ?? undefined,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
    }
  }

  function tasks(executionID: string) {
    return db
      .query<{ id: string }, [string]>("SELECT id FROM execution_task WHERE execution_id = ? ORDER BY created_at, id")
      .all(executionID)
      .map((row) => task(executionID, row.id)!)
  }

  function emit(executionID: string, now: number, properties: Record<string, unknown>) {
    db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, executionID)
    ctx.appendExecutionEvent(executionID, "execution.task.updated", now, properties)
  }

  function archive(value: ExecutionLedger.Task) {
    db.query(
      "INSERT OR IGNORE INTO execution_task_history (execution_id, task_id, version, snapshot) VALUES (?, ?, ?, ?)",
    ).run(value.executionID, value.id, value.version, encode(value, "Task snapshot"))
  }

  function owns(input: { executionID: string; ownerID: string; fence: number; now: number }) {
    const current = ctx.execution(input.executionID)
    return Boolean(
      current &&
        ["active", "finalizing"].includes(current.status) &&
        ctx.ownershipValid(current, input.ownerID, input.fence, input.now),
    )
  }

  function createsCycle(executionID: string, taskID: string, dependencies: string[]) {
    const pending = [...dependencies]
    const visited = new Set<string>()
    while (pending.length) {
      const current = pending.pop()!
      if (current === taskID) return true
      if (visited.has(current)) continue
      visited.add(current)
      pending.push(...(task(executionID, current)?.dependsOn ?? []))
    }
    return false
  }

  function storeChecks(input: {
    executionID: string
    taskID: string
    ownerID: string
    fence: number
    expectedVersion: number
    checks: ExecutionLedger.TaskCheck[]
    now?: number
  }) {
    return transaction(() => {
      const now = input.now ?? Date.now()
      if (!owns({ ...input, now })) return { recorded: false as const, reason: "stale_fence" as const }
      const record = task(input.executionID, input.taskID)
      if (!record) return { recorded: false as const, reason: "not_found" as const }
      if (record.version !== input.expectedVersion)
        return { recorded: false as const, reason: "stale_version" as const, task: record }
      if (!["submitted", "verifying"].includes(record.status))
        return { recorded: false as const, reason: "invalid_state" as const, task: record }
      const checks = input.checks.map((check) =>
        check.taskRevision === 0 ? { ...check, taskRevision: record.revision } : check,
      )
      if (new Set(checks.map((check) => check.criterionID)).size !== checks.length)
        throw new Error("Duplicate criterion check")
      if (
        checks.some(
          (check) =>
            record.acceptance.find((criterion) => criterion.id === check.criterionID)?.verification !== check.verifier,
        )
      )
        return { recorded: false as const, reason: "wrong_verifier" as const, task: record }
      if (checks.some((check) => check.taskRevision !== record.revision))
        return { recorded: false as const, reason: "stale_revision" as const, task: record }
      const atomicTask = Boolean(
        record.atomic || (record.parentTaskID && task(record.executionID, record.parentTaskID)?.atomic),
      )
      if (atomicTask && atomic.atomicPending(input.executionID))
        return { recorded: false as const, reason: "pending_amendment" as const, task: record }
      if (
        atomicTask &&
        (!record.acceptance.length || record.dependsOn.some((id) => task(input.executionID, id)?.status !== "accepted"))
      )
        return { recorded: false as const, reason: "acceptance_unverified" as const, task: record }
      if (atomicTask && checks.some((check) => check.verifier === "parent" && check.verifierID !== record.owner))
        return { recorded: false as const, reason: "parent_identity_required" as const, task: record }
      archive(record)
      const combined = atomicTask
        ? [
            ...(record.checks ?? []).filter(
              (old) =>
                old.taskRevision === record.revision && !checks.some((check) => check.criterionID === old.criterionID),
            ),
            ...checks,
          ]
        : checks
      const allPassed = record.acceptance.every((criterion) =>
        combined.some((check) => check.criterionID === criterion.id && check.passed),
      )
      const status: ExecutionLedger.TaskStatus = allPassed
        ? "accepted"
        : atomicTask && !combined.some((check) => !check.passed)
          ? "verifying"
          : "needs_revision"
      const evidence = checks.map((check) => `${check.criterionID}: ${check.evidence}`)
      db.query(
        `UPDATE execution_task SET status = ?, checks = ?, evidence = ?, version = version + 1, updated_at = ?, verified_at = ?
          WHERE execution_id = ? AND id = ? AND version = ?`,
      ).run(
        status,
        encode(combined, "Task checks"),
        encode([...record.evidence, ...evidence], "Task evidence"),
        now,
        allPassed ? now : null,
        input.executionID,
        input.taskID,
        input.expectedVersion,
      )
      const updated = task(input.executionID, input.taskID)!
      emit(input.executionID, now, { task: updated })
      return { recorded: true as const, task: updated }
    })
  }

  const atomic = AtomicLedger.create({ db, transaction, task, tasks, archive, emit, owns })
  return {
    ...atomic,
    task,
    tasks,
    taskHistory(executionID: string, taskID: string) {
      return db
        .query<{ snapshot: string }, [string, string]>(
          "SELECT snapshot FROM execution_task_history WHERE execution_id = ? AND task_id = ? ORDER BY version",
        )
        .all(executionID, taskID)
        .map((row) => JSON.parse(row.snapshot) as ExecutionLedger.Task)
    },
    unresolvedTasks(executionID: string) {
      return tasks(executionID).filter((item) => !["accepted", "cancelled"].includes(item.status))
    },
    hasUnresolvedTasks(executionID: string) {
      return (
        atomic.atomicPending(executionID) ||
        tasks(executionID).some((item) =>
          item.atomic || (item.parentTaskID && task(executionID, item.parentTaskID)?.atomic)
            ? item.status !== "accepted"
            : !["accepted", "cancelled"].includes(item.status),
        )
      )
    },
    registerTask(input: {
      id: string
      executionID: string
      parentTaskID?: string
      revision?: number
      goal: string
      owner: string
      agent: string
      skill?: string
      sessionID?: string
      source?: "task" | "taskflow" | "orchestrate"
      dependsOn?: string[]
      acceptance?: ExecutionLedger.TaskAcceptance[]
      supersedes?: string
      ownerID: string
      fence: number
      now?: number
    }) {
      return transaction(() => {
        const now = input.now ?? Date.now()
        if (!owns({ ...input, now })) return { registered: false as const, reason: "stale_fence" as const }
        if (!input.id || !input.goal || !input.owner || !input.agent)
          return { registered: false as const, reason: "invalid_task" as const }
        const dependencies = z
          .array(z.string().min(1).max(200))
          .max(100)
          .parse(input.dependsOn ?? [])
        const acceptance = z
          .array(ExecutionLedger.TaskAcceptance)
          .max(100)
          .parse(input.acceptance ?? [])
        if (dependencies.includes(input.id)) return { registered: false as const, reason: "self_dependency" as const }
        const existing = task(input.executionID, input.id)
        if (existing) {
          if (
            existing.goal !== input.goal ||
            existing.agent !== input.agent ||
            JSON.stringify(existing.dependsOn) !== JSON.stringify(dependencies)
          ) {
            return { registered: false as const, reason: "task_definition_conflict" as const, task: existing }
          }
          return { registered: true as const, idempotent: true as const, task: existing }
        }
        if (tasks(input.executionID).length >= MAX_TASKS_PER_EXECUTION)
          return { registered: false as const, reason: "task_limit" as const }
        for (const dependency of dependencies)
          if (!task(input.executionID, dependency))
            return { registered: false as const, reason: "unknown_dependency" as const, dependency }
        if (createsCycle(input.executionID, input.id, dependencies))
          return { registered: false as const, reason: "dependency_cycle" as const }
        db.query(
          `INSERT INTO execution_task
            (id, execution_id, parent_task_id, revision, goal, owner, agent, skill, session_id, source,
             depends_on, acceptance, evidence, checks, status, supersedes, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'pending', ?, 1, ?, ?)`,
        ).run(
          input.id,
          input.executionID,
          input.parentTaskID ?? null,
          input.revision ?? 1,
          bounded(input.goal, "Task goal"),
          input.owner,
          input.agent,
          input.skill ?? null,
          input.sessionID ?? null,
          input.source ?? "task",
          encode(dependencies, "Task dependencies"),
          encode(acceptance, "Task acceptance"),
          input.supersedes ?? null,
          now,
          now,
        )
        const created = task(input.executionID, input.id)!
        emit(input.executionID, now, { task: created })
        return { registered: true as const, idempotent: false as const, task: created }
      })
    },
    transitionTask(input: {
      executionID: string
      taskID: string
      ownerID: string
      fence: number
      expectedVersion: number
      status: ExecutionLedger.TaskStatus
      evidence?: string
      now?: number
    }) {
      return transaction(() => {
        const now = input.now ?? Date.now()
        if (!owns({ ...input, now })) return { transitioned: false as const, reason: "stale_fence" as const }
        const record = task(input.executionID, input.taskID)
        if (!record) return { transitioned: false as const, reason: "not_found" as const }
        if (record.version !== input.expectedVersion)
          return { transitioned: false as const, reason: "stale_version" as const, task: record }
        if (record.status === input.status)
          return { transitioned: true as const, idempotent: true as const, task: record }
        const isAtomic = Boolean(
          record.atomic || (record.parentTaskID && task(input.executionID, record.parentTaskID)?.atomic),
        )
        if (isAtomic && ["running", "submitted", "verifying", "accepted"].includes(input.status)) {
          if (atomic.atomicPending(input.executionID))
            return { transitioned: false as const, reason: "pending_amendment" as const }
          if (record.atomic && !record.atomic.planned)
            return { transitioned: false as const, reason: "plan_required" as const }
        }
        const allowed: Record<ExecutionLedger.TaskStatus, ExecutionLedger.TaskStatus[]> = {
          pending: ["running", "blocked", "failed", "cancelled"],
          running: ["submitted", "blocked", "failed", "cancelled", "needs_revision"],
          submitted: ["verifying", "needs_revision", "failed", "cancelled"],
          verifying: ["accepted", "needs_revision", "failed", "cancelled"],
          accepted: ["needs_revision"],
          needs_revision: ["running", "blocked", "failed", "cancelled"],
          blocked: ["running", "failed", "cancelled"],
          failed: ["running", "needs_revision", "cancelled"],
          cancelled: [],
        }
        if (!allowed[record.status].includes(input.status))
          return { transitioned: false as const, reason: "invalid_transition" as const, task: record }
        if (
          input.status === "running" &&
          record.dependsOn.some((id) => task(input.executionID, id)?.status !== "accepted")
        )
          return { transitioned: false as const, reason: "dependency_unaccepted" as const, task: record }
        if (
          ["submitted", "accepted", "needs_revision", "failed", "blocked", "cancelled"].includes(input.status) &&
          !input.evidence
        )
          return { transitioned: false as const, reason: "evidence_required" as const, task: record }
        if (
          input.status === "accepted" &&
          ((isAtomic &&
            (!record.acceptance.length ||
              record.dependsOn.some((id) => task(input.executionID, id)?.status !== "accepted"))) ||
            record.acceptance.some(
              (criterion) =>
                !record.checks.some(
                  (check) =>
                    check.criterionID === criterion.id &&
                    check.verifier === criterion.verification &&
                    check.taskRevision === record.revision &&
                    Boolean(check.verifierID) &&
                    check.passed,
                ),
            ))
        )
          return { transitioned: false as const, reason: "acceptance_unverified" as const, task: record }
        archive(record)
        const evidence = input.evidence ? [...record.evidence, input.evidence] : record.evidence
        db.query(
          `UPDATE execution_task SET status = ?, evidence = ?, version = version + 1, updated_at = ?,
          submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
          verified_at = CASE WHEN ? = 'accepted' THEN ? ELSE verified_at END
          WHERE execution_id = ? AND id = ? AND version = ?`,
        ).run(
          input.status,
          encode(evidence, "Task evidence"),
          now,
          input.status,
          now,
          input.status,
          now,
          input.executionID,
          input.taskID,
          input.expectedVersion,
        )
        const updated = task(input.executionID, input.taskID)!
        emit(input.executionID, now, { task: updated })
        return { transitioned: true as const, idempotent: false as const, task: updated }
      })
    },
    recordTaskChecks(input: {
      executionID: string
      taskID: string
      ownerID: string
      fence: number
      expectedVersion: number
      actorID?: string
      checks: ExecutionLedger.TaskCheckInput[]
      now?: number
    }) {
      const checks = z.array(CheckSchema).max(100).parse(input.checks)
      const record = task(input.executionID, input.taskID)
      if (
        (record?.atomic || (record?.parentTaskID && task(input.executionID, record.parentTaskID)?.atomic)) &&
        checks.some((check) => check.verifier === "reviewer")
      )
        return { recorded: false as const, reason: "reviewer_identity_required" as const, task: record }
      const now = input.now ?? Date.now()
      return storeChecks({
        ...input,
        now,
        checks: checks.map((check) => ({
          ...check,
          verifierID: input.actorID ?? "legacy",
          taskRevision: 0,
          verifiedAt: now,
        })),
      })
    },
    recordAutomaticTaskChecks(input: {
      executionID: string
      taskID: string
      ownerID: string
      fence: number
      expectedVersion: number
      checks: ExecutionLedger.AutomaticTaskCheckInput[]
      now?: number
    }) {
      const checks = z.array(AutomaticCheckSchema).max(100).parse(input.checks)
      const now = input.now ?? Date.now()
      const record = task(input.executionID, input.taskID)
      if (!record) return { recorded: false as const, reason: "not_found" as const }
      if (
        checks.some(
          (check) =>
            record.acceptance.find((criterion) => criterion.id === check.criterionID)?.command !== check.command,
        )
      )
        return { recorded: false as const, reason: "wrong_command" as const, task: record }
      return storeChecks({
        ...input,
        now,
        checks: checks.map((check) => ({
          criterionID: check.criterionID,
          verifier: "automatic" as const,
          verifierID: "harness",
          taskRevision: record.revision,
          verifiedAt: now,
          passed: check.exitCode === 0,
          evidence: `Command: ${check.command}\nExit code: ${check.exitCode}\n${check.evidence}`.trim(),
        })),
      })
    },
    recordTaskVerification(input: {
      executionID: string
      taskID: string
      ownerID: string
      fence: number
      expectedVersion: number
      actorID: string
      checks: ExecutionLedger.TaskCheckInput[]
      automaticChecks: ExecutionLedger.AutomaticTaskCheckInput[]
      reviewerID?: string
      now?: number
    }) {
      const manual = z.array(CheckSchema).max(100).parse(input.checks)
      const automatic = z.array(AutomaticCheckSchema).max(100).parse(input.automaticChecks)
      const record = task(input.executionID, input.taskID)
      if (!record) return { recorded: false as const, reason: "not_found" as const }
      if (
        automatic.some(
          (check) =>
            record.acceptance.find((criterion) => criterion.id === check.criterionID)?.command !== check.command,
        )
      )
        return { recorded: false as const, reason: "wrong_command" as const, task: record }
      const isAtomic = Boolean(
        record.atomic || (record.parentTaskID && task(input.executionID, record.parentTaskID)?.atomic),
      )
      if (isAtomic && manual.some((check) => check.verifier === "reviewer")) {
        const reviewer =
          input.reviewerID &&
          db
            .query("SELECT 1 FROM execution_invocation WHERE execution_id = ? AND session_id = ? AND kind = 'reviewer'")
            .get(input.executionID, input.reviewerID)
        if (!reviewer) return { recorded: false as const, reason: "reviewer_identity_required" as const, task: record }
      }
      const now = input.now ?? Date.now()
      return storeChecks({
        ...input,
        now,
        checks: [
          ...manual.map((check) => ({
            ...check,
            verifierID: check.verifier === "reviewer" ? (input.reviewerID ?? input.actorID) : input.actorID,
            taskRevision: 0,
            verifiedAt: now,
          })),
          ...automatic.map((check) => ({
            criterionID: check.criterionID,
            verifier: "automatic" as const,
            verifierID: "harness",
            taskRevision: record.revision,
            verifiedAt: now,
            passed: check.exitCode === 0,
            evidence: `Command: ${check.command}\nExit code: ${check.exitCode}\n${check.evidence}`.trim(),
          })),
        ],
      })
    },
    invalidateDependents(input: {
      executionID: string
      taskID: string
      ownerID: string
      fence: number
      evidence: string
      now?: number
    }) {
      return transaction(() => {
        const now = input.now ?? Date.now()
        if (!owns({ ...input, now })) throw new Error("Task change ownership is stale")
        const target = task(input.executionID, input.taskID)
        if (target?.atomic || (target?.parentTaskID && task(input.executionID, target.parentTaskID)?.atomic))
          throw new Error("Atomic Work revision requires expectedVersion and definition changes")
        const affected = new Set([input.taskID])
        let changed = true
        while (changed) {
          changed = false
          for (const candidate of tasks(input.executionID))
            if (candidate.dependsOn.some((dependency) => affected.has(dependency)) && !affected.has(candidate.id)) {
              affected.add(candidate.id)
              changed = true
            }
        }
        let count = 0
        for (const id of affected) {
          const candidate = task(input.executionID, id)
          if (!candidate || ["needs_revision", "cancelled"].includes(candidate.status)) continue
          archive(candidate)
          db.query(
            `UPDATE execution_task SET status = 'needs_revision', checks = '[]', revision = revision + 1,
            supersedes = id || '@' || revision, submitted_at = NULL, verified_at = NULL, evidence = ?, version = version + 1, updated_at = ?
            WHERE execution_id = ? AND id = ? AND version = ?`,
          ).run(
            encode([...candidate.evidence, input.evidence], "Task evidence"),
            now,
            input.executionID,
            id,
            candidate.version,
          )
          count++
        }
        if (count) emit(input.executionID, now, { invalidated: [...affected] })
        return count
      })
    },
    invalidateOpenTasks(input: {
      executionID: string
      ownerID: string
      fence: number
      evidence: string
      now?: number
    }) {
      const now = input.now ?? Date.now()
      if (!owns({ ...input, now })) throw new Error("Task change ownership is stale")
      let count = 0
      for (const candidate of tasks(input.executionID))
        if (!["pending", "needs_revision", "failed", "cancelled"].includes(candidate.status))
          count += this.invalidateDependents({ ...input, taskID: candidate.id, now })
      return count
    },
  }
}
