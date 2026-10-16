import type { LedgerTypes as ExecutionLedger } from "./ledger/types"
import { Lock } from "@/util/util/lock"
import path from "path"
import fs from "fs/promises"
import { StaticGate } from "@/core/verification/static-gate"
import { Log } from "@/util/util/log"
import z from "zod"
import { ExecutionWorld } from "./world"

const AUTOMATIC_CHECK_TIMEOUT_MS = 120_000
const MAX_CHECK_OUTPUT_BYTES = 10_000
const MAX_STATIC_BYTES = 20 * 1024 * 1024
const LOG = Log.create({ service: "automatic-static-verification" })

export namespace TaskVerification {
  export const BuildSnapshot = z.object({
    files: z.array(z.string()),
    digest: z.string(),
    workdir: z.string(),
  })
  export type BuildSnapshot = z.infer<typeof BuildSnapshot>

  export function isBuildCommand(command: string) {
    return /(?:^|&&|\|\||[;\n])\s*(?:[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_./:-]+\s+)*(?:bun\s+(?:build|run\s+build)|(?:npm|pnpm)\s+run\s+build|yarn\s+build|cargo\s+build|go\s+build)\b/.test(
      command,
    )
  }

  function withinWorkdir(files: string[], workdir: string, cwd: string) {
    return [...new Set(files.map((file) => path.resolve(cwd, file)))]
      .filter((file) => {
        const relative = path.relative(workdir, file)
        return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      })
      .sort()
  }

  export async function buildSnapshot(files: string[], workdir: string, cwd: string) {
    const { contentSnapshotDigest } = await import("./runtime/policy")
    const inputs = withinWorkdir(files, workdir, cwd)
    return { files: inputs, workdir, digest: await contentSnapshotDigest(inputs) }
  }

  export async function staleBuildChecks(
    builds: { command: string; timestamp: number; snapshot: BuildSnapshot }[],
    files: string[],
    cwd: string,
  ) {
    const latest = new Map<string, (typeof builds)[number]>()
    for (const build of [...builds].sort((a, b) => a.timestamp - b.timestamp))
      latest.set(`${build.snapshot.workdir}\0${build.command.trim()}`, build)
    const failures: string[] = []
    for (const build of latest.values()) {
      // ponytail: tracked inputs within the build workdir; custom build systems need an explicit input manifest.
      const current = await buildSnapshot([...build.snapshot.files, ...files], build.snapshot.workdir, cwd)
      if (current.digest !== build.snapshot.digest) failures.push(`source changed after build: ${build.command}`)
    }
    return failures
  }

  export async function taskFiles(task: ExecutionLedger.Task, cwd: string) {
    const { HarnessState } = await import("@/core/session/harness-state")
    const owns = task.execution?.owns ?? []
    const changed = [
      ...HarnessState.getEditedFiles(task.owner),
      ...(task.sessionID ? HarnessState.getEditedFiles(task.sessionID) : []),
    ].filter((file) => {
      const relative = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/")
      return !owns.length || owns.some((owned) => !owned || relative === owned || relative.startsWith(`${owned}/`))
    })
    return changed
  }

