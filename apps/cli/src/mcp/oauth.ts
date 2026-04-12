import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Installation } from "../installation"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import open from "open"
import type { MCP } from "./index"

const log = Log.create({ service: "mcp:oauth" })

type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
const pendingOAuthTransports = new Map<string, TransportWithAuth>()

/**
 * Start OAuth authentication flow for an MCP server.
 * Returns the authorization URL that should be opened in a browser.
 */
export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (typeof mcpConfig !== "object" || !("type" in mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
        throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
        throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    // Generate and store a cryptographically secure state parameter BEFORE creating the provider
    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    await McpAuth.updateOAuthState(mcpName, oauthState)

    // Create a new auth provider for this flow
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    let capturedUrl: URL | undefined
    const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
        },
        {
            onRedirect: async (url) => {
                capturedUrl = url
            },
        },
    )

    // Create transport with auth provider
    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
        authProvider,
    })

    // Try to connect - this will trigger the OAuth flow
    try {
        const client = new Client({
            name: "atomcli",
            version: Installation.VERSION,
        })
        await client.connect(transport)
        // If we get here, we're already authenticated
        return { authorizationUrl: "" }
    } catch (error) {
        if (error instanceof UnauthorizedError && capturedUrl) {
            // Store transport for finishAuth
            pendingOAuthTransports.set(mcpName, transport)
            return { authorizationUrl: capturedUrl.toString() }
        }
        throw error
    }
}

/**
 * Complete OAuth authentication after user authorizes in browser.
 * Opens the browser and waits for callback.
 */
export async function authenticate(
    mcpName: string,
    getState: () => Promise<{ status: Record<string, MCP.Status> }>,
): Promise<MCP.Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
        // Already authenticated
        const s = await getState()
        return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const oauthState = await McpAuth.getOAuthState(mcpName)
    if (!oauthState) {
        throw new Error("OAuth state not found - this should not happen")
    }

    // Open the browser
    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })
    await open(authorizationUrl)

    // Wait for callback using the OAuth state parameter
    const code = await McpOAuthCallback.waitForCallback(oauthState)

    // Validate and clear the state
    const storedState = await McpAuth.getOAuthState(mcpName)
    if (storedState !== oauthState) {
        await McpAuth.clearOAuthState(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await McpAuth.clearOAuthState(mcpName)

    // Finish auth
    return finishAuth(mcpName, code)
}

/**
 * Complete OAuth authentication with the authorization code.
 */
export async function finishAuth(
    mcpName: string,
    authorizationCode: string,
    addMcp?: (name: string, mcp: Config.Mcp) => Promise<{ status: Record<string, MCP.Status> | MCP.Status }>,
): Promise<MCP.Status> {
    const transport = pendingOAuthTransports.get(mcpName)

    if (!transport) {
        throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    try {
        // Call finishAuth on the transport
        await transport.finishAuth(authorizationCode)

        // Clear the code verifier after successful auth
        await McpAuth.clearCodeVerifier(mcpName)

        // Now try to reconnect
        const cfg = await Config.get()
        const mcpConfig = cfg.mcp?.[mcpName]

        if (!mcpConfig) {
            throw new Error(`MCP server not found: ${mcpName}`)
        }

        if (typeof mcpConfig !== "object" || !("type" in mcpConfig)) {
            throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
        }

        // Re-add the MCP server to establish connection
        pendingOAuthTransports.delete(mcpName)

        if (!addMcp) {
            throw new Error("addMcp function not provided")
        }

        const result = await addMcp(mcpName, mcpConfig)

        const statusRecord = result.status as Record<string, MCP.Status>
        return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
    } catch (error) {
        log.error("failed to finish oauth", { mcpName, error })
        return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

/**
 * Remove OAuth credentials for an MCP server.
 */
export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await McpAuth.clearOAuthState(mcpName)
    log.info("removed oauth credentials", { mcpName })
}

/**
 * Check if an MCP server supports OAuth.
 */
export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (typeof mcpConfig !== "object" || !("type" in mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
}

/**
 * Check if an MCP server has stored OAuth tokens.
 */
export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpName)
    return !!entry?.tokens
}

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

/**
 * Get the authentication status for an MCP server.
 */
export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpName)
    return expired ? "expired" : "authenticated"
}

export { pendingOAuthTransports }
