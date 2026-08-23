/**
 * Memory test isolation guard.
 *
 * Memory services resolve Global.Path.root at first construction, so
 * ATOMCLI_TEST_HOME must exist before any src/ import evaluates. bunfig's
 * preload chain normally handles this; this module keeps the suite safe even
 * when the file is executed outside that chain.
 */
import os from "os"
import path from "path"
import fs from "fs/promises"

const testDir = path.join(os.tmpdir(), "atomcli-memory-integration-test")

export async function setupTestHome() {
  await fs.rm(testDir, { recursive: true, force: true })
  await fs.mkdir(testDir, { recursive: true })
  process.env["ATOMCLI_TEST_HOME"] = testDir
}

await setupTestHome()
