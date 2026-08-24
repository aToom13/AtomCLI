#!/usr/bin/env bun

import path from "path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SOURCE_PATH = "AtomBase/package.json"
const RELEASE_NOTES_PATH = "RELEASE_NOTES.md"
const WORKSPACE_PATHS = [
  "libs/companion/package.json",
  "libs/plugin/package.json",
  "libs/script/package.json",
  "libs/sdk/js/package.json",
  "libs/util/package.json",
] as const
const LOCK_WORKSPACES = [
  "AtomBase",
  "libs/companion",
  "libs/plugin",
  "libs/script",
  "libs/sdk/js",
  "libs/util",
] as const
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const args = process.argv.slice(2)
const check = args.includes("--check")
const versionArgs = args.filter((arg) => arg !== "--check")
const requested = versionArgs[0]?.replace(/^v/, "")

if (versionArgs.length > 1) {
  throw new Error("Usage: bun run version:sync [version] or bun run version:check")
}

const source = await readPackage(SOURCE_PATH)
const previous = source.version
const version = requested ?? previous

if (typeof version !== "string" || !SEMVER.test(version)) {
  throw new Error("Invalid AtomCLI version: " + String(version))
}
if (check && requested) {
  throw new Error("version:check does not accept a version argument")
}

if (!check) {
  source.version = version
  await writePackage(SOURCE_PATH, source)
  for (const file of WORKSPACE_PATHS) {
    const pkg = await readPackage(file)
    pkg.version = version
    await writePackage(file, pkg)
  }

  const notesFile = Bun.file(path.join(ROOT, RELEASE_NOTES_PATH))
  const notes = await notesFile.text()
  const lines = notes.split(/\r?\n/)
  lines[0] = "# AtomCLI v" + version
  await Bun.write(notesFile, lines.join("\n"))

  const install = Bun.spawn(["bun", "install", "--lockfile-only", "--ignore-scripts"], {
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await install.exited
  if (exitCode !== 0) throw new Error("Failed to synchronize bun.lock")
}

await verify(version)
console.log("AtomCLI workspace versions are synchronized at " + version)

async function verify(expected: string) {
  const failures: string[] = []
  const sourcePackage = await readPackage(SOURCE_PATH)
  if (sourcePackage.version !== expected) failures.push(SOURCE_PATH + ": expected " + expected)

  for (const file of WORKSPACE_PATHS) {
    const pkg = await readPackage(file)
    if (pkg.version !== expected) {
      failures.push(file + ": found " + String(pkg.version) + ", expected " + expected)
    }
  }

  const notes = await Bun.file(path.join(ROOT, RELEASE_NOTES_PATH)).text()
  if (notes.split(/\r?\n/, 1)[0] !== "# AtomCLI v" + expected) {
    failures.push(RELEASE_NOTES_PATH + ': heading must be "# AtomCLI v' + expected + '"')
  }

  const lock = await Bun.file(path.join(ROOT, "bun.lock")).text()
  for (const workspace of LOCK_WORKSPACES) {
    const escaped = escapeRegExp(workspace)
    const entry = new RegExp('"' + escaped + '": \\{[\\s\\S]{0,240}?"version": "' + escapeRegExp(expected) + '"')
    if (!entry.test(lock)) failures.push("bun.lock: " + workspace + " is not synchronized at " + expected)
  }

  if (failures.length > 0) {
    throw new Error("Version synchronization failed:\n- " + failures.join("\n- "))
  }
}

async function readPackage(file: string) {
  return (await Bun.file(path.join(ROOT, file)).json()) as Record<string, unknown> & { version?: string }
}

async function writePackage(file: string, pkg: Record<string, unknown>) {
  await Bun.write(path.join(ROOT, file), JSON.stringify(pkg, null, 2) + "\n")
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")
}
