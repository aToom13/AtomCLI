import { cmd } from "../cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { Instance } from "../../../project/instance"
import { MCP_REGISTRY } from "./utils"

export const McpInstallCommand = cmd({
    command: "install <name>",
    describe: "install an MCP server from registry or npm package",
    builder: (yargs) =>
        yargs
            .positional("name", {
                type: "string",
                describe: "registry name (e.g., 'filesystem') or npm package (e.g., '@mcp/server-custom')",
                demandOption: true,
            })
            .option("args", {
                type: "array",
                describe: "arguments to pass to the MCP server",
                default: [],
            }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("Install MCP Server")

                const name = args.name
                const registryEntry = MCP_REGISTRY[name]
                const packageName = registryEntry?.package ?? name
                const serverName = name.replace(/^@.*\//, "").replace(/^server-/, "")

                prompts.log.info(`Package: ${packageName}`)
                if (registryEntry?.description) {
                    prompts.log.info(`Description: ${registryEntry.description}`)
                }

                const spinner = prompts.spinner()
                spinner.start("Configuring MCP server...")

                try {
                    // Build command array
                    const commandArgs = ["npx", "-y", packageName, ...(registryEntry?.defaultArgs ?? []), ...((args.args ?? []) as string[])]

                    spinner.stop("Configuration ready!")

                    prompts.log.info("Add this to your atomcli.json:")
                    prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "local",
      "command": ${JSON.stringify(commandArgs)}
    }
  }`)

                    prompts.outro("After adding, run `atomcli mcp list` to verify")
                } catch (error) {
                    spinner.stop("Failed", 1)
                    prompts.log.error(error instanceof Error ? error.message : String(error))
                    prompts.outro("")
                }
            },
        })
    },
})
