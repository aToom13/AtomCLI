import { cmd } from "../cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { Instance } from "@/services/project/instance"
import { Global } from "@/core/global"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"

export const McpRemoveCommand = cmd({
    command: "remove <name>",
    describe: "remove an MCP server",
    builder: (yargs) =>
        yargs.positional("name", {
            type: "string",
            describe: "name of the MCP server to remove",
            demandOption: true,
        }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("Remove MCP Server")

                const name = args.name
                const configPath = path.join(Global.Path.config, "mcp.json")

                if (!existsSync(configPath)) {
                    prompts.log.error(`Configuration file not found at ${configPath}`)
                    prompts.outro("No MCP servers configured (mcp.json missing)")
                    return
                }

                try {
                    const content = await fs.readFile(configPath, "utf-8")
                    let config: Record<string, any> = {}
                    try {
                        config = JSON.parse(content)
                    } catch (e) {
                        prompts.log.error(`Failed to parse ${configPath}`)
                        return
                    }

                    // Check if server exists in top-level or under 'mcp' key
                    let serverFound = false
                    if (config[name]) {
                        delete config[name]
                        serverFound = true
                    } else if (config.mcp && config.mcp[name]) {
                        delete config.mcp[name]
                        // Clean up empty mcp object if needed
                        if (Object.keys(config.mcp).length === 0) {
                            delete config.mcp
                        }
                        serverFound = true
                    }

                    if (serverFound) {
                        await fs.writeFile(configPath, JSON.stringify(config, null, 2))
                        prompts.log.success(`Removed server "${name}" from ${configPath}`)

                        // Also check atomcli.json for legacy config and warn
                        const legacyPath = path.join(Global.Path.config, "atomcli.json")
                        if (existsSync(legacyPath)) {
                            try {
                                const legacy = JSON.parse(await fs.readFile(legacyPath, "utf-8"))
                                if (legacy.mcp && legacy.mcp[name]) {
                                    prompts.log.warn(`Warning: Server "${name}" also exists in ${legacyPath}.`)
                                    prompts.log.warn("You may need to manually remove it from there as well.")
                                }
                            } catch (e) {
                                // Legacy config file couldn't be parsed - non-critical warning only
                            }
                        }

                        prompts.outro("Done")
                    } else {
                        prompts.log.error(`Server "${name}" not found in configuration`)
                        prompts.outro("Failed")
                    }

                } catch (error) {
                    prompts.log.error(error instanceof Error ? error.message : String(error))
                    prompts.outro("Error")
                }
            },
        })
    },
})
