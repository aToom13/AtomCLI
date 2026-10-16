import { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"
import { ReviewPolicy } from "@/core/verification/review-policy"

const MAX_WORK_ITEMS_PER_EXECUTION = 10_000
const MAX_BLOCKERS_PER_EXECUTION = 1_000
const MAX_BLOCKER_EVIDENCE_BYTES = 16 * 1024
const REVIEW_VERIFICATION_TOOLS = new Set(["tool:bash", "tool:browser", "tool:lsp"])

type CurrentExecution = {
  id: string
  status: string
  fence: number
  deadline_at: number | null
  plan_revision: number
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  execution(executionID: string): CurrentExecution | undefined
  invocation(invocationID: string): ExecutionLedger.Invocation | undefined
  blocker(blockerID: string): ExecutionLedger.Blocker | undefined
  invocationReviewAuthorized(executionID: string, invocationID: string): boolean
  ownershipValid(current: CurrentExecution, ownerID: string | undefined, fence: number, now: number): boolean
  blockerTransitionAllowed(from: ExecutionLedger.BlockerState, to: ExecutionLedger.BlockerState): boolean
  appendExecutionEvent(
    executionID: string,
    type: ExecutionLedger.EventType,
    now: number,
    properties: Record<string, unknown>,
  ): void
}

export function createWorkModule(ctx: Context) {
  const { db, transaction } = ctx

  return {
    reviewerToolCalls(executionID: string, invocationID: string) {
      return (
        db
          .query<
            { count: number },
            [string, string]
          >("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ? AND invocation_id = ?")
          .get(executionID, invocationID)?.count ?? 0
      )
    },
    blockers(executionID: string) {
      const ids = db
        .query<
          { id: string },
          [string]
        >("SELECT id FROM execution_blocker WHERE execution_id = ? ORDER BY created_at, id")
        .all(executionID)
      return ids.map((row) => ctx.blocker(row.id)!)
    },

    taskflowPlan(executionID: string, sessionID: string) {
      const cleared =
        db
          .query<
            { revision: number },
            [string, string]
          >("SELECT revision FROM execution_taskflow_closed WHERE execution_id = ? AND session_id = ?")
          .get(executionID, sessionID)?.revision ?? 0
      return this.blockers(executionID).filter(
        (item) =>
          item.kind === "plan_item" &&
          (item.planRevision ?? 0) > cleared &&
          ctx.invocation(item.invocationID)?.sessionID === sessionID,
      )
    },

    closeTaskflow(input: { executionID: string; sessionID: string; ownerID: string; fence: number }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !ctx.ownershipValid(current, input.ownerID, input.fence, Date.now())) {
          throw new Error("Taskflow ownership is stale")
        }
        const items = this.taskflowPlan(input.executionID, input.sessionID)
        if (items.some((item) => !["resolved", "waived", "cancelled"].includes(item.state))) {
          throw new Error("Cannot close unresolved durable taskflow items")
        }
        db.query(
          `INSERT INTO execution_taskflow_closed (execution_id, session_id, revision) VALUES (?, ?, ?)
          ON CONFLICT(execution_id, session_id) DO UPDATE SET revision = excluded.revision`,
        ).run(input.executionID, input.sessionID, current.plan_revision)
      })
    },

    createPlan(input: {
      executionID: string
      invocationID: string
      ownerID: string
      fence: number
      items: Array<{ id: string; resourceScope: string }>
      now?: number
    }) {
      if (new Set(input.items.map((item) => item.id)).size !== input.items.length) {
        return { created: false as const, reason: "duplicate_plan_item" as const }
      }
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || current.status !== "active") {
          return { created: false as const, reason: "not_active" as const }
        }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { created: false as const, reason: "stale_fence" as const }
        }
        if (current.deadline_at !== null && now >= current.deadline_at) {
          return { created: false as const, reason: "deadline" as const }
        }
        const producerInvocation = ctx.invocation(input.invocationID)
        if (
          !producerInvocation ||
          producerInvocation.executionID !== input.executionID ||
          !["accepted", "running", "waiting"].includes(producerInvocation.state)
        ) {
          return { created: false as const, reason: "invalid_invocation" as const }
        }
        if (input.items.length === 0) {
          return {
            created: true as const,
            idempotent: true,
            revision: current.plan_revision,
            blockers: [] as ExecutionLedger.Blocker[],
          }
        }

        const revision = current.plan_revision + 1
        for (const [index, item] of input.items.entries()) {
          const id = `plan:${input.executionID}:${revision}:${index}`
          db.query(
            `INSERT INTO execution_blocker
              (id, execution_id, invocation_id, kind, producer_id, resource_scope, state, version,
               owner_id, fence, plan_revision, created_at, updated_at)
             VALUES (?, ?, ?, 'plan_item', ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            input.executionID,
            input.invocationID,
            `${revision}:${item.id}`,
            item.resourceScope,
            input.ownerID,
            input.fence,
            revision,
            now,
            now,
          )
        }
        db.query("UPDATE execution SET plan_revision = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
          revision,
          now,
          input.executionID,
        )
        const blockers = input.items.map((_, index) => ctx.blocker(`plan:${input.executionID}:${revision}:${index}`)!)
        ctx.appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blockers })
        return { created: true as const, idempotent: false, revision, blockers }
      })
    },

    registerBlocker(input: {
      id: string
      executionID: string
      invocationID: string
      parentBlockerID?: string
      kind: ExecutionLedger.BlockerKind
      producerID: string
      resourceScope: string
      ownerID: string
      fence: number
      planRevision?: number
      now?: number
    }) {
      return transaction(() => {
        const existing = ctx.blocker(input.id)
        if (existing) {
          if (
            existing.executionID !== input.executionID ||
            existing.kind !== input.kind ||
            existing.producerID !== input.producerID
          ) {
            throw new Error("blocker ID belongs to another producer")
          }
          return { registered: true as const, idempotent: true, blocker: existing }
        }
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { registered: false as const, reason: "not_active" as const }
        }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { registered: false as const, reason: "stale_fence" as const }
        }
        if (current.deadline_at !== null && now >= current.deadline_at) {
          return { registered: false as const, reason: "deadline" as const }
        }
        const producerInvocation = ctx.invocation(input.invocationID)
        if (
          !producerInvocation ||
          producerInvocation.executionID !== input.executionID ||
          !["accepted", "running", "waiting"].includes(producerInvocation.state)
        ) {
          return { registered: false as const, reason: "invalid_invocation" as const }
        }
        if (
          current.status === "finalizing" &&
          (input.kind !== "verification_job" || !ctx.invocationReviewAuthorized(input.executionID, input.invocationID))
        ) {
          return { registered: false as const, reason: "not_active" as const }
        }
        const count = db
          .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM execution_blocker WHERE execution_id = ?")
          .get(input.executionID)?.count
        if ((count ?? 0) >= MAX_BLOCKERS_PER_EXECUTION) {
          return { registered: false as const, reason: "blocker_limit" as const }
        }
        try {
          db.query(
            `INSERT INTO execution_blocker
              (id, execution_id, invocation_id, parent_blocker_id, kind, producer_id, resource_scope,
               state, version, owner_id, fence, plan_revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`,
          ).run(
            input.id,
            input.executionID,
            input.invocationID,
            input.parentBlockerID ?? null,
            input.kind,
            input.producerID,
            input.resourceScope,
            input.ownerID,
            input.fence,
            input.planRevision ?? null,
            now,
            now,
          )
        } catch (error) {
          const duplicate = db
            .query<
              { id: string },
              [string, string, string]
            >("SELECT id FROM execution_blocker WHERE execution_id = ? AND kind = ? AND producer_id = ?")
            .get(input.executionID, input.kind, input.producerID)
          if (!duplicate) throw error
          return { registered: false as const, reason: "duplicate_producer" as const, blockerID: duplicate.id }
        }
        const registered = ctx.blocker(input.id)!
        db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, input.executionID)
        ctx.appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blocker: registered })
        return { registered: true as const, idempotent: false, blocker: registered }
      })
    },

    transitionBlocker(input: {
      id: string
      executionID: string
      ownerID: string
      fence: number
      expectedVersion: number
      state: ExecutionLedger.BlockerState
      evidence?: string
      resolutionCode?: string
      authority?: "user" | "policy"
      planRevision?: number
      now?: number
    }) {
      if (input.evidence && new TextEncoder().encode(input.evidence).byteLength > MAX_BLOCKER_EVIDENCE_BYTES) {
        throw new Error(`Blocker evidence exceeds ${MAX_BLOCKER_EVIDENCE_BYTES} bytes`)
      }
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { transitioned: false as const, reason: "not_active" as const }
        }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { transitioned: false as const, reason: "stale_fence" as const }
        }
        const record = ctx.blocker(input.id)
        if (!record) return { transitioned: false as const, reason: "not_found" as const }
        if (record.executionID !== input.executionID) throw new Error("blocker ID belongs to another execution")
        if (record.version !== input.expectedVersion) {
          return { transitioned: false as const, reason: "stale_version" as const, blocker: record }
        }
        if (record.state === input.state) {
          return { transitioned: true as const, idempotent: true, blocker: record }
        }
        if (!ctx.blockerTransitionAllowed(record.state, input.state)) {
          return { transitioned: false as const, reason: "invalid_transition" as const, blocker: record }
        }
        if (
          input.state === "waived" &&
          record.kind === "plan_item" &&
          (input.authority === undefined || input.planRevision !== record.planRevision)
        ) {
          return {
            transitioned: false as const,
            reason: input.authority === undefined ? ("authority_required" as const) : ("stale_plan_revision" as const),
            blocker: record,
          }
        }
        if (
          (["unknown", "failed", "cancelled"].includes(record.state) ||
            ["resolved", "waived", "reopened", "blocked"].includes(input.state)) &&
          (!input.evidence || !input.resolutionCode)
        ) {
          return { transitioned: false as const, reason: "evidence_required" as const, blocker: record }
        }
        const terminal = ["resolved", "failed", "cancelled", "waived"].includes(input.state)
        const result = db
          .query(
            `UPDATE execution_blocker SET state = ?, version = version + 1, owner_id = ?, fence = ?,
            evidence = ?, resolution_code = ?, updated_at = ?, finished_at = ?
           WHERE id = ? AND version = ?`,
          )
          .run(
            input.state,
            input.ownerID,
            input.fence,
            input.evidence ?? null,
            input.resolutionCode ?? null,
            now,
            terminal ? now : null,
            input.id,
            input.expectedVersion,
          )
        if (result.changes !== 1) {
          return { transitioned: false as const, reason: "stale_version" as const, blocker: ctx.blocker(input.id)! }
        }
        const transitioned = ctx.blocker(input.id)!
        db.query("UPDATE execution SET version = version + 1, updated_at = ? WHERE id = ?").run(now, input.executionID)
        ctx.appendExecutionEvent(input.executionID, "execution.blocker.updated", now, { blocker: transitioned })
        return { transitioned: true as const, idempotent: false, blocker: transitioned }
      })
    },

    registerWork(input: {
      id: string
      executionID: string
      invocationID: string
      kind: string
      mutating: boolean
      ownerID: string
      fence: number
      now?: number
    }) {
      return transaction(() => {
        const previous = db
          .query<
            { execution_id: string; state: ExecutionLedger.WorkState; mutating: number },
            [string]
          >("SELECT execution_id, state, mutating FROM execution_work WHERE id = ?")
          .get(input.id)
        if (previous) {
          if (previous.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
          return {
            registered: false as const,
            reason: ["prepared", "running", "draining"].includes(previous.state)
              ? ("work_in_progress" as const)
              : ("duplicate_work" as const),
          }
        }
        const current = ctx.execution(input.executionID)
        if (
          !current ||
          (current.status !== "active" &&
            !(
              current.status === "finalizing" &&
              (!input.mutating || REVIEW_VERIFICATION_TOOLS.has(input.kind)) &&
              ctx.invocationReviewAuthorized(input.executionID, input.invocationID)
            ))
        ) {
          return { registered: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { registered: false as const, reason: "stale_fence" as const }
        }
        if (current.deadline_at !== null && now >= current.deadline_at) {
          return { registered: false as const, reason: "deadline" as const }
        }
        const producerInvocation = ctx.invocation(input.invocationID)
        if (
          !producerInvocation ||
          producerInvocation.executionID !== input.executionID ||
          !["accepted", "running", "waiting"].includes(producerInvocation.state)
        ) {
          return { registered: false as const, reason: "invalid_invocation" as const }
        }
        const count = db
          .query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM execution_work WHERE execution_id = ?")
          .get(input.executionID)?.count
        if ((count ?? 0) >= MAX_WORK_ITEMS_PER_EXECUTION) {
          return { registered: false as const, reason: "work_limit" as const }
        }
        if (
          producerInvocation.kind === "reviewer" &&
          this.reviewerToolCalls(input.executionID, input.invocationID) >= ReviewPolicy.MAX_REVIEW_TOOL_CALLS
        ) {
          return { registered: false as const, reason: "work_limit" as const }
        }
        db.query(
          `INSERT INTO execution_work
            (id, execution_id, invocation_id, kind, mutating, state, owner_id, fence, created_at)
           VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`,
        ).run(
          input.id,
          input.executionID,
          input.invocationID,
          input.kind,
          input.mutating ? 1 : 0,
          input.ownerID,
          input.fence,
          now,
        )
        return { registered: true as const, idempotent: false, state: "prepared" as const, version: 1 }
      })
    },

    beginWork(input: {
      id: string
      executionID: string
      invocationID: string
      ownerID: string
      fence: number
      expectedVersion: number
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { began: false as const, reason: "not_active" as const }
        }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { began: false as const, reason: "stale_fence" as const }
        }
        if (current.deadline_at !== null && now >= current.deadline_at) {
          return { began: false as const, reason: "deadline" as const }
        }
        const producerInvocation = ctx.invocation(input.invocationID)
        if (
          !producerInvocation ||
          producerInvocation.executionID !== input.executionID ||
          !["accepted", "running", "waiting"].includes(producerInvocation.state)
        ) {
          return { began: false as const, reason: "invalid_invocation" as const }
        }
        if (current.status === "finalizing" && !ctx.invocationReviewAuthorized(input.executionID, input.invocationID)) {
          return { began: false as const, reason: "not_active" as const }
        }
        const work = db
          .query<
            {
              execution_id: string
              invocation_id: string
              state: ExecutionLedger.WorkState
              owner_id: string
              fence: number
              version: number
              mutating: number
              kind: string
            },
            [string]
          >(
            `SELECT execution_id, invocation_id, state, owner_id, fence, version, mutating, kind
             FROM execution_work WHERE id = ?`,
          )
          .get(input.id)
        if (!work) return { began: false as const, reason: "not_found" as const }
        if (current.status === "finalizing" && work.mutating === 1 && !REVIEW_VERIFICATION_TOOLS.has(work.kind)) {
          return { began: false as const, reason: "not_active" as const }
        }
        if (work.execution_id !== input.executionID || work.invocation_id !== input.invocationID) {
          throw new Error("work ID belongs to another invocation")
        }
        if (work.version !== input.expectedVersion) return { began: false as const, reason: "stale_version" as const }
        if (work.state !== "prepared") return { began: false as const, reason: "already_began" as const }
        if (work.owner_id !== input.ownerID || work.fence !== input.fence) {
          return { began: false as const, reason: "stale_fence" as const }
        }
        const result = db
          .query(
            `UPDATE execution_work SET state = 'running', version = version + 1, began_at = ?
           WHERE id = ? AND version = ? AND state = 'prepared'`,
          )
          .run(now, input.id, input.expectedVersion)
        if (result.changes !== 1) return { began: false as const, reason: "stale_version" as const }
        if (
          work.mutating === 1 &&
          !(producerInvocation.kind === "reviewer" && REVIEW_VERIFICATION_TOOLS.has(work.kind))
        ) {
          db.query("UPDATE execution SET mutation_revision = mutation_revision + 1 WHERE id = ?").run(input.executionID)
        }
        return { began: true as const, version: input.expectedVersion + 1 }
      })
    },

    finishWork(input: {
      id: string
      executionID: string
      ownerID: string
      fence: number
      expectedVersion: number
      state: "completed" | "failed" | "cancelled" | "unknown"
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        if (!current || !["active", "finalizing", "terminal"].includes(current.status)) {
          return { finished: false as const, reason: "not_active" as const }
        }
        const now = input.now ?? Date.now()
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { finished: false as const, reason: "stale_fence" as const }
        }
        const work = db
          .query<
            {
              execution_id: string
              state: ExecutionLedger.WorkState
              owner_id: string
              fence: number
              version: number
            },
            [string]
          >("SELECT execution_id, state, owner_id, fence, version FROM execution_work WHERE id = ?")
          .get(input.id)
        if (!work) return { finished: false as const, reason: "not_found" as const }
        if (work.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
        if (work.owner_id !== input.ownerID || work.fence !== input.fence) {
          return { finished: false as const, reason: "stale_fence" as const }
        }
        // Cancellation alone advances running work by one revision to draining.
        // Its original owner may settle that observation; takeover/unknown work
        // and all other stale versions still require explicit reconciliation.
        const expectedVersion =
          work.state === "draining" && work.version === input.expectedVersion + 1
            ? work.version
            : input.expectedVersion
        if (work.version !== expectedVersion) {
          return {
            finished: false as const,
            reason: "stale_version" as const,
            state: work.state,
            version: work.version,
          }
        }
        if (!["prepared", "running", "draining"].includes(work.state)) {
          if (work.state === input.state) {
            return { finished: true as const, idempotent: true, state: work.state, version: work.version }
          }
          return {
            finished: false as const,
            reason: work.state === "unknown" ? ("reconciliation_required" as const) : ("terminal" as const),
            state: work.state,
            version: work.version,
          }
        }
        if (work.state === "prepared" && input.state === "unknown") {
          return { finished: false as const, reason: "not_begun" as const }
        }
        const result = db
          .query(
            `UPDATE execution_work SET state = ?, version = version + 1, finished_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(input.state, now, input.id, expectedVersion)
        if (result.changes !== 1) return { finished: false as const, reason: "stale_version" as const }
        return {
          finished: true as const,
          idempotent: false,
          state: input.state,
          version: expectedVersion + 1,
        }
      })
    },

    reconcileWork(input: {
      id: string
      executionID: string
      ownerID: string
      fence: number
      state: "completed" | "failed" | "cancelled"
      expectedVersion: number
      evidence: string
      resolutionCode: string
      now?: number
    }) {
      return transaction(() => {
        const current = ctx.execution(input.executionID)
        const now = input.now ?? Date.now()
        if (!current || !["active", "finalizing"].includes(current.status)) {
          return { reconciled: false as const, reason: "not_active" as const }
        }
        if (!ctx.ownershipValid(current, input.ownerID, input.fence, now)) {
          return { reconciled: false as const, reason: "stale_fence" as const }
        }
        if (
          !input.evidence ||
          !input.resolutionCode ||
          new TextEncoder().encode(input.evidence).byteLength > MAX_BLOCKER_EVIDENCE_BYTES
        ) {
          return { reconciled: false as const, reason: "evidence_required" as const }
        }
        const work = db
          .query<
            { execution_id: string; state: ExecutionLedger.WorkState; version: number },
            [string]
          >("SELECT execution_id, state, version FROM execution_work WHERE id = ?")
          .get(input.id)
        if (!work) return { reconciled: false as const, reason: "not_found" as const }
        if (work.execution_id !== input.executionID) throw new Error("work ID belongs to another execution")
        if (work.version !== input.expectedVersion) {
          return { reconciled: false as const, reason: "stale_version" as const }
        }
        if (work.state !== "unknown") {
          return work.state === input.state
            ? { reconciled: true as const, idempotent: true, state: work.state }
            : { reconciled: false as const, reason: "not_unknown" as const }
        }
        const result = db
          .query(
            `UPDATE execution_work SET state = ?, version = version + 1, evidence = ?, resolution_code = ?, finished_at = ?
           WHERE id = ? AND version = ?`,
          )
          .run(input.state, input.evidence, input.resolutionCode, now, input.id, input.expectedVersion)
        if (result.changes !== 1) return { reconciled: false as const, reason: "stale_version" as const }
        return { reconciled: true as const, idempotent: false, state: input.state }
      })
    },
  }
}
