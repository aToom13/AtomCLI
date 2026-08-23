import { cmd } from "./cmd"
import { Instance } from "@/services/project/instance"
import { AgentEval } from "@/core/eval/harness"
import { AgentBenchmark } from "@/core/eval/benchmark"
import { EvalProgress } from "./eval-progress"
import { EvalPicker } from "./eval-picker"
import path from "path"
import os from "os"
import fs from "fs/promises"

/** Grace period between cancelling a timed-out session and abandoning the await. */
const WATCHDOG_GRACE_MS = 15_000

export const EvalCommand = cmd({
  command: "eval <action> [file]",
  describe: "record and summarize reproducible agent-quality evaluations",
  builder: (yargs) =>
    yargs
      .positional("action", { choices: ["record", "report", "benchmark"] as const, demandOption: true })
      .positional("file", { type: "string", describe: "JSON observation file for eval record" })
      .option("suite", { type: "string", default: "default" })
      .option("execute", {
        type: "boolean",
        default: false,
        describe: "run benchmark cases in the current workspace before reporting",
      })
      .option("model", { type: "string", describe: "provider/model used for benchmark execution" })
      .option("agent", { type: "string", default: "build", describe: "agent used for benchmark execution" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (args.action === "record") {
          if (!args.file) throw new Error("eval record requires a JSON observation file")
          const result = await AgentEval.record(await Bun.file(args.file).json())
          console.log(JSON.stringify(result, null, 2))
          return
        }
        if (args.action === "benchmark") {
          const suitePath = args.file ? path.resolve(args.file) : path.join(import.meta.dir, "../../../../evals/atomcli.json")
          const suite = AgentBenchmark.Suite.parse(await Bun.file(suitePath).json())
          const suiteName = AgentBenchmark.bucket(suite)
          if (!args.execute) {
            const results = await AgentEval.list(suiteName)
            console.log(
              JSON.stringify(
                {
                  mode: "report",
                  bucket: suiteName,
                  hint: "Pass --execute to run every case in the current workspace before reporting.",
                  ...AgentBenchmark.evaluate(suite, results),
                },
                null,
                2,
              ),
            )
            return
          }
          const [{ Session }, { SessionPrompt }, { SessionSummary }, { Provider }] = await Promise.all([
            import("@/core/session"),
            import("@/core/session/prompt"),
            import("@/core/session/summary"),
            import("@/integrations/provider/provider"),
          ])
          if (Instance.project.vcs !== "git")
            throw new Error("benchmark --execute requires a git workspace for per-case snapshot isolation")
          const { Snapshot } = await import("@/core/snapshot")
          // Explicit --model keeps the run fully non-interactive. Otherwise, on a
          // real terminal, offer the provider/model/agent menus; pipes fall back
          // to defaults so CI and scripted runs never hang on a prompt.
          const picked = !args.model && EvalPicker.enabled() ? await EvalPicker.select() : undefined
          const model = picked
            ? picked.model
            : args.model
              ? Provider.parseModel(args.model)
              : await Provider.defaultModel()
          const agentName = picked?.agent ?? args.agent
          const runID = crypto.randomUUID()
          const progress = EvalProgress.create({
            stream: process.stderr,
            suite: suite.name,
            version: suite.version,
            model: `${model.providerID}/${model.modelID}`,
            total: suite.cases.length,
          })
          // Hidden verifier sources are relocated out of the worktree into a
          // stashed, manifest-backed location for the whole run so the agent
          // under test cannot read expected answers from the repository.
          const workspace = process.cwd()
          const suiteDir = path.dirname(suitePath)
          const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-eval-"))
          const relocation = await AgentBenchmark.relocateVerifierSources(path.join(suiteDir, "cases"))
          // Ctrl+C and termination must put verifier sources back before exit;
          // the finally below only covers ordinary exceptions.
          const restoreOnSignal = () => {
            void Promise.resolve(relocation.restore()).finally(() => process.exit(130))
          }
          for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, restoreOnSignal)
          let report: Awaited<ReturnType<typeof AgentBenchmark.run>>
          let progressFailed = true
          try {
            report = await AgentBenchmark.run(
              suite,
              async (testCase) => {
                const session = await Session.create({ title: `Benchmark: ${testCase.id}` })
                const baseline = await Snapshot.track()
                if (!baseline) throw new Error("could not create the benchmark case snapshot")
                const sharedEnv = {
                  ATOMCLI_EVAL_WORKSPACE: workspace,
                  ATOMCLI_EVAL_SANDBOX: sandboxRoot,
                  ATOMCLI_EVAL_SUITE_DIR: suiteDir,
                }
                // Fixture setup runs after the snapshot so per-case revert also
                // removes everything the setup materialized.
                if (testCase.setupCommand) {
                  const setup = await AgentBenchmark.shell(testCase.setupCommand, {
                    cwd: workspace,
                    timeoutMs: AgentBenchmark.SETUP_TIMEOUT_MS,
                    env: sharedEnv,
                  })
                  if (setup.exitCode !== 0)
                    throw new Error(
                      `setup failed for case ${testCase.id}: ${setup.output.slice(-400) || `exit code ${setup.exitCode}`}`,
                    )
                }
                AgentEval.registerBenchmark(session.id, { suite: suiteName, caseID: testCase.id, runID })
                let primaryError: unknown
                let timedOutAt = 0
                let poll: ReturnType<typeof setInterval> | undefined
                try {
                  // Watchdog: cancel the session when the case exceeds its budget,
                  // then abandon the await after a grace period so a stuck tool call
                  // can never freeze the whole benchmark again.
                  const watchdog =
                    testCase.timeoutMs === undefined
                      ? undefined
                      : setTimeout(() => {
                          timedOutAt = Date.now()
                          SessionPrompt.cancel(session.id)
                        }, testCase.timeoutMs)
                  try {
                    const outcome = await Promise.race([
                      SessionPrompt.prompt({
                        sessionID: session.id,
                        agent: agentName,
                        model,
                        parts: [
                          {
                            type: "text",
                            text:
                              `${testCase.prompt}\n\nThis is an isolated AtomCLI benchmark case. ` +
                              `Complete the task in the current workspace (${workspace}) and verify the result.`,
                          },
                        ],
                      }).then(
                        (value) => ({ kind: "prompt", value }) as const,
                        (error) => ({ kind: "error", error }) as const,
                      ),
                      new Promise<{ kind: "timeout" }>((resolve) => {
                        if (!watchdog) return
                        poll = setInterval(() => {
                          if (!timedOutAt || Date.now() - timedOutAt < WATCHDOG_GRACE_MS) return
                          clearInterval(poll)
                          resolve({ kind: "timeout" })
                        }, 250)
                      }),
                    ])
                    if (outcome.kind === "timeout") {
                      try {
                        const messages = await Session.messages({ sessionID: session.id, excludePatches: true })
                        await AgentEval.recordSession(session.id, messages)
                      } catch {
                        // Partial telemetry is best-effort on timeout.
                      }
                      throw new Error(`case timed out after ${testCase.timeoutMs}ms`)
                    }
                    if (outcome.kind === "error") {
                      // The watchdog cancelled this session; report the budget breach,
                      // not the resulting abort noise.
                      if (timedOutAt) throw new Error(`case timed out after ${testCase.timeoutMs}ms`)
                      throw outcome.error
                    }
                    const response = outcome.value
                    if (timedOutAt) throw new Error(`case timed out after ${testCase.timeoutMs}ms`)
                    if (response.info.role === "assistant" && response.info.error) {
                      const failure = response.info.error as any
                      const message =
                        failure?.data?.message ?? failure?.message ?? failure?.name ?? "model returned an unknown error"
                      throw new Error(String(message))
                    }
                    const messages = await Session.messages({ sessionID: session.id, excludePatches: true })
                    await AgentEval.recordSession(session.id, messages)

                    // Hidden verifier: the agent has finished and the workspace is
                    // still pre-revert. Verifier sources live in the run sandbox —
                    // each case gets a fresh private copy that is deleted right
                    // after the verdict, so later cases cannot read earlier ones.
                    let verifierPassed: boolean | undefined
                    let verifierDetail: string | undefined
                    if (testCase.verifyCommand) {
                      const verifyEnv: Record<string, string> = { ...sharedEnv }
                      // Stage as $SANDBOX/<case-id>/verify so verifier scripts can
                      // also write per-case logs next to it ($SANDBOX/<case-id>/).
                      const verifySource = relocation.stashRoot
                        ? path.join(relocation.stashRoot, testCase.id, "verify")
                        : undefined
                      if (verifySource && (await fs.stat(verifySource).catch(() => null))?.isDirectory()) {
                        const verifyTarget = path.join(sandboxRoot, testCase.id, "verify")
                        await fs.cp(verifySource, verifyTarget, { recursive: true })
                        verifyEnv.ATOMCLI_EVAL_VERIFY_DIR = verifyTarget
                      }
                      try {
                        const verdict = await AgentBenchmark.shell(testCase.verifyCommand, {
                          cwd: workspace,
                          timeoutMs: AgentBenchmark.VERIFY_TIMEOUT_MS,
                          env: verifyEnv,
                        })
                        verifierPassed = verdict.exitCode === 0
                        if (!verifierPassed) verifierDetail = verdict.output.slice(-400) || `exit code ${verdict.exitCode}`
                      } finally {
                        await fs.rm(path.join(sandboxRoot, testCase.id), { recursive: true, force: true }).catch(() => {})
                      }
                    }
                    return { sessionID: session.id, verifierPassed, verifierDetail }
                  } finally {
                    if (poll) clearInterval(poll)
                    if (watchdog) clearTimeout(watchdog)
                  }
                } catch (error) {
                  primaryError = error
                  throw error
                } finally {
                  try {
                    const patch = await Snapshot.patch(baseline)
                    await Snapshot.revert([patch])
                  } catch (cleanupError) {
                    if (!primaryError) throw cleanupError
                  } finally {
                    SessionSummary.cancelPendingSummarize(session.id)
                    AgentEval.unregisterBenchmark(session.id)
                  }
                }
              },
              async () => (await AgentEval.list(suiteName)).filter((result) => result.promptVersion === runID),
              progress.update,
            )
            progressFailed = false
          } finally {
            progress.finish(progressFailed)
            for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, restoreOnSignal)
            // Put verifier sources back into the worktree no matter how the run ended.
            await relocation.restore()
            await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => {})
          }
          console.log(
            JSON.stringify(
              { mode: "execute", runID, bucket: suiteName, model: `${model.providerID}/${model.modelID}`, ...report },
              null,
              2,
            ),
          )
          return
        }
        const results = await AgentEval.list(args.suite)
        console.log(JSON.stringify({ suite: args.suite, ...AgentEval.summarize(results) }, null, 2))
      },
    })
  },
})
