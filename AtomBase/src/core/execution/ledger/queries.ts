import { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"
import { LedgerTypes } from "./types"

const MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT = 1_000
const TERMINAL_EXECUTIONS_PER_SNAPSHOT = 20

type ListCursor = {
  version: 1
  sessionID: string
  epoch: string
  sequence: number
  createdAt: number
  executionID: string
}

type Context = {
  db: Database
  transaction<T>(fn: () => T): T
  executionView(executionID: string): ExecutionLedger.ExecutionView | undefined
  expireRouteProposals(executionIDs: string[], now: number): void
  currentEventSequence(): number
  eventEpoch(): string
  eventRetentionFloor(): number
  sessionGeneration(sessionID: string): number
  activeExecutionID(sessionID: string): string | undefined
  blockers(executionID: string): ExecutionLedger.Blocker[]
  publicBlocker(value: ExecutionLedger.Blocker): ExecutionLedger.PublicBlocker
  invocationView(row: {
    id: string
    execution_id: string
    session_id: string
    parent_invocation_id: string | null
    kind: ExecutionLedger.InvocationKind
    state: ExecutionLedger.InvocationState
    revision: number
    created_at: number
  }): ExecutionLedger.InvocationView
  pendingRouteProposals(executionIDs: string[]): ExecutionLedger.RouteProposal[]
}

export function createQueryModule(ctx: Context) {
  const { db, transaction } = ctx

  function encodeListCursor(cursor: ListCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url")
  }

  function decodeListCursor(value: string | undefined, sessionID: string): ListCursor | undefined {
    if (!value) return
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ListCursor
      if (
        parsed.version !== 1 ||
        parsed.sessionID !== sessionID ||
        parsed.epoch !== ctx.eventEpoch() ||
        !Number.isInteger(parsed.sequence) ||
        !Number.isInteger(parsed.createdAt) ||
        typeof parsed.executionID !== "string"
      ) {
        throw new Error("cursor scope changed")
      }
      return parsed
    } catch {
      throw new Error("Invalid or expired execution cursor")
    }
  }

  return {
    list(input: { sessionID: string; cursor?: string; limit?: number }): ExecutionLedger.ExecutionList {
      return transaction(() => {
        const limit = Math.min(100, Math.max(1, input.limit ?? 20))
        const cursor = decodeListCursor(input.cursor, input.sessionID)
        const sequence = cursor?.sequence ?? ctx.currentEventSequence()
        const rows = cursor
          ? db
              .query<{ id: string; created_at: number }, [string, number, number, string, number]>(
                `SELECT id, created_at FROM execution
                 WHERE root_session_id = ? AND deleted_at IS NULL
                   AND (created_at < ? OR (created_at = ? AND id < ?))
                 ORDER BY created_at DESC, id DESC LIMIT ?`,
              )
              .all(input.sessionID, cursor.createdAt, cursor.createdAt, cursor.executionID, limit + 1)
          : db
              .query<{ id: string; created_at: number }, [string, number]>(
                `SELECT id, created_at FROM execution
                 WHERE root_session_id = ? AND deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC LIMIT ?`,
              )
              .all(input.sessionID, limit + 1)
        const page = rows.slice(0, limit)
        const last = page.at(-1)
        return LedgerTypes.ExecutionList.parse({
          items: page.map((row) => ctx.executionView(row.id)!),
          nextCursor:
            rows.length > limit && last
              ? encodeListCursor({
                  version: 1,
                  sessionID: input.sessionID,
                  epoch: ctx.eventEpoch(),
                  sequence,
                  createdAt: last.created_at,
                  executionID: last.id,
                })
              : undefined,
          sessionGeneration: ctx.sessionGeneration(input.sessionID),
          activeExecutionID: ctx.activeExecutionID(input.sessionID),
          sessionVersion: db
            .query<
              { version: number },
              [string]
            >("SELECT COALESCE(MAX(sequence), 0) AS version FROM execution_event WHERE session_id = ?")
            .get(input.sessionID)!.version,
        })
      })
    },

    snapshot(sessionID: string, now = Date.now()): ExecutionLedger.ExecutionSnapshot {
      return transaction(() => {
        const activeRows = db
          .query<{ id: string }, [string, number]>(
            `SELECT id FROM execution WHERE root_session_id = ? AND deleted_at IS NULL
               AND lifecycle != 'terminal' AND outcome IS NULL
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(sessionID, MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT + 1)
        if (activeRows.length > MAX_ACTIVE_EXECUTIONS_PER_SNAPSHOT) {
          throw new Error("Execution snapshot exceeds the supported active execution limit")
        }
        const terminalRows = db
          .query<{ id: string }, [string, number]>(
            `SELECT id FROM execution WHERE root_session_id = ? AND deleted_at IS NULL
               AND (lifecycle = 'terminal' OR outcome IS NOT NULL)
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(sessionID, TERMINAL_EXECUTIONS_PER_SNAPSHOT)
        const executionIDs = [...activeRows, ...terminalRows].map((row) => row.id)
        ctx.expireRouteProposals(executionIDs, now)
        const activeInvocations = db
          .query<
            {
              id: string
              execution_id: string
              session_id: string
              parent_invocation_id: string | null
              kind: ExecutionLedger.InvocationKind
              state: ExecutionLedger.InvocationState
              revision: number
              created_at: number
            },
            [string]
          >(
            `SELECT i.id, i.execution_id, i.session_id, i.parent_invocation_id, i.kind, i.state,
               i.revision, i.created_at
             FROM execution_invocation i JOIN execution e ON e.id = i.execution_id
             WHERE e.root_session_id = ? AND e.deleted_at IS NULL
               AND i.state IN ('accepted', 'running', 'waiting', 'draining', 'unknown')
             ORDER BY i.created_at, i.id`,
          )
          .all(sessionID)
        const blockers = executionIDs.flatMap((executionID) =>
          ctx.blockers(executionID).map((value) => ctx.publicBlocker(value)),
        )
        const sequence = ctx.currentEventSequence()
        return LedgerTypes.ExecutionSnapshot.parse({
          cursor: { epoch: ctx.eventEpoch(), sequence },
          sessionGeneration: ctx.sessionGeneration(sessionID),
          sessionVersion:
            db
              .query<
                { version: number },
                [string]
              >("SELECT COALESCE(MAX(sequence), 0) AS version FROM execution_event WHERE session_id = ?")
              .get(sessionID)?.version ?? 0,
          activeExecutionID: ctx.activeExecutionID(sessionID),
          activeInvocations: activeInvocations.map((row) => ctx.invocationView(row)),
          executions: executionIDs.map((executionID) => ctx.executionView(executionID)!),
          pendingProposals: ctx.pendingRouteProposals(executionIDs),
          blockers,
        })
      })
    },

    events(input: { sessionID: string; cursor?: ExecutionLedger.Cursor; afterSequence?: number; limit?: number }) {
      const limit = Math.min(100, Math.max(1, input.limit ?? 100))
      const epoch = ctx.eventEpoch()
      const currentSequence = ctx.currentEventSequence()
      const sequence = input.cursor?.sequence ?? input.afterSequence ?? 0
      if (input.cursor?.epoch !== undefined && input.cursor.epoch !== epoch) {
        return {
          epoch,
          cursor: { epoch, sequence: currentSequence },
          items: [] as ExecutionLedger.EventEnvelope[],
          resyncRequired: true as const,
          reason: "epoch_changed" as const,
        }
      }
      if (sequence > currentSequence) {
        return {
          epoch,
          cursor: { epoch, sequence: currentSequence },
          items: [] as ExecutionLedger.EventEnvelope[],
          resyncRequired: true as const,
          reason: "cursor_ahead" as const,
        }
      }
      if (sequence < ctx.eventRetentionFloor()) {
        return {
          epoch,
          cursor: { epoch, sequence: currentSequence },
          items: [] as ExecutionLedger.EventEnvelope[],
          resyncRequired: true as const,
          reason: "retention_gap" as const,
        }
      }
      const rows = db
        .query<
          {
            sequence: number
            event_id: string
            epoch: string
            project_id: string
            session_id: string
            session_generation: number
            execution_id: string | null
            resource_version: number
            type: ExecutionLedger.EventType
            properties: string
          },
          [string, number, number]
        >(
          `SELECT sequence, event_id, epoch, project_id, session_id, session_generation,
             execution_id, resource_version, type, properties
           FROM execution_event
           WHERE session_id = ? AND sequence > ?
           ORDER BY sequence LIMIT ?`,
        )
        .all(input.sessionID, sequence, limit)
      const items = rows.map((row) =>
        LedgerTypes.EventEnvelope.parse({
          eventID: row.event_id,
          cursor: { epoch: row.epoch, sequence: row.sequence },
          projectID: row.project_id,
          sessionID: row.session_id,
          sessionGeneration: row.session_generation,
          executionID: row.execution_id ?? undefined,
          resourceVersion: row.resource_version,
          type: row.type,
          properties: JSON.parse(row.properties),
        }),
      )
      return {
        epoch,
        cursor: {
          epoch,
          sequence: items.length === limit ? items.at(-1)!.cursor.sequence : currentSequence,
        },
        items,
        resyncRequired: false as const,
      }
    },
  }
}
