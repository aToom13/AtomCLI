import type { Database } from "bun:sqlite"
import { AtomicPlan } from "../atomic-plan"
import type { LedgerTypes as Ledger } from "./types"

type Authority = { executionID: string; ownerID: string; fence: number }
type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  task(executionID: string, taskID: string): Ledger.Task | undefined
  tasks(executionID: string): Ledger.Task[]
  archive(task: Ledger.Task): void
  emit(executionID: string, now: number, properties: Record<string, unknown>): void
  owns(input: Authority & { now: number }): boolean
}

export namespace AtomicLedger {
  export function create(ctx: Context) {
    const { db, task, tasks } = ctx
    function assertOwner(input: Authority) {
      if (!ctx.owns({ ...input, now: Date.now() })) throw new Error("STALE_TASK: stale_fence")
    }
    function root(executionID: string) {
      return tasks(executionID).findLast((task) => task.atomic && !["accepted", "cancelled"].includes(task.status))
    }
    function definition(task: Ledger.Task) {
      return JSON.stringify({ execution: task.execution, atomic: task.atomic })
    }
    function write(value: Ledger.Task) {
      const serialized = JSON.stringify(value)
      if (Buffer.byteLength(serialized) > 100_000) throw new Error("Atomic Work task exceeds 100000 bytes")
      db.query(
        `INSERT OR REPLACE INTO execution_task
        (id, execution_id, parent_task_id, revision, goal, owner, agent, session_id, source, depends_on,
         acceptance, evidence, checks, status, supersedes, version, created_at, updated_at, submitted_at, verified_at, definition)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        value.id,
        value.executionID,
        value.parentTaskID ?? null,
        value.revision,
        value.goal,
        value.owner,
        value.agent,
        value.sessionID ?? null,
        "task",
        JSON.stringify(value.dependsOn),
        JSON.stringify(value.acceptance),
        JSON.stringify(value.evidence),
        JSON.stringify(value.checks ?? []),
        value.status,
        value.supersedes ?? null,
        value.version,
        value.createdAt,
        value.updatedAt,
        value.submittedAt ?? null,
        value.verifiedAt ?? null,
        definition(value),
      )
      ctx.emit(value.executionID, value.updatedAt, { task: value })
    }
    function pending(executionID: string) {
      return tasks(executionID).some((task) => task.atomic?.messages.some((message) => !message.classification))
    }
    function assertReady(input: Authority & { taskID: string; expectedVersion: number }) {
      assertOwner(input)
      const record = task(input.executionID, input.taskID)
      if (!record || record.version !== input.expectedVersion) throw new Error("STALE_TASK: stale_version")
      if (pending(input.executionID)) throw new Error("ATOMIC_PAUSED: pending user message")
      return record
    }
    return {
      atomicRoot: root,
      atomicPending: pending,
      assertAtomicReady: assertReady,
      setAtomicTaskSession(input: Authority & { taskID: string; expectedVersion: number; sessionID: string }) {
        return ctx.transaction(() => {
          const value = assertReady(input)
          if (value.sessionID === input.sessionID) return value
          ctx.archive(value)
          value.sessionID = input.sessionID
          value.version++
          value.updatedAt = Date.now()
          write(value)
          return value
        })
      },
      pauseAtomicTask(input: Authority & { taskID: string; expectedRevision: number; isolated: boolean }) {
        return ctx.transaction(() => {
          assertOwner(input)
          const value = task(input.executionID, input.taskID)
          if (!value || value.revision !== input.expectedRevision || value.status !== "running") return
          ctx.archive(value)
          value.status = input.isolated ? "needs_revision" : "blocked"
          if (input.isolated && value.execution) value.execution.attempts = Math.max(0, value.execution.attempts - 1)
          value.evidence.push(
            input.isolated
              ? "Atomic Work paused; unapplied isolated result discarded"
              : "ATOMIC_RECOVERY_REQUIRED: interrupted work without isolation",
          )
          value.version++
          value.updatedAt = Date.now()
          write(value)
          return value
        })
      },
      beginAtomicAttempt(input: Authority & { taskID: string; expectedVersion: number }) {
        return ctx.transaction(() => {
          const value = assertReady(input)
          if (value.status !== "running" || !value.execution) throw new Error("Atomic Work task is not running")
          if ((value.execution.attempts ?? 0) >= value.execution.maxRetries + 1)
            throw new Error("ATOMIC_RETRY_EXHAUSTED: revise task before retrying")
          ctx.archive(value)
          value.execution.attempts = (value.execution.attempts ?? 0) + 1
          value.version++
          value.updatedAt = Date.now()
          write(value)
          return value
        })
      },
      startAtomicWork(input: Authority & { messageID: string; goal: string; agent: string; sessionID: string }) {
        return ctx.transaction(() => {
          assertOwner(input)
          const active = root(input.executionID)
          if (active) return active
          const id = `atomic_${input.messageID}`
          const existing = task(input.executionID, id)
          if (existing) return existing
          const now = Date.now()
          const value: Ledger.Task = {
            id,
            executionID: input.executionID,
            revision: 1,
            goal: input.goal,
            owner: input.sessionID,
            agent: input.agent,
            sessionID: input.sessionID,
            dependsOn: [],
            acceptance: [],
            checks: [],
            evidence: [],
            status: "pending",
            version: 1,
            createdAt: now,
            updatedAt: now,
            atomic: { workflowID: id, planned: false, originalGoal: input.goal, messages: [] },
          }
          write(value)
          return value
        })
      },
      queueAtomicMessage(input: Authority & { messageID: string; text: string }) {
        return ctx.transaction(() => {
          assertOwner(input)
          const value = root(input.executionID)
          if (!value || value.atomic!.messages.some((message) => message.id === input.messageID)) return value
          ctx.archive(value)
          value.atomic!.messages.push({ id: input.messageID, text: input.text })
          value.version++
          value.updatedAt = Date.now()
          write(value)
          return value
        })
      },
      updateAtomicPlan(
        input: Authority & {
          rootID: string
          action?: "plan" | "revise"
          expectedVersion: number
          definitions?: AtomicPlan.Definition[]
          message?: { id: string; classification: "amendment" | "status" | "stop"; evidence: string }
        },
      ) {
        return ctx.transaction(() => {
          assertOwner(input)
          const current = task(input.executionID, input.rootID)
          if (!current?.atomic || current.version !== input.expectedVersion)
            throw new Error("STALE_TASK: stale_version")
          if (input.action === "plan" && (current.atomic.planned || input.message))
            throw new Error("Atomic Work initial plan cannot revise a plan or classify an amendment")
          if (input.action === "revise" && !current.atomic.planned && input.definitions?.length)
            throw new Error("Atomic Work has no plan to revise")
          const messages = structuredClone(current.atomic.messages)
          if (input.message) {
            const message = messages.find((message) => message.id === input.message!.id && !message.classification)
            if (!message) throw new Error("Unknown or already processed Atomic Work message")
            if (!input.message.evidence.trim()) throw new Error("Message classification requires evidence")
            Object.assign(message, input.message)
            if (input.message.classification === "amendment" && current.atomic.planned && !input.definitions?.length)
              throw new Error("Amendment requires changed task definitions")
            if (input.message.classification !== "amendment" && input.definitions?.length)
              throw new Error("Only amendments may change task definitions")
          } else if (messages.some((message) => !message.classification)) {
            throw new Error("ATOMIC_PAUSED: classify pending user messages before changing plan")
          }
          const changes = input.definitions ?? []
          if (new Set(changes.map((change) => change.id)).size !== changes.length)
            throw new Error("Duplicate Atomic Work task ID")
          const members = tasks(input.executionID).filter(
            (task) => task.id === current.id || task.parentTaskID === current.id,
          )
          if (current.atomic.planned) {
            const unknown = db
              .query(
                `SELECT 1 FROM execution_work WHERE state = 'unknown' AND execution_id IN (
              WITH RECURSIVE lineage(id) AS (SELECT ? UNION ALL SELECT resumes_execution_id FROM execution JOIN lineage ON execution.id = lineage.id WHERE resumes_execution_id IS NOT NULL) SELECT id FROM lineage
            ) LIMIT 1`,
              )
              .get(input.executionID)
            if (unknown && changes.length)
              throw new Error("Atomic Work recovery requires unknown work reconciliation before revision")
            for (const change of changes) {
              const old = members.find((task) => task.id === change.id)
              if (old && old.version !== change.expectedVersion)
                throw new Error(`STALE_TASK: stale_version ${change.id}`)
            }
          } else if ((changes.length || !input.message) && !changes.some((change) => change.id === current.id)) {
            throw new Error("Atomic Work plan requires integration root acceptance")
          }
          const merged = new Map(
            members
              .filter((task) => current.atomic!.planned)
              .map((task) => [
                task.id,
                {
                  id: task.id,
                  goal: task.goal,
                  agent: task.agent,
                  dependsOn: task.dependsOn,
                  acceptance: task.acceptance,
                  execution: task.execution!,
                },
              ]),
          )
          for (const change of changes) merged.set(change.id, change)
          const integration = merged.get(current.id)
          if (changes.length && integration)
            integration.dependsOn = [...merged.keys()].filter((id) => id !== current.id)
          const sorted = changes.length ? AtomicPlan.validate([...merged.values()]) : []
          if (
            sorted.some(
              (item) =>
                item.id !== current.id &&
                task(input.executionID, item.id)?.parentTaskID !== current.id &&
                task(input.executionID, item.id),
            )
          )
            throw new Error("Atomic Work task ID belongs to another plan")
          const affected = new Set(changes.map((change) => change.id))
          if (changes.length) affected.add(current.id)
          let added = true
          while (added) {
            added = false
            for (const item of sorted)
              if (!affected.has(item.id) && item.dependsOn.some((id) => affected.has(id))) {
                affected.add(item.id)
                added = true
              }
          }
          const now = Date.now()
          if (changes.length)
            db.query("UPDATE execution SET plan_revision = plan_revision + 1 WHERE id = ?").run(input.executionID)
          for (const item of sorted) {
            const old = members.find((task) => task.id === item.id)
            if (old && !affected.has(item.id)) continue
            if (old) ctx.archive(old)
            write({
              ...old,
              id: item.id,
              executionID: input.executionID,
              parentTaskID: item.id === current.id ? undefined : current.id,
              owner: current.owner,
              sessionID: item.id === current.id ? current.sessionID : old?.sessionID,
              goal: item.goal,
              agent: item.agent,
              dependsOn: item.dependsOn,
              acceptance: item.acceptance,
              execution: { ...item.execution, attempts: 0 },
              atomic:
                item.id === current.id
                  ? {
                      ...current.atomic,
                      originalGoal: current.atomic.originalGoal ?? current.goal,
                      planned: true,
                      messages,
                    }
                  : undefined,
              revision: old && current.atomic.planned ? old.revision + 1 : 1,
              version: (old?.version ?? 0) + 1,
              supersedes: old ? `${old.id}@${old.revision}` : undefined,
              status: old && current.atomic.planned ? "needs_revision" : "pending",
              checks: [],
              evidence: [...(old?.evidence ?? []), ...(input.message ? [input.message.evidence] : [])],
              submittedAt: undefined,
              verifiedAt: undefined,
              createdAt: old?.createdAt ?? now,
              updatedAt: now,
            })
          }
          if (!changes.length) {
            ctx.archive(current)
            const amendment =
              !current.atomic.planned && input.message?.classification === "amendment"
                ? messages.find((message) => message.id === input.message!.id)?.text
                : undefined
            write({
              ...current,
              goal: amendment ? `${current.goal}\nAmendment: ${amendment}` : current.goal,
              atomic: { ...current.atomic, originalGoal: current.atomic.originalGoal ?? current.goal, messages },
              version: current.version + 1,
              updatedAt: now,
            })
          }
          return task(input.executionID, current.id)!
        })
      },
    }
  }
}
