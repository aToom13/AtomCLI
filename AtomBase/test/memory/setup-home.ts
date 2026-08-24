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
  // The package test preload owns suite-wide isolation. Replacing its home
  // while other test files are running redirects every dynamic Global.Path
  // getter and can delete directories underneath unrelated tests.
  if (process.env.ATOMCLI_TEST_HOME) return process.env.ATOMCLI_TEST_HOME

  await fs.rm(testDir, { recursive: true, force: true })
  await fs.mkdir(testDir, { recursive: true })
  process.env["ATOMCLI_TEST_HOME"] = testDir
  return testDir
}

await setupTestHome()
