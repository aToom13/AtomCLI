/**
 * ProjectDetector — Reads common project manifest files to detect:
 *   - Package manager (bun / npm / yarn / pnpm / cargo / pip / go)
 *   - Test command
 *   - Typecheck / lint commands
 *
 * Used by SystemPrompt.environment() to inject a <project_commands> block
 * so the AI knows the exact commands without guessing.
 */

import path from "path"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "project-detector" })

export interface ProjectCommands {
  packageManager?: string
  test?: string
  typecheck?: string
  lint?: string
  build?: string
  /** Raw detection notes for debugging */
  notes: string[]
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return await Bun.file(p).exists()
  } catch {
    return false
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await Bun.file(p).text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await Bun.file(p).text()
  } catch {
    return null
  }
}

export namespace ProjectDetector {
  /**
   * Detect project commands from common manifest files in the given directory.
   * Never throws — returns empty notes on any failure.
   */
  export async function detect(cwd: string): Promise<ProjectCommands> {
    const result: ProjectCommands = { notes: [] }

    try {
      await detectPackageJson(cwd, result)
      await detectCargo(cwd, result)
      await detectPython(cwd, result)
      await detectGo(cwd, result)
      await detectMakefile(cwd, result)
    } catch (error) {
      log.warn("project detection failed", { error })
    }

    return result
  }

  /**
   * Format detected commands into an XML block for system prompt injection.
   * Returns an empty string if nothing was detected.
   */
  export function format(commands: ProjectCommands): string {
    const lines: string[] = []

    if (commands.packageManager) lines.push(`  Package Manager: ${commands.packageManager}`)
    if (commands.test) lines.push(`  Test: ${commands.test}`)
    if (commands.typecheck) lines.push(`  Typecheck: ${commands.typecheck}`)
    if (commands.lint) lines.push(`  Lint: ${commands.lint}`)
    if (commands.build) lines.push(`  Build: ${commands.build}`)

    if (lines.length === 0) return ""

    return ["<project_commands>", ...lines, "</project_commands>"].join("\n")
  }

  // ─── Detectors ──────────────────────────────────────────────────────────────

  async function detectPackageJson(cwd: string, result: ProjectCommands): Promise<void> {
    const pkgPath = path.join(cwd, "package.json")
    const pkg = await readJson(pkgPath)
    if (!pkg) return

    result.notes.push("detected: package.json")
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}

    // Detect package manager
    const hasBunLock = await fileExists(path.join(cwd, "bun.lockb")) || await fileExists(path.join(cwd, "bun.lock"))
    const hasPnpmLock = await fileExists(path.join(cwd, "pnpm-lock.yaml"))
    const hasYarnLock = await fileExists(path.join(cwd, "yarn.lock"))

    if (hasBunLock) {
      result.packageManager = "bun (detected via bun.lock)"
    } else if (hasPnpmLock) {
      result.packageManager = "pnpm (detected via pnpm-lock.yaml)"
    } else if (hasYarnLock) {
      result.packageManager = "yarn (detected via yarn.lock)"
    } else {
      result.packageManager = "npm (detected via package.json)"
    }

    const pm = hasBunLock ? "bun" : hasPnpmLock ? "pnpm" : hasYarnLock ? "yarn" : "npm"
    const run = pm === "bun" ? "bun run" : `${pm} run`

    // Test command — prefer "test" script, fall back to "bun test" for bun projects
    if (scripts["test"]) {
      result.test = `${run} test (detected via package.json scripts.test)`
    } else if (hasBunLock) {
      result.test = `bun test (detected via bun.lockb — no scripts.test in package.json)`
    }

    // Typecheck
    if (scripts["typecheck"]) {
      result.typecheck = `${run} typecheck (detected via package.json scripts.typecheck)`
    } else if (scripts["type-check"]) {
      result.typecheck = `${run} type-check (detected via package.json scripts.type-check)`
    } else if (scripts["tsc"]) {
      result.typecheck = `${run} tsc (detected via package.json scripts.tsc)`
    } else if (scripts["check"]) {
      result.typecheck = `${run} check (detected via package.json scripts.check)`
    }

    // Lint
    if (scripts["lint"]) {
      result.lint = `${run} lint (detected via package.json scripts.lint)`
    }

    // Build
    if (scripts["build"]) {
      result.build = `${run} build (detected via package.json scripts.build)`
    }
  }

  async function detectCargo(cwd: string, result: ProjectCommands): Promise<void> {
    const cargoPath = path.join(cwd, "Cargo.toml")
    if (!(await fileExists(cargoPath))) return

    result.notes.push("detected: Cargo.toml")
    if (!result.packageManager) result.packageManager = "cargo (detected via Cargo.toml)"
    if (!result.test) result.test = "cargo test (detected via Cargo.toml)"
    if (!result.typecheck) result.typecheck = "cargo check (detected via Cargo.toml)"
    if (!result.build) result.build = "cargo build (detected via Cargo.toml)"
  }

  async function detectPython(cwd: string, result: ProjectCommands): Promise<void> {
    const hasPyproject = await fileExists(path.join(cwd, "pyproject.toml"))
    const hasSetupPy = await fileExists(path.join(cwd, "setup.py"))
    const hasPipfile = await fileExists(path.join(cwd, "Pipfile"))

    if (!hasPyproject && !hasSetupPy && !hasPipfile) return

    const source = hasPyproject ? "pyproject.toml" : hasSetupPy ? "setup.py" : "Pipfile"
    result.notes.push(`detected: ${source}`)
    if (!result.packageManager) result.packageManager = `pip / poetry (detected via ${source})`

    if (!result.test) {
      // Try to read pyproject.toml to detect pytest vs unittest
      if (hasPyproject) {
        const content = await readText(path.join(cwd, "pyproject.toml"))
        if (content?.includes("[tool.pytest")) {
          result.test = `pytest (detected via pyproject.toml [tool.pytest])`
        } else {
          result.test = `python -m pytest (detected via ${source})`
        }
      } else {
        result.test = `python -m pytest (detected via ${source})`
      }
    }

    if (!result.typecheck) result.typecheck = "mypy . (detected via Python project)"
  }

  async function detectGo(cwd: string, result: ProjectCommands): Promise<void> {
    const goModPath = path.join(cwd, "go.mod")
    if (!(await fileExists(goModPath))) return

    result.notes.push("detected: go.mod")
    if (!result.packageManager) result.packageManager = "go (detected via go.mod)"
    if (!result.test) result.test = "go test ./... (detected via go.mod)"
    if (!result.typecheck) result.typecheck = "go vet ./... (detected via go.mod)"
    if (!result.build) result.build = "go build ./... (detected via go.mod)"
  }

  async function detectMakefile(cwd: string, result: ProjectCommands): Promise<void> {
    const makefilePath = path.join(cwd, "Makefile")
    const content = await readText(makefilePath)
    if (!content) return

    result.notes.push("detected: Makefile")

    // Parse top-level target names from Makefile
    const targets = Array.from(content.matchAll(/^([a-zA-Z][a-zA-Z0-9_-]*):/gm)).map((m) => m[1])

    if (!result.test && targets.includes("test")) {
      result.test = `make test (detected via Makefile target "test")`
    }
    if (!result.typecheck && (targets.includes("typecheck") || targets.includes("type-check") || targets.includes("check"))) {
      const target = targets.find((t) => t === "typecheck" || t === "type-check" || t === "check")!
      result.typecheck = `make ${target} (detected via Makefile target)`
    }
    if (!result.lint && targets.includes("lint")) {
      result.lint = `make lint (detected via Makefile target "lint")`
    }
  }
}
