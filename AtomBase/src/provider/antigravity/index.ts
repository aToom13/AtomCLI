/**
 * Antigravity Provider for AtomCLI
 * 
 * Provides access to Antigravity quota models (Claude, Gemini 3) via Google OAuth.
 * Adapted from opencode-antigravity-auth.
 */

import type { LanguageModel } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import {
    ANTIGRAVITY_ENDPOINT,
    GEMINI_CLI_ENDPOINT,
    ANTIGRAVITY_HEADERS,
    GEMINI_CLI_HEADERS,
    ANTIGRAVITY_DEFAULT_PROJECT_ID,
    getModelInfo,
    type HeaderStyle,
} from "./constants"
import { refreshToken as refreshOAuthToken } from "./oauth"
import { getActiveAccount, rotateAccount } from "./storage"

// Token cache
let cachedToken: { access: string; expires: number } | null = null

/**
 * Get a valid access token, refreshing if necessary.
 */
async function getAccessToken(): Promise<string | null> {
    // Check cache
    if (cachedToken && cachedToken.expires > Date.now() + 60000) {
        return cachedToken.access
    }

    // Get active account
    const account = await getActiveAccount()
    if (!account) {
        return null
    }

    // Refresh token
    const result = await refreshOAuthToken(account.refreshToken)
    if (result.type === "failed") {
        // Try rotating to next account
        const nextAccount = await rotateAccount()
        if (!nextAccount) {
            return null
        }
        const retryResult = await refreshOAuthToken(nextAccount.refreshToken)
        if (retryResult.type === "failed") {
            return null
        }
        cachedToken = { access: retryResult.access, expires: retryResult.expires }
        return retryResult.access
    }

    cachedToken = { access: result.access, expires: result.expires }
    return result.access
}

/**
 * Get endpoint based on header style.
 */
function getEndpoint(headerStyle: HeaderStyle): string {
    return headerStyle === "antigravity" ? ANTIGRAVITY_ENDPOINT : GEMINI_CLI_ENDPOINT
}

/**
 * Get headers based on header style.
 */
function getHeaders(headerStyle: HeaderStyle, accessToken: string, projectId?: string): Record<string, string> {
    const baseHeaders = headerStyle === "antigravity" ? ANTIGRAVITY_HEADERS : GEMINI_CLI_HEADERS
    const effectiveProjectId = projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID

    return {
        ...baseHeaders,
        Authorization: `Bearer ${accessToken}`,
        "X-Goog-User-Project": effectiveProjectId,
    }
}

/**
 * Create a custom fetch that injects Antigravity auth headers.
 */
function createAntigravityFetch(headerStyle: HeaderStyle, projectId?: string) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error("No Antigravity authentication. Run 'atomcli auth login' and select Antigravity OAuth.")
        }

        const url = typeof input === "string" ? input : input.toString()
        const headers = getHeaders(headerStyle, accessToken, projectId)

        // Replace Google API endpoint with Antigravity endpoint
        // The base URL is generativelanguage.googleapis.com but we need cloudcode-pa endpoint
        let targetUrl = url
        const endpoint = getEndpoint(headerStyle)

        // Replace generativelanguage.googleapis.com with the appropriate cloudcode endpoint
        if (url.includes("generativelanguage.googleapis.com")) {
            targetUrl = url.replace(
                /https:\/\/generativelanguage\.googleapis\.com/,
                endpoint
            )
        }

        return fetch(targetUrl, {
            ...init,
            headers: {
                ...init?.headers,
                ...headers,
            },
        })
    }
}


/**
 * Create an Antigravity language model.
 */
export function createAntigravityModel(modelId: string, options?: { projectId?: string }): LanguageModel {
    const modelInfo = getModelInfo(modelId)
    if (!modelInfo) {
        throw new Error(`Unknown Antigravity model: ${modelId}. Available: claude-sonnet-4-5-thinking, gemini-3-pro, gemini-3-flash, gemini-2.5-flash, gemini-2.5-pro`)
    }

    const google = createGoogleGenerativeAI({
        apiKey: "antigravity", // Dummy key, auth via headers
        fetch: createAntigravityFetch(modelInfo.headerStyle, options?.projectId) as any,
    })

    return google(modelInfo.backend)
}

/**
 * Provider SDK compatible interface.
 */
export function createAntigravity(options?: { projectId?: string }) {
    return {
        languageModel(modelId: string): LanguageModel {
            return createAntigravityModel(modelId, options)
        },
        chat(modelId: string): LanguageModel {
            return createAntigravityModel(modelId, options)
        },
    }
}

export * from "./constants"
export * from "./oauth"
export * from "./storage"
