import fs from "fs/promises"
import path from "path"
import { Global } from "@/core/global"

export interface TraceRecord {
  ts: number
  sessionID: string
  stepIndex: number
  event: "step_start" | "tool_call" | "chain_event" | "error" | "complete"
  tool?: string
  args?: Record<string, any>
  outputSummary?: string
  durationMs?: number
  metadata?: Record<string, any>
}

export namespace ExecutionTrace {
  const TRACES = new Map<string, TraceRecord[]>()

  /**
   * Records a trace event for a session and asynchronously persists it to disk.
   */
  export function record(sessionID: string, entry: Omit<TraceRecord, "ts" | "sessionID">): TraceRecord {
    const fullRecord: TraceRecord = {
      ts: Date.now(),
      sessionID,
      ...entry,
    }

    const list = TRACES.get(sessionID) ?? []
    list.push(fullRecord)
    TRACES.set(sessionID, list)

    // Async persist line to .atomcli/runs/<sessionID>/trace.jsonl
    persistLine(sessionID, fullRecord).catch(() => {})

    return fullRecord
  }

  /**
   * Gets all in-memory trace records for a session.
   */
  export function get(sessionID: string): TraceRecord[] {
    return TRACES.get(sessionID) ?? []
  }

  /**
   * Clears in-memory trace records for a session.
   */
  export function clear(sessionID: string): void {
    TRACES.delete(sessionID)
  }

  async function persistLine(sessionID: string, record: TraceRecord): Promise<void> {
    try {
      const runsDir = path.join(Global.Path.state, "runs", sessionID)
      await fs.mkdir(runsDir, { recursive: true })
      const traceFile = path.join(runsDir, "trace.jsonl")
      await fs.appendFile(traceFile, JSON.stringify(record) + "\n", "utf-8")
    } catch {
      /* ignore logging errors */
    }
  }
}
