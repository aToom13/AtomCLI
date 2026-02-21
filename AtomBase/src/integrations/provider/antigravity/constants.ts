/**
 * Constants for Antigravity OAuth and API integration.
 * Adapted from opencode-antigravity-auth.
 */

// OAuth credentials (from Antigravity/Google)
export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || "YOUR_CLIENT_ID.apps.googleusercontent.com"
export const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || "YOUR_CLIENT_SECRET"

// Required OAuth scopes
export const ANTIGRAVITY_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
] as const

// OAuth local server port
export const ANTIGRAVITY_OAUTH_PORT = 51121

// OAuth redirect URI for local callback server
export const ANTIGRAVITY_REDIRECT_URI = `http://localhost:${ANTIGRAVITY_OAUTH_PORT}/oauth-callback`

// API endpoints (fallback order: daily → autopush → prod)
export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com"

export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_AUTOPUSH,
    ANTIGRAVITY_ENDPOINT_PROD,
] as const

// Primary endpoint (daily sandbox - newer models available here first)
export const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY

// Gemini CLI endpoint (using daily sandbox - PROD requires API enabled on project)
export const GEMINI_CLI_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY

// Default project ID for accounts without managed project
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || "your-default-project-id"

// Dynamic version management
const ANTIGRAVITY_VERSION_FALLBACK = "1.18.3"
let antigravityVersion = ANTIGRAVITY_VERSION_FALLBACK
let versionLocked = false

export function getAntigravityVersion(): string { return antigravityVersion }

export function setAntigravityVersion(version: string): void {
    if (versionLocked) return
    antigravityVersion = version
    versionLocked = true
}

const VERSION_URL = "https://antigravity-auto-updater-974169037036.us-central1.run.app"
const CHANGELOG_URL = "https://antigravity.google/changelog"
const VERSION_REGEX = /\d+\.\d+\.\d+/

/**
 * Fetch and set the latest Antigravity version at startup.
 * Tries: 1) auto-updater API, 2) changelog scrape, 3) hardcoded fallback.
 */
export async function initAntigravityVersion(): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
        const res = await fetch(VERSION_URL, { signal: controller.signal })
        if (res.ok) {
            const text = await res.text()
            const match = text.match(VERSION_REGEX)
            if (match) { setAntigravityVersion(match[0]); return }
        }
    } catch { }
    finally { clearTimeout(timeout) }

    // Fallback: changelog scrape
    const controller2 = new AbortController()
    const timeout2 = setTimeout(() => controller2.abort(), 5000)
    try {
        const res = await fetch(CHANGELOG_URL, { signal: controller2.signal })
        if (res.ok) {
            const text = (await res.text()).slice(0, 5000)
            const match = text.match(VERSION_REGEX)
            if (match) { setAntigravityVersion(match[0]); return }
        }
    } catch { }
    finally { clearTimeout(timeout2) }

    // Use hardcoded fallback
    setAntigravityVersion(ANTIGRAVITY_VERSION_FALLBACK)
}

// Antigravity randomized platforms for fingerprinting
const ANTIGRAVITY_PLATFORMS = ["windows/amd64", "darwin/arm64", "darwin/amd64"] as const

/**
 * Get headers for Antigravity mode.
 * In antigravity mode, ONLY User-Agent is sent (no X-Goog-Api-Client, no Client-Metadata).
 */
export function getAntigravityHeaders(): Record<string, string> {
    const platform = ANTIGRAVITY_PLATFORMS[Math.floor(Math.random() * ANTIGRAVITY_PLATFORMS.length)]
    return {
        "User-Agent": `antigravity/${getAntigravityVersion()} ${platform}`,
    }
}

// Legacy static headers (kept for backward compat)
export const ANTIGRAVITY_HEADERS = {
    "User-Agent": `antigravity/${ANTIGRAVITY_VERSION_FALLBACK} windows/amd64`,
} as const

// Request headers for Gemini CLI API  
export const GEMINI_CLI_HEADERS = {
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const

export type HeaderStyle = "antigravity" | "gemini-cli"

// Provider ID
export const ANTIGRAVITY_PROVIDER_ID = "antigravity"

// Model family types
export type ModelFamily = "claude" | "gemini"

// Model name → backend model mapping
export const MODEL_MAPPING: Record<string, { name: string; backend: string; family: ModelFamily; headerStyle: HeaderStyle }> = {
    // === Antigravity models (wrapped body, daily sandbox endpoint) ===

    // Claude models
    "claude-sonnet-4.6-thinking": { name: "Claude Sonnet 4.6 (Thinking)", backend: "claude-sonnet-4-6", family: "claude", headerStyle: "antigravity" },
    "claude-opus-4.6-thinking": { name: "Claude Opus 4.6 (Thinking)", backend: "claude-opus-4-6-thinking", family: "claude", headerStyle: "antigravity" },

    // Gemini 3.1 Pro models - Cloud Code API requires tier suffix for Pro
    "gemini-3.1-pro-high": { name: "Gemini 3.1 Pro (High)", backend: "gemini-3.1-pro-high", family: "gemini", headerStyle: "antigravity" },
    "gemini-3.1-pro-low": { name: "Gemini 3.1 Pro (Low)", backend: "gemini-3.1-pro-low", family: "gemini", headerStyle: "antigravity" },

    // Gemini 3 Flash
    "gemini-3-flash": { name: "Gemini 3 Flash", backend: "gemini-3-flash", family: "gemini", headerStyle: "antigravity" },

    // === Gemini CLI models (production endpoint, no wrapped body) ===

    // Gemini 2.5 models
    "gemini-2.5-flash": { name: "Gemini 2.5 Flash (CLI)", backend: "gemini-2.5-flash", family: "gemini", headerStyle: "gemini-cli" },
    "gemini-2.5-pro": { name: "Gemini 2.5 Pro (CLI)", backend: "gemini-2.5-pro", family: "gemini", headerStyle: "gemini-cli" },

    // Gemini 3 Preview models (CLI)
    "gemini-3-flash-preview": { name: "Gemini 3 Flash Preview (CLI)", backend: "gemini-3-flash-preview", family: "gemini", headerStyle: "gemini-cli" },
    "gemini-3-pro-preview": { name: "Gemini 3 Pro Preview (CLI)", backend: "gemini-3-pro-preview", family: "gemini", headerStyle: "gemini-cli" },
    "gemini-3.1-pro-preview": { name: "Gemini 3.1 Pro Preview (CLI)", backend: "gemini-3.1-pro-preview", family: "gemini", headerStyle: "gemini-cli" },
}

// Get model info from model ID
export function getModelInfo(modelId: string) {
    // Remove provider prefix if present
    const cleanId = modelId.replace(/^antigravity\//, "")
    return MODEL_MAPPING[cleanId] || null
}
