import { cmd } from "./cmd"
import { Instance } from "@/services/project/instance"
import { AgentEval } from "@/core/eval/harness"
import { AgentBenchmark } from "@/core/eval/benchmark"
import { EvalProgress } from "./eval-progress"
import path from "path"

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
          const suitePath = args.file ?? path.join(import.meta.dir, "../../../../evals/atomcli.json")
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
          const model = args.model ? Provider.parseModel(args.model) : await Provider.defaultModel()
          const runID = crypto.randomUUID()
          const progress = EvalProgress.create({
            stream: process.stderr,
            suite: suite.name,
            version: suite.version,
            model: `${model.providerID}/${model.modelID}`,
            total: suite.cases.length,
          })
          let report: Awaited<ReturnType<typeof AgentBenchmark.run>>
          let progressFailed = true
          try {
            report = await AgentBenchmark.run(
              suite,
              async (testCase) => {
                const session = await Session.create({ title: `Benchmark: ${testCase.id}` })
                const baseline = await Snapshot.track()
                if (!baseline) throw new Error("could not create the benchmark case snapshot")
                AgentEval.registerBenchmark(session.id, { suite: suiteName, caseID: testCase.id, runID })
                let primaryError: unknown
                try {
                  const response = await SessionPrompt.prompt({
                    sessionID: session.id,
                    agent: args.agent,
                    model,
                    parts: [
                      {
                        type: "text",
                        text: `${testCase.prompt}\n\nThis is an isolated AtomCLI benchmark case. Complete the task in the current workspace and verify the result.`,
                      },
                    ],
                  })
                  if (response.info.role === "assistant" && response.info.error) {
                    const failure = response.info.error as any
                    const message =
                      failure?.data?.message ?? failure?.message ?? failure?.name ?? "model returned an unknown error"
                    throw new Error(String(message))
                  }
                  const messages = await Session.messages({ sessionID: session.id })
                  await AgentEval.recordSession(session.id, messages)
                  return { sessionID: session.id }
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
