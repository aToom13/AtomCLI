import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { McpOAuthProvider } from "./oauth-provider"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { pendingOAuthTransports } from "./oauth"
import type { MCP } from "./index"

const log = Log.create({ service: "mcp:client" })
const DEFAULT_TIMEOUT = 30_000

type MCPClient = Client
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport

// Register notification handlers for MCP client
export function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: serverName })
        Bus.publish(MCP.ToolsChanged, { server: serverName })
    })
}

export const state = Instance.state(
    async () => {
        const cfg = await Config.get()
        const config = cfg.mcp ?? {}
        const clients: Record<string, MCPClient> = {}
        const status: Record<string, MCP.Status> = {}

        await Promise.all(
            Object.entries(config).map(async ([key, mcp]) => {
                if (typeof mcp !== "object" || !("type" in mcp)) {
                    log.error("Ignoring MCP config entry without type", { key })
                    return
                }

                // If disabled by config, mark as disabled without trying to connect
                if (mcp.enabled === false) {
                    status[key] = { status: "disabled" }
                    return
                }

                const result = await create(key, mcp).catch(() => undefined)
                if (!result) return

                status[key] = result.status

                if (result.mcpClient) {
                    clients[key] = result.mcpClient
                }
            }),
        )
        return {
            status,
            clients,
        }
    },
    async (state) => {
        await Promise.all(
            Object.values(state.clients).map((client) =>
                client.close().catch((error) => {
                    log.error("Failed to close MCP client", {
                        error,
                    })
                }),
            ),
        )
        pendingOAuthTransports.clear()
    },
)

export async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
        log.info("mcp server disabled", { key })
        return {
            mcpClient: undefined,
            status: { status: "disabled" as const },
        }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: MCP.Status | undefined = undefined

    if (mcp.type === "remote") {
        // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
        const oauthDisabled = mcp.oauth === false
        const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
        let authProvider: McpOAuthProvider | undefined

        if (!oauthDisabled) {
            authProvider = new McpOAuthProvider(
                key,
                mcp.url,
                {
                    clientId: oauthConfig?.clientId,
                    clientSecret: oauthConfig?.clientSecret,
                    scope: oauthConfig?.scope,
                },
                {
                    onRedirect: async (url) => {
                        log.info("oauth redirect requested", { key, url: url.toString() })
                    },
                },
            )
        }

        const transports: Array<{ name: string; transport: TransportWithAuth }> = [
            {
                name: "StreamableHTTP",
                transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
                    authProvider,
                    requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
                }),
            },
            {
                name: "SSE",
                transport: new SSEClientTransport(new URL(mcp.url), {
                    authProvider,
                    requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
                }),
            },
        ]

        let lastError: Error | undefined
        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        for (const { name, transport } of transports) {
            try {
                const client = new Client({
                    name: "atomcli",
                    version: Installation.VERSION,
                })
                await withTimeout(client.connect(transport), connectTimeout)
                registerNotificationHandlers(client, key)
                mcpClient = client
                log.info("connected", { key, transport: name })
                status = { status: "connected" }
                break
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error))

                // Handle OAuth-specific errors
                if (error instanceof UnauthorizedError) {
                    log.info("mcp server requires authentication", { key, transport: name })

                    // Check if this is a "needs registration" error
                    if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
                        status = {
                            status: "needs_client_registration" as const,
                            error: "Server does not support dynamic client registration. Please provide clientId in config.",
                        }
                        // Show toast for needs_client_registration
                        Bus.publish(TuiEvent.ToastShow, {
                            title: "MCP Authentication Required",
                            message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                            variant: "warning",
                            duration: 8000,
                        }).catch((e) => log.debug("failed to show toast", { error: e }))
                    } else {
                        // Store transport for later finishAuth call
                        pendingOAuthTransports.set(key, transport)
                        status = { status: "needs_auth" as const }
                        // Show toast for needs_auth
                        Bus.publish(TuiEvent.ToastShow, {
                            title: "MCP Authentication Required",
                            message: `Server "${key}" requires authentication. Run: atomcli mcp auth ${key}`,
                            variant: "warning",
                            duration: 8000,
                        }).catch((e) => log.debug("failed to show toast", { error: e }))
                    }
                    break
                }

                log.debug("transport connection failed", {
                    key,
                    transport: name,
                    url: mcp.url,
                    error: lastError.message,
                })
                status = {
                    status: "failed" as const,
                    error: lastError.message,
                }
            }
        }
    }

    if (mcp.type === "local") {
        const [cmd, ...args] = mcp.command
        const cwd = Instance.directory
        const transport = new StdioClientTransport({
            stderr: "ignore",
            command: cmd,
            args,
            cwd,
            env: {
                ...process.env,
                ...(cmd === "atomcli" ? { BUN_BE_BUN: "1" } : {}),
                ...mcp.environment,
            },
        })

        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        try {
            const client = new Client({
                name: "atomcli",
                version: Installation.VERSION,
            })
            await withTimeout(client.connect(transport), connectTimeout)
            registerNotificationHandlers(client, key)
            mcpClient = client
            status = {
                status: "connected",
            }
        } catch (error) {
            log.error("local mcp startup failed", {
                key,
                command: mcp.command,
                cwd,
                error: error instanceof Error ? error.message : String(error),
            })
            status = {
                status: "failed" as const,
                error: error instanceof Error ? error.message : String(error),
            }
        }
    }

    if (!status) {
        status = {
            status: "failed" as const,
            error: "Unknown error",
        }
    }

    if (!mcpClient) {
        return {
            mcpClient: undefined,
            status,
        }
    }

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
        log.error("failed to get tools from client", { key, error: err })
        return undefined
    })
    if (!result) {
        await mcpClient.close().catch((error) => {
            log.error("Failed to close MCP client", {
                error,
            })
        })
        status = {
            status: "failed",
            error: "Failed to get tools",
        }
        return {
            mcpClient: undefined,
            status: {
                status: "failed" as const,
                error: "Failed to get tools",
            },
        }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
        mcpClient,
        status,
    }
}
