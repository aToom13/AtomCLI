import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import z from "zod"

const MAX_AUDIT_BYTES = 1024 * 1024
const MAX_RECENT_ENTRIES = 500

export namespace CompanionAudit {
  export const Entry = z.object({
    timestamp: z.number().int().nonnegative(),
    action: z.string().min(1).max(64),
    outcome: z.enum(["ok", "error", "conflict", "denied"]),
    deviceId: z.string().min(1).max(200),
    deviceName: z.string().min(1).max(200).optional(),
    errorCode: z.string().min(1).max(64).optional(),
  })
  export type Entry = z.infer<typeof Entry>

  function paths() {
    const directory = join(process.env.ATOMCLI_TEST_HOME || homedir(), ".atomcli")
    return {
      directory,
      current: join(directory, "companion-audit.jsonl"),
      previous: join(directory, "companion-audit.previous.jsonl"),
    }
  }

  function safeErrorCode(value: string | undefined) {
    if (!value) return undefined
    return /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : "operation_failed"
  }

  export function record(
    input: Omit<Entry, "timestamp" | "errorCode"> & { timestamp?: number; errorCode?: string },
  ): void {
    const parsed = Entry.parse({
      ...input,
      timestamp: input.timestamp ?? Date.now(),
      errorCode: safeErrorCode(input.errorCode),
    })
    const target = paths()
    try {
      mkdirSync(target.directory, { recursive: true, mode: 0o700 })
      try {
        if (statSync(target.current).size >= MAX_AUDIT_BYTES) renameSync(target.current, target.previous)
      } catch {
        // A missing audit file is the normal first-run state.
      }
      appendFileSync(target.current, `${JSON.stringify(parsed)}\n`, { encoding: "utf8", mode: 0o600 })
      chmodSync(target.current, 0o600)
    } catch {
      // Audit persistence must not turn a permission denial into an approval or
      // take the Companion control channel down.
    }
  }

  export function recent(limit = 100): Entry[] {
    const count = Math.max(0, Math.min(limit, MAX_RECENT_ENTRIES))
    if (count === 0) return []
    try {
      const lines = readFileSync(paths().current, "utf8").trim().split("\n").slice(-count)
      return lines.flatMap((line) => {
        try {
          const parsed = Entry.safeParse(JSON.parse(line))
          return parsed.success ? [parsed.data] : []
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  }
}
