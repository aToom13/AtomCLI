// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { afterAll, setDefaultTimeout } from "bun:test"

// Bun 1.3.10 can fall back to its 5s default when this package is reached
// through the monorepo. Keep the effective timeout aligned with bunfig.toml.
setDefaultTimeout(10_000)

const dir = path.join(os.tmpdir(), "atomcli-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })
afterAll(() => {
  fsSync.rmSync(dir, { recursive: true, force: true })
})
// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["ATOMCLI_TEST_HOME"] = testHome

// A live provider audit must exercise credentials created by `atomcli auth
// login` without letting the test process write to the user's real AtomCLI
// directory. Copy only the encrypted auth store and its key into the isolated
// test home; the normal suite never reads either file.
if (process.env["ATOMCLI_PROVIDER_LIVE_TEST"] === "1") {
  const source = path.join(os.homedir(), ".atomcli", "data")
  const destination = path.join(testHome, ".atomcli", "data")
  await fs.mkdir(destination, { recursive: true })
  for (const filename of ["auth.json", ".keyfile"]) {
    await fs.copyFile(path.join(source, filename), path.join(destination, filename)).catch(() => {})
  }
}

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

// Seed models.json from the explicit fixture when provided. The documented test
// command always sets MODELS_DEV_API_JSON; fetching here made otherwise-hermetic
// tests fail before collection whenever the network was unavailable.
// Also write the cache version file to prevent global/index.ts from clearing the cache.
const cacheDir = path.join(dir, "cache", "atomcli")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "16")
const modelsFixture = process.env["MODELS_DEV_API_JSON"]
const providerLiveAudit =
  process.env["ATOMCLI_PROVIDER_LIVE_TEST"] === "1" ||
  process.env["ATOMCLI_PROVIDER_ANONYMOUS_TEST"] === "1" ||
  process.env["ATOMCLI_PROVIDER_ATOMCLI_TEST"] === "1"
let liveCatalog: Record<string, { env?: string[] }> | undefined
if (modelsFixture) {
  await fs.copyFile(path.resolve(modelsFixture), path.join(cacheDir, "models.json"))
} else if (providerLiveAudit) {
  const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`models.dev returned ${response.status} during provider live audit`)
  const body = await response.text()
  liveCatalog = JSON.parse(body)
  await fs.writeFile(path.join(cacheDir, "models.json"), body)
}
// Contract tests use a pinned catalog. Explicit live audits intentionally use
// the current models.dev catalog so stale fixture URLs cannot create false
// provider results.
if (providerLiveAudit) delete process.env["ATOMCLI_DISABLE_MODELS_FETCH"]
else process.env["ATOMCLI_DISABLE_MODELS_FETCH"] = "true"

// Clear every credential advertised by the catalog to ensure a genuinely clean
// test state. Keeping a hand-written list here allowed less common provider
// credentials to leak into tests. The authenticated live audit is the only
// suite allowed to consume real credentials.
if (process.env["ATOMCLI_PROVIDER_LIVE_TEST"] !== "1") {
  const credentialNames = new Set([
    "KILOCODE_TOKEN",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_BEARER_TOKEN_BEDROCK",
  ])
  const credentialCatalog = modelsFixture ?? path.resolve("test/tool/fixtures/models-api.json")
  if (fsSync.existsSync(credentialCatalog)) {
    const catalog = JSON.parse(await fs.readFile(credentialCatalog, "utf8")) as Record<string, { env?: string[] }>
    for (const provider of Object.values(catalog)) {
      for (const name of provider.env ?? []) credentialNames.add(name)
    }
  }
  for (const provider of Object.values(liveCatalog ?? {})) {
    for (const name of provider.env ?? []) credentialNames.add(name)
  }
  for (const name of credentialNames) delete process.env[name]
}

// Now safe to import from src/
const { Log } = await import("@/util/util/log")

Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})
