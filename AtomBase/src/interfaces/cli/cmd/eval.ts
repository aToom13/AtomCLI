import { cmd } from "./cmd"
import { Instance } from "@/services/project/instance"
import { AgentEval } from "@/core/eval/harness"

export const EvalCommand = cmd({
  command: "eval <action> [file]",
  describe: "record and summarize reproducible agent-quality evaluations",
  builder: (yargs) =>
    yargs
      .positional("action", { choices: ["record", "report"] as const, demandOption: true })
      .positional("file", { type: "string", describe: "JSON observation file for eval record" })
      .option("suite", { type: "string", default: "default" }),
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
        const results = await AgentEval.list(args.suite)
        console.log(JSON.stringify({ suite: args.suite, ...AgentEval.summarize(results) }, null, 2))
      },
    })
  },
})
