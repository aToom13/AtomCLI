/**
 * Constants for Antigravity OAuth and API integration.
 * Adapted from opencode-antigravity-auth.
 */

// OAuth credentials (from Antigravity/Google)
export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
export const ANTIGRAVITY_CLIENT_SECRET = "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"

// Required OAuth scopes
export const ANTIGRAVITY_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
] as const

// OAuth redirect URI for local callback server
export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback"

// API endpoints (fallback order: daily → autopush → prod)
export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com"

export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_AUTOPUSH,
    ANTIGRAVITY_ENDPOINT_PROD,
] as const

// Primary endpoint (daily sandbox)
export const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY

// Gemini CLI endpoint (production)
export const GEMINI_CLI_ENDPOINT = ANTIGRAVITY_ENDPOINT_PROD

// Default project ID for accounts without managed project
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc"

// Request headers for Antigravity API
export const ANTIGRAVITY_HEADERS = {
    "User-Agent": "antigravity/1.11.5 windows/amd64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
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
export const MODEL_MAPPING: Record<string, { backend: string; family: ModelFamily; headerStyle: HeaderStyle }> = {
    // Claude models (Antigravity quota) - with antigravity- prefix
    "antigravity-claude-sonnet-4-5": { backend: "claude-sonnet-4-5", family: "claude", headerStyle: "antigravity" },
    "antigravity-claude-sonnet-4-5-thinking": { backend: "claude-sonnet-4-5-thinking", family: "claude", headerStyle: "antigravity" },
    "antigravity-claude-opus-4-5-thinking": { backend: "claude-opus-4-5-thinking", family: "claude", headerStyle: "antigravity" },

    // Claude models (Antigravity quota) - without prefix
    "claude-sonnet-4-5": { backend: "claude-sonnet-4-5", family: "claude", headerStyle: "antigravity" },
    "claude-sonnet-4-5-thinking": { backend: "claude-sonnet-4-5-thinking", family: "claude", headerStyle: "antigravity" },
    "claude-opus-4-5-thinking": { backend: "claude-opus-4-5-thinking", family: "claude", headerStyle: "antigravity" },

    // Gemini 3 models (Antigravity quota) - with antigravity- prefix
    "antigravity-gemini-3-pro": { backend: "gemini-3-pro", family: "gemini", headerStyle: "antigravity" },
    "antigravity-gemini-3-flash": { backend: "gemini-3-flash", family: "gemini", headerStyle: "antigravity" },

    // Gemini 3 models (Antigravity quota) - without prefix
    "gemini-3-pro": { backend: "gemini-3-pro", family: "gemini", headerStyle: "antigravity" },
    "gemini-3-flash": { backend: "gemini-3-flash", family: "gemini", headerStyle: "antigravity" },

    // Gemini 2.5 models (Gemini CLI quota)
    "gemini-2.5-flash": { backend: "gemini-2.5-flash", family: "gemini", headerStyle: "gemini-cli" },
    "gemini-2.5-pro": { backend: "gemini-2.5-pro", family: "gemini", headerStyle: "gemini-cli" },
}

// Get model info from model ID
export function getModelInfo(modelId: string) {
    // Remove provider prefix if present
    const cleanId = modelId.replace(/^antigravity\//, "")
    return MODEL_MAPPING[cleanId] || null
}
