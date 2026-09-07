import { expect, test } from "bun:test"
import { Storage } from "@/core/storage/storage"
import { aggregateSessionStats } from "@/interfaces/cli/cmd/stats"

test("stats skips unreadable storage records", async () => {
  await Storage._internals.importLegacy(["project", "corrupt-stats-fixture"], "{not-json")

  const stats = await aggregateSessionStats(undefined, "corrupt-stats-fixture-project")

  expect(stats.totalSessions).toBe(0)
  expect(stats.skippedSessions).toBe(1)
})
