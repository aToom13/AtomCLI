import "./shim"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "@/interfaces/cli/cmd/run"
import { GenerateCommand } from "@/interfaces/cli/cmd/generate"
import { Log } from "@/util/util/log"
import { AuthCommand } from "@/interfaces/cli/cmd/auth"
import { AgentCommand } from "@/interfaces/cli/cmd/agent"
import { UpgradeCommand } from "@/interfaces/cli/cmd/upgrade"
import { UninstallCommand } from "@/interfaces/cli/cmd/uninstall"
import { ModelsCommand } from "@/interfaces/cli/cmd/models"
import { UI } from "@/interfaces/cli/ui"
import { Installation } from "@/services/installation"
import { NamedError } from "@atomcli/util/error"
import { FormatError } from "@/interfaces/cli/error"
import { ServeCommand } from "@/interfaces/cli/cmd/serve"
import { DebugCommand } from "@/interfaces/cli/cmd/debug"
import { StatsCommand } from "@/interfaces/cli/cmd/stats"
import { McpCommand } from "@/interfaces/cli/cmd/mcp"
import { SkillCommand } from "@/interfaces/cli/cmd/skill"
import { GithubCommand } from "@/interfaces/cli/cmd/github"
import { ExportCommand } from "@/interfaces/cli/cmd/export"
import { ImportCommand } from "@/interfaces/cli/cmd/import"
import { AttachCommand } from "@/interfaces/cli/cmd/tui/attach"
import { TuiThreadCommand } from "@/interfaces/cli/cmd/tui/thread"
import { TuiSpawnCommand } from "@/interfaces/cli/cmd/tui/spawn"
import { AcpCommand } from "@/interfaces/cli/cmd/acp"
import { EOL } from "os"
import { PrCommand } from "@/interfaces/cli/cmd/pr"
import { SessionCommand } from "@/interfaces/cli/cmd/session"
import { FlowCommand } from "@/interfaces/cli/cmd/flow"
import { FeaturesCommand } from "@/interfaces/cli/cmd/features"
import { TestGenCommand } from "@/interfaces/cli/cmd/test-gen"
import { DocsCommand } from "@/interfaces/cli/cmd/docs"
import { SecurityCommand } from "@/interfaces/cli/cmd/security"
import { ReviewCommand } from "@/interfaces/cli/cmd/review"
import { PerfCommand } from "@/interfaces/cli/cmd/perf"
import { RefactorCommand } from "@/interfaces/cli/cmd/refactor"
import { WorkspaceCommand } from "@/interfaces/cli/cmd/workspace"
import { SetupCommand } from "@/interfaces/cli/cmd/setup"
import { MemoryCommand } from "@/interfaces/cli/cmd/memory"
import { FallbackCommand } from "@/interfaces/cli/cmd/fallback"
import { AutoupdateCommand } from "@/interfaces/cli/cmd/autoupdate"
import { SmartModelCommand } from "@/interfaces/cli/cmd/smart-model"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("atomcli")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })

  .option("uninstall", {
    describe: "uninstall atomcli",
    type: "boolean",
    hidden: true,
  })
  .middleware(async (opts) => {
    if (opts.uninstall) {
      // @ts-ignore
      await UninstallCommand.handler({})
      process.exit(0)
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.ATOMCLI = "1"

    Log.Default.info("atomcli", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(SkillCommand)
  .command(TuiThreadCommand)
  .command(TuiSpawnCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(FlowCommand)
  .command(FeaturesCommand)
  .command(TestGenCommand)
  .command(DocsCommand)
  .command(SecurityCommand)
  .command(ReviewCommand)
  .command(PerfCommand)
  .command(RefactorCommand)
  .command(WorkspaceCommand)
  .command(SetupCommand)
  .command(MemoryCommand)
  .command(FallbackCommand)
  .command(AutoupdateCommand)
  .command(SmartModelCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
