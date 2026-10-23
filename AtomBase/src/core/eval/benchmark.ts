import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/core/global"
import type { AgentEval } from "./harness"

export namespace AgentBenchmark {
  export const Case = z.object({
    id: z.string().min(1),
    category: z.enum(["coding", "documentation", "analysis", "general"]),
    prompt: z.string().min(1),
    requiresTools: z.boolean().default(false),
    expectsTests: z.boolean().default(false),
    // Threshold on retries observed in the trajectory, not an execution retry
    // budget — benchmark sessions always run with executionPolicy maxRetries 0.
    // Under outcome-v2 these thresholds are penalty-free allowances, not failure gates.
    maxToolErrors: z.number().int().nonnegative().default(0),
    maxRetries: z.number().int().nonnegative().default(1),
    maxDurationMs: z.number().positive().optional(),
    /** Shell command materializing the task fixture. Runs after Snapshot.track(), before prompting. */
    setupCommand: z.string().optional(),
    /** Hidden verifier command. Runs after the agent finishes, before snapshot revert. Must exit 0 to pass. */
    verifyCommand: z.string().optional(),
    /** Hard per-case watchdog. The session is cancelled and the case fails when exceeded. */
    timeoutMs: z.number().positive().optional(),
  })
  export const DEFAULT_CASE_TIMEOUT_MS = 300_000
  export const SETUP_TIMEOUT_MS = 60_000
  export const VERIFY_TIMEOUT_MS = 120_000
  export const Suite = z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      grading: z.enum(["strict-v1", "outcome-v2"]).default("strict-v1"),
      cases: z.array(Case).min(1),
    })
    .superRefine((suite, context) => {
      const seen = new Set<string>()
      for (const [index, testCase] of suite.cases.entries()) {
        if (seen.has(testCase.id)) {
          context.addIssue({
            code: "custom",
            path: ["cases", index, "id"],
            message: `duplicate benchmark case id: ${testCase.id}`,
          })
        }
        seen.add(testCase.id)
      }
    })
  export type Suite = z.infer<typeof Suite>

  export interface Execution {
    id: string
    ok: boolean
    sessionID?: string
    error?: string
    verifierPassed?: boolean
    verifierDetail?: string
  }

  export interface Outcome {
    sessionID?: string
    verifierPassed?: boolean
    verifierDetail?: string
  }

  export type Progress =
    | {
        type: "case_started"
        index: number
        total: number
        id: string
        category: z.infer<typeof Case>["category"]
        startedAt: number
      }
    | {
        type: "case_finished"
        index: number
        total: number
        id: string
        ok: boolean
        rateLimited: boolean
        durationMs: number
        sessionID?: string
        error?: string
      }

  export function isRateLimitError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return /rate[ _-]?limit|too many requests|\b429\b|FreeUsageLimitError|resource[_ -]?exhausted|quota\s+(?:exceeded|exhausted)|insufficient\s+quota|usage\s+limit/i.test(
      message,
    )
  }

  export interface ShellResult {
    exitCode: number
    output: string
    timedOut: boolean
  }

  export interface VerifierRelocation {
    /** Directory holding the stashed verify/ trees, undefined when nothing moved. */
    stashRoot: string | undefined
    restore(): Promise<void>
  }

  const VERIFIER_STASH_MANIFEST = "manifest.json"
  const VerifierManifest = z.object({
    casesRoot: z.string(),
    movedAt: z.number(),
    entries: z.array(z.object({ original: z.string(), stash: z.string() })).min(1),
  })

  async function saveVerifierManifest(root: string, value: unknown) {
    const temporary = path.join(root, `manifest-${crypto.randomUUID()}.tmp`)
    try {
      await Bun.write(temporary, JSON.stringify(value, null, 2))
      await fs.rename(temporary, path.join(root, VERIFIER_STASH_MANIFEST))
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  function verifierStashRoot(casesRoot: string) {
    const digest = new Bun.CryptoHasher("sha1").update(casesRoot).digest("hex").slice(0, 12)
    return path.join(Global.Path.home, ".atomcli-eval-verifier-stash", digest)
  }

  /** A worktree-only move cannot remove answers from Git's object database. */
  export async function assertPrivateWorkspace(workspace: string) {
    const run = async (args: string[]) => {
      const proc = Bun.spawn(["git", ...args], { cwd: workspace, stdout: "pipe", stderr: "pipe" })
      const [output, error, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (code !== 0) throw new Error(`Cannot audit benchmark Git workspace: ${error.trim()}`)
      return output.trim()
    }
    const alternate = await run(["rev-parse", "--git-path", "objects/info/alternates"])
    if (process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES || (await Bun.file(path.resolve(workspace, alternate)).exists()))
      throw new Error("Benchmark requires a fresh Git object database without alternates")
    const history = await run(["log", "--all", "--reflog", "-1", "--format=%H", "--", ":(top,glob)**/verify/**"])
    if (history)
      throw new Error("Benchmark verifier sources remain in Git history; use a sanitized disposable workspace")
    const unreachable = await run(["fsck", "--unreachable", "--no-reflogs", "--no-progress"])
    if (unreachable)
      throw new Error("Benchmark Git contains unreachable objects; use a fresh sanitized object database")
    const root = await run(["rev-parse", "--show-toplevel"])
    for (const privateRoot of [verifierStashRoot(workspace), path.join(Global.Path.data, "eval-verifier-stash")]) {
      const relative = path.relative(root, privateRoot)
      if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
        throw new Error("Benchmark verifier stash must be outside the Git workspace")
    }
  }

  async function checkVerifierParents(root: string, location: string) {
    for (let parent = path.dirname(location); ; parent = path.dirname(parent)) {
      const stat = await fs.lstat(parent).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw error
      })
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
        throw new Error(`Verifier case path must be a directory: ${parent}`)
      }
      if (parent === path.resolve(root)) break
    }
  }

  async function restoreVerifier(stash: string, original: string) {
    const parent = path.dirname(original)
    const parentStat = await fs.lstat(parent).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    })
    if (parentStat?.isSymbolicLink() || (parentStat && !parentStat.isDirectory())) {
      throw new Error(`Verifier case path must be a directory: ${parent}`)
    }
    await fs.mkdir(parent, { recursive: true })
    const temporary = `${original}.restore-${crypto.randomUUID()}`
    try {
      await fs.cp(stash, temporary, { recursive: true })
      await fs.rm(original, { recursive: true, force: true })
      await fs.rename(temporary, original)
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }

  async function verifierDirectoryExists(location: string) {
    try {
      const stat = await fs.lstat(location)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Verifier path must be a directory: ${location}`)
      }
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
      throw error
    }
  }

  /**
   * Puts verifier sources of a previously interrupted run back into the
   * worktree. Returns true when a stash existed and was restored.
   */
  export async function restoreStashedVerifiers(casesRoot: string, stashRoot?: string): Promise<boolean> {
    if (!stashRoot) {
      const digest = new Bun.CryptoHasher("sha1").update(casesRoot).digest("hex").slice(0, 12)
      const legacy = path.join(Global.Path.data, "eval-verifier-stash", digest)
      const recovered = await restoreStashedVerifiers(casesRoot, legacy)
      return (await restoreStashedVerifiers(casesRoot, verifierStashRoot(casesRoot))) || recovered
    }
    const root = stashRoot ?? verifierStashRoot(casesRoot)
    const file = Bun.file(path.join(root, VERIFIER_STASH_MANIFEST))
    if (!(await file.exists())) return false
    const manifest = VerifierManifest.parse(await file.json())
    if (path.resolve(manifest.casesRoot) !== path.resolve(casesRoot)) {
      throw new Error(`Verifier stash belongs to another cases root: ${manifest.casesRoot}`)
    }
    for (const entry of manifest.entries) {
      const relative = path.relative(casesRoot, entry.original)
      const parts = relative.split(path.sep)
      if (
        parts.length < 2 ||
        parts.includes("..") ||
        path.isAbsolute(relative) ||
        parts.at(-1) !== "verify" ||
        parts.slice(0, -1).includes("verify") ||
        entry.original !== path.join(casesRoot, relative) ||
        entry.stash !== path.join(root, relative)
      ) {
        throw new Error(`Invalid verifier stash entry: ${entry.original}`)
      }
      await checkVerifierParents(casesRoot, path.resolve(entry.original))
      await checkVerifierParents(root, path.resolve(entry.stash))
    }
    for (const entry of manifest.entries) {
      if (!(await verifierDirectoryExists(entry.stash))) {
        if (!(await verifierDirectoryExists(entry.original))) {
          throw new Error(`Verifier is missing from both source and stash: ${entry.original}`)
        }
        continue
      }
      await restoreVerifier(entry.stash, entry.original)
    }
    await fs.rm(root, { recursive: true, force: true })
    return true
  }

  /**
   * Hides verifier sources from the agent under test. While a run is active,
   * every verify/ directory beneath the cases root, including nested copies,
   * is moved out of the worktree into a stash —
   * Git history must be audited separately by assertPrivateWorkspace.
   * The stash lives outside the auto-trusted AtomCLI data directory and
   * carries a manifest, so even a hard kill is recoverable: the next call to
   * relocateVerifierSources self-heals, and signal handlers restore on exit.
   */
  export async function relocateVerifierSources(
    casesRoot: string,
    explicitStashRoot?: string,
  ): Promise<VerifierRelocation> {
    const stashRoot = explicitStashRoot ?? verifierStashRoot(casesRoot)
    // A crashed predecessor may have left its stash behind — heal before moving.
    await restoreStashedVerifiers(casesRoot, explicitStashRoot)

    const verifiers: string[] = []
    async function discover(directory: string) {
      for (const entry of await fs.readdir(directory)) {
        const location = path.join(directory, entry)
        if (entry === "verify" && directory !== casesRoot) {
          if (await verifierDirectoryExists(location)) verifiers.push(location)
          continue
        }
        const stat = await fs.lstat(location)
        if (stat.isSymbolicLink()) throw new Error(`Verifier case path must not be a symbolic link: ${location}`)
        if (stat.isDirectory()) await discover(location)
      }
    }
    await discover(casesRoot)
    const moved: Array<{ original: string; stash: string }> = []
    for (const verify of verifiers) {
      // Keep the "verify" level in the stash so staging copies stay uniform.
      const stash = path.join(stashRoot, path.relative(casesRoot, verify))
      await fs.mkdir(stashRoot, { recursive: true, mode: 0o700 })
      await fs.chmod(stashRoot, 0o700)
      await fs.mkdir(path.dirname(stash), { recursive: true, mode: 0o700 })
      moved.push({ original: verify, stash })
      // Persist recovery intent before moving the verifier. A hard kill
      // between rename and the old end-of-loop manifest left hidden sources
      // with no record of where to restore them.
      await saveVerifierManifest(stashRoot, { casesRoot, movedAt: Date.now(), entries: moved })
      await fs.rename(verify, stash).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error
        // Cross-device fallback: stage the complete copy beside the stash,
        // then rename it atomically. An interrupted copy leaves the source
        // intact and the manifest does not point at partial verifier data.
        const partial = `${stash}.partial-${crypto.randomUUID()}`
        try {
          await fs.cp(verify, partial, { recursive: true })
          await fs.rename(partial, stash)
          await fs.rm(verify, { recursive: true, force: true })
        } finally {
          await fs.rm(partial, { recursive: true, force: true })
        }
      })
    }
    if (moved.length === 0) return { stashRoot: undefined, restore: async () => {} }

    let restored = false
    return {
      stashRoot,
      async restore() {
        if (restored) return
        await restoreStashedVerifiers(casesRoot, stashRoot)
        restored = true
      },
    }
  }

  /** Run a shell command with a hard timeout; combined output is truncated for diagnostics. */
  export async function shell(
    command: string,
    options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<ShellResult> {
    const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: options.env ? { ...process.env, ...options.env } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const exitCode = await proc.exited
    const timedOut = exitCode === 143 || exitCode === 124
    const output = `${stderr}
${stdout}`.trim()
    return { exitCode, output: output.length > 2_000 ? `…${output.slice(-2_000)}` : output, timedOut }
  }

  export function bucket(suite: Suite) {
    const label = `${suite.name}-${suite.version}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 80)
    const digest = new Bun.CryptoHasher("sha1")
      .update(
        `${suite.name}
${suite.version}${suite.grading === "outcome-v2" ? "\noutcome-v2" : ""}`,
      )
      .digest("hex")
      .slice(0, 12)
    return `benchmark-${label}-${digest}`
  }

  /** Execute every case sequentially so workspace mutations remain deterministic. */
  export async function run(
    suite: Suite,
    execute: (testCase: z.infer<typeof Case>) => Promise<Outcome | void>,
    collect: () => Promise<AgentEval.Result[]>,
    onProgress?: (event: Progress) => void,
  ) {
    const executions: Execution[] = []
    const verifiers = new Map<string, { passed?: boolean; detail?: string }>()
    const emit = (event: Progress) => {
      try {
        onProgress?.(event)
      } catch {
        // Progress is presentation-only and must never affect benchmark results.
      }
    }
    for (const [offset, testCase] of suite.cases.entries()) {
      const index = offset + 1
      const startedAt = Date.now()
      emit({
        type: "case_started",
        index,
        total: suite.cases.length,
        id: testCase.id,
        category: testCase.category,
        startedAt,
      })
      try {
        const result: Outcome = ((await execute(testCase)) as Outcome | undefined) ?? {}
        const execution: Execution = {
          id: testCase.id,
          ok: true,
          sessionID: result.sessionID,
          verifierPassed: result.verifierPassed,
          verifierDetail: result.verifierDetail,
        }
        if (testCase.verifyCommand)
          verifiers.set(testCase.id, { passed: result.verifierPassed, detail: result.verifierDetail })
        executions.push(execution)
        emit({
          type: "case_finished",
          index,
          total: suite.cases.length,
          id: testCase.id,
          ok: true,
          rateLimited: false,
          durationMs: Date.now() - startedAt,
          sessionID: execution.sessionID,
        })
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error).slice(0, 1_000)
        const rateLimited = isRateLimitError(error)
        executions.push({
          id: testCase.id,
          ok: false,
          error: message,
        })
        emit({
          type: "case_finished",
          index,
          total: suite.cases.length,
          id: testCase.id,
          ok: false,
          rateLimited,
          durationMs: Date.now() - startedAt,
          error: message,
        })
        // A provider-wide limit will make every remaining case fail while consuming
        // retries. Leave untouched cases unobserved and end this run immediately.
        if (rateLimited) break
      }
    }
    return { executions, ...evaluate(suite, await collect(), verifiers, executions) }
  }

  export function evaluate(
    suite: Suite,
    results: AgentEval.Result[],
    verifiers?: Map<string, { passed?: boolean; detail?: string }>,
    executions: Execution[] = [],
  ) {
    const cases = suite.cases.map((testCase) => {
      const matches = results.filter((result) => result.id === testCase.id)
      const latest = matches.sort((a, b) => b.timestamp - a.timestamp)[0]
      const failures: string[] = []
      const penalties: { reason: string; points: number }[] = []
      const penalize = (reason: string, points: number) => {
        if (suite.grading === "outcome-v2") penalties.push({ reason, points })
        else failures.push(reason)
      }
      const execution = executions.find((item) => item.id === testCase.id)
      if (execution?.ok === false) failures.push(`execution failed${execution.error ? `: ${execution.error}` : ""}`)
      if (!latest) failures.push("missing observation")
      else {
        if (!latest.success) failures.push("task was not successful")
        if (testCase.requiresTools && latest.toolCalls === 0) failures.push("expected tool usage")
        if (testCase.expectsTests && latest.testsPassed !== true) failures.push("tests did not pass")
        if (latest.toolErrors > testCase.maxToolErrors)
          penalize(
            `tool errors ${latest.toolErrors} > ${testCase.maxToolErrors}`,
            Math.min(10, (latest.toolErrors - testCase.maxToolErrors) * 2),
          )
        if (latest.retries > testCase.maxRetries)
          penalize(
            `retries ${latest.retries} > ${testCase.maxRetries}`,
            Math.min(5, latest.retries - testCase.maxRetries),
          )
        if (testCase.maxDurationMs && latest.durationMs > testCase.maxDurationMs)
          penalize(
            `duration ${latest.durationMs}ms > ${testCase.maxDurationMs}ms`,
            Math.min(5, Math.ceil((latest.durationMs / testCase.maxDurationMs - 1) * 5)),
          )
      }
      // Hidden-verifier ground truth outranks trajectory signals. A case with a
      // verifier can only pass when that verifier actually ran and exited 0.
      if (testCase.verifyCommand) {
        const verdict = verifiers?.get(testCase.id)
        if (!verdict || verdict.passed === undefined) failures.push("hidden verifier was not run")
        else if (verdict.passed === false)
          failures.push(`hidden verifier failed${verdict.detail ? `: ${verdict.detail}` : ""}`)
      } else if (suite.grading === "outcome-v2") failures.push("independent verifier is required")
      const passed = failures.length === 0
      return {
        id: testCase.id,
        passed,
        failures,
        penalties,
        score: passed ? 100 - penalties.reduce((sum, item) => sum + item.points, 0) : 0,
        observation: latest,
      }
    })
    const observed = cases.filter((item) => !!item.observation).length
    const passed = cases.filter((item) => item.passed).length
    return {
      suite: suite.name,
      version: suite.version,
      grading: suite.grading,
      total: cases.length,
      observed,
      passed,
      passRate: cases.length ? passed / cases.length : 0,
      score: cases.length
        ? Math.round((cases.reduce((sum, item) => sum + item.score, 0) / cases.length) * 100) / 100
        : 0,
      accepted: passed === cases.length,
      ready: observed === cases.length,
      cases,
    }
  }
}
