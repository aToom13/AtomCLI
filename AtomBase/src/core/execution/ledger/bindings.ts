import type { Database } from "bun:sqlite"
import type { LedgerTypes as ExecutionLedger } from "./types"

export function createBindingModule(db: Database) {
  type Context = ExecutionLedger.Context
  return {
    binding(invocationID: string): Context | undefined {
      const row = db
        .query<
          {
            execution_id: string
            root_session_id: string
            invocation_id: string
            owner_id: string
            fence: number
          },
          [string]
        >(
          `SELECT execution_id, root_session_id, invocation_id, owner_id, fence
           FROM execution_binding WHERE invocation_id = ?`,
        )
        .get(invocationID)
      if (!row) return
      return {
        executionID: row.execution_id,
        rootSessionID: row.root_session_id,
        invocationID: row.invocation_id,
        ownerID: row.owner_id,
        fence: row.fence,
      }
    },

    active(sessionID: string): Omit<Context, "invocationID"> | undefined {
      const row = db
        .query<{ execution_id: string; root_session_id: string; owner_id: string; fence: number }, [string]>(
          `SELECT binding.execution_id, binding.root_session_id, binding.owner_id, binding.fence
           FROM session_execution binding
           JOIN execution current ON current.id = binding.execution_id
           WHERE binding.session_id = ? AND current.lifecycle != 'terminal' AND current.outcome IS NULL`,
        )
        .get(sessionID)
      if (!row) return
      return {
        executionID: row.execution_id,
        rootSessionID: row.root_session_id,
        ownerID: row.owner_id,
        fence: row.fence,
      }
    },

    waitingInput(sessionID: string): Context | undefined {
      const row = db
        .query<
          {
            execution_id: string
            root_session_id: string
            invocation_id: string
            owner_id: string
            fence: number
          },
          [string]
        >(
          `SELECT current.id AS execution_id, current.root_session_id,
             invocation.id AS invocation_id, current.owner_id, current.fence
           FROM session_execution binding
           JOIN execution current ON current.id = binding.execution_id
           JOIN execution_invocation invocation
             ON invocation.execution_id = current.id AND invocation.session_id = binding.session_id
           WHERE binding.session_id = ?
             AND current.lifecycle = 'active' AND current.outcome IS NULL
             AND current.phase = 'waiting_input' AND current.owner_id IS NOT NULL
             AND invocation.kind = 'root' AND invocation.state = 'waiting'
           ORDER BY invocation.created_at DESC, invocation.rowid DESC LIMIT 1`,
        )
        .get(sessionID)
      if (!row) return
      return {
        executionID: row.execution_id,
        rootSessionID: row.root_session_id,
        invocationID: row.invocation_id,
        ownerID: row.owner_id,
        fence: row.fence,
      }
    },
  }
}
