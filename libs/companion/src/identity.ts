import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { join } from "node:path"

const PROCESS_ID = crypto.randomUUID()

export namespace CompanionIdentity {
  export type Machine = { machineId: string; machineName: string }

  const atomcliDirectory = join(process.env.ATOMCLI_TEST_HOME || homedir(), ".atomcli")
  const identityPath = join(atomcliDirectory, "companion-identity.json")
  let cached: Machine | undefined

  function create(): Machine {
    return { machineId: crypto.randomUUID(), machineName: hostname() || "AtomCLI machine" }
  }

  function valid(value: unknown): value is Machine {
    if (!value || typeof value !== "object") return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.machineId === "string" && typeof candidate.machineName === "string"
  }

  export function machine(): Machine {
    if (cached) return cached
    try {
      const parsed = JSON.parse(readFileSync(identityPath, "utf8"))
      if (valid(parsed)) return (cached = parsed)
    } catch {
      // A missing or damaged file is replaced with a fresh machine identity.
    }

    cached = create()
    mkdirSync(atomcliDirectory, { recursive: true })
    const temporaryPath = `${identityPath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(cached, null, 2), { mode: 0o600 })
    renameSync(temporaryPath, identityPath)
    return cached
  }

  export function processId() {
    return PROCESS_ID
  }
}
