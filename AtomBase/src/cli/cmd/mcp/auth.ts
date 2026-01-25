import { cmd } from "../cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../../ui"
import { MCP } from "../../../mcp"
import { McpAuth } from "../../../mcp/auth"
import { Config } from "../../../config/config"
import { Instance } from "../../../project/instance"
import path from "path"
import { Global } from "../../../global"
import { getAuthStatusIcon, getAuthStatusText, isMcpRemote, type McpRemote } from "./utils"

export const McpAuthCommand = cmd({
    command: "auth [name]",
    describe: "authenticate with an OAuth-enabled MCP server",
    builder: (yargs) =>
        yargs
            .positional("name", {
                describe: "name of the MCP server",
                type: "string",
            })
            .command(McpAuthListCommand),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("MCP OAuth Authentication")

                const config = await Config.get()
                const mcpServers = config.mcp ?? {}

                // Get OAuth-capable servers (remote servers with oauth not explicitly disabled)
                const oauthServers = Object.entries(mcpServers).filter(
                    (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
                )

                if (oauthServers.length === 0) {
                    prompts.log.warn("No OAuth-capable MCP servers configured")
                    prompts.log.info("Remote MCP servers support OAuth by default. Add a remote server in atomcli.json:")
                    prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
                    prompts.outro("Done")
                    return
                }

                let serverName = args.name
                if (!serverName) {
                    // Build options with auth status
                    const options = await Promise.all(
                        oauthServers.map(async ([name, cfg]) => {
                            const authStatus = await MCP.getAuthStatus(name)
                            const icon = getAuthStatusIcon(authStatus)
                            const statusText = getAuthStatusText(authStatus)
                            const url = cfg.url
                            return {
                                label: `${icon} ${name} (${statusText})`,
                                value: name,
                                hint: url,
                            }
                        }),
                    )

                    const selected = await prompts.select({
                        message: "Select MCP server to authenticate",
                        options,
                    })
                    if (prompts.isCancel(selected)) throw new UI.CancelledError()
                    serverName = selected
                }

                const serverConfig = mcpServers[serverName]
                if (!serverConfig) {
                    prompts.log.error(`MCP server not found: ${serverName}`)
                    prompts.outro("Done")
                    return
                }

                if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
                    prompts.log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
                    prompts.outro("Done")
                    return
                }

                // Check if already authenticated
                const authStatus = await MCP.getAuthStatus(serverName)
                if (authStatus === "authenticated") {
                    const confirm = await prompts.confirm({
                        message: `${serverName} already has valid credentials. Re-authenticate?`,
                    })
                    if (prompts.isCancel(confirm) || !confirm) {
                        prompts.outro("Cancelled")
                        return
                    }
                } else if (authStatus === "expired") {
                    prompts.log.warn(`${serverName} has expired credentials. Re-authenticating...`)
                }

                const spinner = prompts.spinner()
                spinner.start("Starting OAuth flow...")

                try {
                    const status = await MCP.authenticate(serverName)

                    if (status.status === "connected") {
                        spinner.stop("Authentication successful!")
                    } else if (status.status === "needs_client_registration") {
                        spinner.stop("Authentication failed", 1)
                        prompts.log.error(status.error)
                        prompts.log.info("Add clientId to your MCP server config:")
                        prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
                    } else if (status.status === "failed") {
                        spinner.stop("Authentication failed", 1)
                        prompts.log.error(status.error)
                    } else {
                        spinner.stop("Unexpected status: " + status.status, 1)
                    }
                } catch (error) {
                    spinner.stop("Authentication failed", 1)
                    prompts.log.error(error instanceof Error ? error.message : String(error))
                }

                prompts.outro("Done")
            },
        })
    },
})

export const McpAuthListCommand = cmd({
    command: "list",
    aliases: ["ls"],
    describe: "list OAuth-capable MCP servers and their auth status",
    async handler() {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("MCP OAuth Status")

                const config = await Config.get()
                const mcpServers = config.mcp ?? {}

                // Get OAuth-capable servers
                const oauthServers = Object.entries(mcpServers).filter(
                    (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
                )

                if (oauthServers.length === 0) {
                    prompts.log.warn("No OAuth-capable MCP servers configured")
                    prompts.outro("Done")
                    return
                }

                for (const [name, serverConfig] of oauthServers) {
                    const authStatus = await MCP.getAuthStatus(name)
                    const icon = getAuthStatusIcon(authStatus)
                    const statusText = getAuthStatusText(authStatus)
                    const url = serverConfig.url

                    prompts.log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
                }

                prompts.outro(`${oauthServers.length} OAuth-capable server(s)`)
            },
        })
    },
})

export const McpLogoutCommand = cmd({
    command: "logout [name]",
    describe: "remove OAuth credentials for an MCP server",
    builder: (yargs) =>
        yargs.positional("name", {
            describe: "name of the MCP server",
            type: "string",
        }),
    async handler(args) {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                prompts.intro("MCP OAuth Logout")

                const authPath = path.join(Global.Path.data, "mcp-auth.json")
                const credentials = await McpAuth.all()
                const serverNames = Object.keys(credentials)

                if (serverNames.length === 0) {
                    prompts.log.warn("No MCP OAuth credentials stored")
                    prompts.outro("Done")
                    return
                }

                let serverName = args.name
                if (!serverName) {
                    const selected = await prompts.select({
                        message: "Select MCP server to logout",
                        options: serverNames.map((name) => {
                            const entry = credentials[name]
                            const hasTokens = !!entry.tokens
                            const hasClient = !!entry.clientInfo
                            let hint = ""
                            if (hasTokens && hasClient) hint = "tokens + client"
                            else if (hasTokens) hint = "tokens"
                            else if (hasClient) hint = "client registration"
                            return {
                                label: name,
                                value: name,
                                hint,
                            }
                        }),
                    })
                    if (prompts.isCancel(selected)) throw new UI.CancelledError()
                    serverName = selected
                }

                if (!credentials[serverName]) {
                    prompts.log.error(`No credentials found for: ${serverName}`)
                    prompts.outro("Done")
                    return
                }

                await MCP.removeAuth(serverName)
                prompts.log.success(`Removed OAuth credentials for ${serverName}`)
                prompts.outro("Done")
            },
        })
    },
})
