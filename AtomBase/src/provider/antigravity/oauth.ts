/**
 * OAuth flow for Antigravity authentication.
 * Adapted from opencode-antigravity-auth.
 */

import crypto from "crypto"
import http from "http"
import {
    ANTIGRAVITY_CLIENT_ID,
    ANTIGRAVITY_CLIENT_SECRET,
    ANTIGRAVITY_REDIRECT_URI,
    ANTIGRAVITY_SCOPES,
    ANTIGRAVITY_ENDPOINT_PROD,
    ANTIGRAVITY_OAUTH_PORT,
    getAntigravityHeaders,
} from "./constants"

export interface AntigravityAuthorization {
    url: string
    verifier: string
    projectId: string
}

export interface AntigravityTokenSuccess {
    type: "success"
    refresh: string
    access: string
    expires: number
    email?: string
    projectId: string
}

export interface AntigravityTokenFailure {
    type: "failed"
    error: string
}

export type AntigravityTokenResult = AntigravityTokenSuccess | AntigravityTokenFailure

interface AuthState {
    verifier: string
    projectId: string
}

// Generate PKCE challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString("base64url")
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
    return { verifier, challenge }
}

function encodeState(payload: AuthState): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function decodeState(state: string): AuthState {
    if (!state) throw new Error("OAuth state parameter is missing")
    try {
        const normalized = state.replace(/-/g, "+").replace(/_/g, "/")
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
        const json = Buffer.from(padded, "base64").toString("utf8")
        const parsed = JSON.parse(json)
        return {
            verifier: parsed.verifier,
            projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
        }
    } catch (e) {
        throw new Error(`Invalid OAuth state parameter: ${(e as Error).message}`)
    }
}

/**
 * Build the authorization URL for Google OAuth with PKCE.
 */
export function createAuthorizationUrl(projectId = ""): AntigravityAuthorization {
    const pkce = generatePKCE()

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI)
    url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "))
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", encodeState({ verifier: pkce.verifier, projectId }))
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")

    return {
        url: url.toString(),
        verifier: pkce.verifier,
        projectId,
    }
}

/**
 * Fetch project ID from Antigravity loadCodeAssist endpoint.
 */
async function fetchProjectID(accessToken: string): Promise<string> {
    try {
        const url = `${ANTIGRAVITY_ENDPOINT_PROD}/v1internal:loadCodeAssist`
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                ...getAntigravityHeaders(),
            },
            body: JSON.stringify({
                metadata: {
                    ideType: "IDE_UNSPECIFIED",
                    platform: "PLATFORM_UNSPECIFIED",
                    pluginType: "GEMINI",
                },
            }),
        })

        if (!response.ok) return ""

        const data = await response.json() as any
        return data.cloudaicompanionProject?.id || data.cloudaicompanionProject || ""
    } catch {
        return ""
    }
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(code: string, state: string): Promise<AntigravityTokenResult> {
    try {
        const { verifier, projectId } = decodeState(state)

        const startTime = Date.now()
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
                redirect_uri: ANTIGRAVITY_REDIRECT_URI,
                code_verifier: verifier,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            return { type: "failed", error: errorText }
        }

        const tokenData = await response.json() as {
            access_token: string
            expires_in: number
            refresh_token: string
        }

        // Get user info
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        const userInfo = userInfoRes.ok ? (await userInfoRes.json() as { email?: string }) : {}

        // Get project ID if not provided
        let effectiveProjectId = projectId
        if (!effectiveProjectId) {
            effectiveProjectId = await fetchProjectID(tokenData.access_token)
        }

        // Store refresh token with project ID
        const storedRefresh = `${tokenData.refresh_token}|${effectiveProjectId || ""}`

        return {
            type: "success",
            refresh: storedRefresh,
            access: tokenData.access_token,
            expires: startTime + tokenData.expires_in * 1000,
            email: userInfo.email,
            projectId: effectiveProjectId || "",
        }
    } catch (error) {
        return {
            type: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
        }
    }
}

/**
 * Refresh access token using refresh token.
 */
export async function refreshToken(storedRefresh: string): Promise<AntigravityTokenResult> {
    try {
        const [refreshToken, projectId] = storedRefresh.split("|")
        if (!refreshToken) {
            return { type: "failed", error: "Invalid refresh token format" }
        }

        const startTime = Date.now()
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            return { type: "failed", error: errorText }
        }

        const tokenData = await response.json() as {
            access_token: string
            expires_in: number
        }

        return {
            type: "success",
            refresh: storedRefresh,
            access: tokenData.access_token,
            expires: startTime + tokenData.expires_in * 1000,
            projectId: projectId || "",
        }
    } catch (error) {
        return {
            type: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
        }
    }
}

/**
 * Start a local OAuth callback server and wait for the redirect.
 */
export function startOAuthServer(port = ANTIGRAVITY_OAUTH_PORT): Promise<{ code: string; state: string } | null> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url || "", `http://localhost:${port}`)

            if (url.pathname === "/oauth-callback") {
                const code = url.searchParams.get("code")
                const state = url.searchParams.get("state")

                res.writeHead(200, { "Content-Type": "text/html" })
                res.end(`
          <html>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
              <h1>✅ Authentication Successful</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `)

                server.close()

                if (code && state) {
                    resolve({ code, state })
                } else {
                    resolve(null)
                }
            }
        })

        server.listen(port, () => {
            // Server started
        })

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close()
            resolve(null)
        }, 5 * 60 * 1000)
    })
}
