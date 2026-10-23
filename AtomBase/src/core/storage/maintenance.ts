import fs from "fs/promises"
import path from "path"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { Snapshot } from "@/core/snapshot"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"

export namespace DataMaintenance {
  // ponytail: conversations remain user-owned; only redundant diagnostics expire automatically.
  const log = Log.create({ service: "data-maintenance" })
  const HOUR = 3_600_000

  export async function run(apply = false, allProjects = false) {
    const config = (await Config.get()).retention
    const olderThan = Date.now() - (config?.orphan_hours ?? 24) * HOUR
    const legacy = await Storage.compactLegacy(!apply)
    const diagnostics = await Storage.expireDiagnostics(Date.now() - 7 * 24 * HOUR, !apply, config?.replay === true)
    const storage = await Storage.collectGarbage({
      dryRun: !apply,
      olderThan,
      maxBytes: (config?.max_delete_mib ?? 1024) * 1024 * 1024,
    })
    const projects = allProjects
      ? (
          await fs
            .readdir(path.join(Global.Path.data, "snapshot"), { withFileTypes: true })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return []
              throw error
            })
        )
          .map((entry) => entry.name)
          .filter((name) => /^(global|[a-f0-9]{40,64})$/.test(name))
      : [Instance.project.id]
    const snapshot = []
    let blocked = false
    for (const projectID of projects) {
      try {
        snapshot.push({
          projectID,
          status: "pass",
          ...(await Snapshot.collectGarbage({ dryRun: !apply, olderThan, projectID })),
        })
      } catch (error) {
        blocked = true
        snapshot.push({ projectID, status: "blocked", error: (error as Error).message })
      }
    }
    return { applied: apply, blocked, orphanHours: config?.orphan_hours ?? 24, storage, legacy, diagnostics, snapshot }
  }

  const state = Instance.state(
    () => {
      let running: Promise<void> | undefined
      const check = () => {
        if (running) return
        running = (async () => {
          const config = (await Config.get()).retention
          if (config?.enabled === false) return
          const stamp = path.join(Global.Path.state, "maintenance", "data.json")
          const previous = await Bun.file(stamp)
            .json()
            .catch((error) => {
              if (error.code === "ENOENT") return { completedAt: 0 }
              throw error
            })
          if (Date.now() - previous.completedAt < (config?.interval_hours ?? 24) * HOUR) return
          const result = await run(true, true)
          if (result.blocked) {
            log.warn("maintenance partially blocked; protected snapshots retained", result)
            return
          }
          await fs.mkdir(path.dirname(stamp), { recursive: true })
          const temporary = `${stamp}.${process.pid}.${crypto.randomUUID()}.tmp`
          await Bun.write(temporary, JSON.stringify({ completedAt: Date.now() }))
          await fs.rename(temporary, stamp)
          log.info("completed", result)
        })()
          .catch((error) =>
            log.warn("maintenance failed; retained data preserved", { error: (error as Error).message }),
          )
          .finally(() => {
            running = undefined
          })
      }
      const initial = setTimeout(check, 30_000)
      const interval = setInterval(check, HOUR)
      initial.unref()
      interval.unref()
      return { initial, interval, pending: () => running }
    },
    async (current) => {
      clearTimeout(current.initial)
      clearInterval(current.interval)
      await current.pending()
    },
  )

  export function init() {
    state()
  }
}
