import { afterAll, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/core/global"
import { aggregateSessionStats } from "@/interfaces/cli/cmd/stats"

const projectDir = path.join(Global.Path.data, "storage", "project")
const corruptRecord = path.join(projectDir, "corrupt-stats-fixture.json")

afterAll(async () => {
  await fs.rm(corruptRecord, { force: true })
})

test("stats skips unreadable storage records", async () => {
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(corruptRecord, "{not-json")

  const stats = await aggregateSessionStats(undefined, "corrupt-stats-fixture-project")

  expect(stats.totalSessions).toBe(0)
  expect(stats.skippedSessions).toBe(1)
})