  export async function staticChecks(files: string[], cwd: string, sessionID?: string) {
    const readRules = sessionID
      ? await (async () => {
          const { Config } = await import("@/core/config/config")
          const { Session } = await import("@/core/session")
          const { Storage } = await import("@/core/storage/storage")
          const { PermissionNext } = await import("@/util/permission/next")
          // Some integrations return an ephemeral child ID without persisting a
          // session (for example, test or external runtimes). Static checks still
          // apply; there is simply no session permission context to merge.
          const loadSession = async (id: string) => {
            try {
              return await Session.get(id)
            } catch (error) {
              if (error instanceof Storage.NotFoundError) return undefined
              throw error
            }
          }
          const session = await loadSession(sessionID)
          const parent = session?.parentID ? await loadSession(session.parentID) : undefined
          return [
            PermissionNext.merge(
              PermissionNext.fromConfig((await Config.get()).permission ?? {}),
              session?.permission ?? [],
            ),
            parent?.permission ?? [],
          ]
        })()
      : []
    const checks: { file: string; ok: boolean; evidence: string }[] = []
    for (const name of [...new Set(files)].sort()) {
      if (!/\.(?:[cm]?js|jsx|tsx?|html?)$/i.test(name)) continue
      const file = path.resolve(cwd, name)
      let evidence: string
      let ok = false
      try {
        const canonical = await fs.realpath(file)
        const relative = path.relative(cwd, canonical)
        if (
          canonical !== file &&
          (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        )
          throw new Error("Static check target leaves its workspace through a symlink")
        if (readRules.length) {
          const { PermissionNext } = await import("@/util/permission/next")
          const denied = readRules
            .flatMap((rules) => [file, canonical].map((target) => PermissionNext.evaluate("read", target, rules)))
            .filter((rule) => rule.action === "deny")
          if (denied.length) throw new PermissionNext.DeniedError(denied)
        }
        const input = Bun.file(canonical)
        const stat = await input.stat()
        if (!stat.isFile()) throw new Error("Static check target is not a file")
        if (stat.size > MAX_STATIC_BYTES) throw new Error("Static check exceeds 20 MiB limit")
        const source = await input.text()
        const result = StaticGate.checkFile(file, source)
        ok = result.ok
        evidence = `${StaticGate.format(result, file)}\nsha256=${new Bun.CryptoHasher("sha256").update(source).digest("hex")}`
      } catch (error) {
        // Deleted source is not an artifact to verify; every other read failure blocks completion.
        if (
          (error as NodeJS.ErrnoException).code === "ENOENT" &&
          !(await fs.lstat(file).catch(() => undefined))?.isSymbolicLink()
        )
          continue
        evidence = `Static gate failed (${file}): ${String(error)}`
      }
      evidence = evidence.slice(0, MAX_CHECK_OUTPUT_BYTES)
      checks.push({ file, ok, evidence })
      LOG.info("static_check", { sessionID, file, ok, evidence })
      if (sessionID) {
        const { HarnessState } = await import("@/core/session/harness-state")
        HarnessState.pushExecutionLog(sessionID, {
          command: `static_check ${file}`,
          workdir: cwd,
          output: evidence,
          exitCode: ok ? 0 : 1,
        })
      }
    }
    return checks
  }

  export async function assertStaticChecks(files: string[], cwd: string, sessionID?: string) {
    const checks = await staticChecks(files, cwd, sessionID)
    const failures = checks.filter((check) => !check.ok)
    if (failures.length)
      throw new Error(`STATIC_VERIFICATION_FAILED: ${failures.map((check) => check.evidence).join("\n")}`)
    return checks
  }
}

export async function runAutomaticTaskChecks(
  acceptance: ExecutionLedger.TaskAcceptance[],
  cwd: string,
  guard?: { sessionID: string; execution: ExecutionLedger.Context; taskID: string; expectedVersion: number },
): Promise<ExecutionLedger.AutomaticTaskCheckInput[]> {
  const results = await Promise.allSettled(
    acceptance
      .filter((criterion) => criterion.verification === "automatic")
      .map(async (criterion) => {
        if (!criterion.command) throw new Error(`Automatic acceptance criterion "${criterion.id}" is missing a command`)
        const shell = Bun.which("bash") ?? "sh"
        const spawn = () =>
          Bun.spawn([shell, ...ExecutionWorld.shellArguments(shell, criterion.command!)], {
            cwd,
            stdout: "pipe",
            stderr: "pipe",
          })
        let process: ReturnType<typeof spawn>
        {
          using _lock = guard ? await Lock.write(`execution-tasks:${guard.execution.executionID}`) : undefined
          if (guard) {
            const { ExecutionRuntime } = await import("./runtime")
            await ExecutionRuntime.assertAtomicReady(guard)
          }
          process = spawn()
        }
        const timeout = setTimeout(() => process.kill(), AUTOMATIC_CHECK_TIMEOUT_MS)
        try {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
          ])
          const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim().slice(0, MAX_CHECK_OUTPUT_BYTES)
          return {
            criterionID: criterion.id,
            command: criterion.command,
            exitCode,
            evidence: output || "No output",
          }
        } finally {
          clearTimeout(timeout)
        }
      }),
  )
  const failed = results.find((result) => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
  return results.map((result) => (result as PromiseFulfilledResult<ExecutionLedger.AutomaticTaskCheckInput>).value)
}
