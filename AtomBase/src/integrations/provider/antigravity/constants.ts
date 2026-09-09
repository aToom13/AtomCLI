/**
 * Constants for Antigravity OAuth and API integration.
 * Adapted from opencode-antigravity-auth.
 */

// OAuth credentials (from Antigravity/Google registered app)
// Override via ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET env vars
export const getAntigravityClientId = () =>
  process.env.ANTIGRAVITY_CLIENT_ID || "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
export const getAntigravityClientSecret = () =>
  process.env.ANTIGRAVITY_CLIENT_SECRET || "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"

export function validateAntigravityCredentials() {
  // Uses fallback credentials - no validation needed
  // Can be overridden via env vars
}

// Required OAuth scopes (minimal: cloud platform access only)
export const ANTIGRAVITY_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"] as const

// OAuth local server port
export const ANTIGRAVITY_OAUTH_PORT = 51121

// OAuth redirect URI for local callback server
export const ANTIGRAVITY_REDIRECT_URI = `http://localhost:${ANTIGRAVITY_OAUTH_PORT}/oauth-callback`

// API endpoints (fallback order: daily → daily sandbox → autopush → prod)
export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com"
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com"

export const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_SANDBOX,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
] as const

export const ANTIGRAVITY_LOAD_ENDPOINTS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
] as const

// Primary endpoint
export const ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY

// Gemini CLI endpoint
export const GEMINI_CLI_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY

// Default project ID for accounts without managed project
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || "your-default-project-id"

// Dynamic version management (minimum version 2.11.0 required for Gemini 3.8 models)
const ANTIGRAVITY_VERSION_FALLBACK = "2.11.0"
let antigravityVersion = ANTIGRAVITY_VERSION_FALLBACK
let versionLocked = false

export function getAntigravityVersion(): string {
  return antigravityVersion
}

function isVersionGte(v1: string, v2: string): boolean {
  const p1 = v1.split(".").map((x) => parseInt(x, 10) || 0)
  const p2 = v2.split(".").map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0
    const num2 = p2[i] || 0
    if (num1 > num2) return true
    if (num1 < num2) return false
  }
  return true
}

export function setAntigravityVersion(version: string): void {
  if (versionLocked) return
  // Do not downgrade below minimum 2.11.0 required by upstream Google Cloud Code PA
  if (!isVersionGte(version, ANTIGRAVITY_VERSION_FALLBACK)) {
    antigravityVersion = ANTIGRAVITY_VERSION_FALLBACK
    versionLocked = true
    return
  }
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
      if (match && isVersionGte(match[0], ANTIGRAVITY_VERSION_FALLBACK)) {
        setAntigravityVersion(match[0])
        return
      }
    }
  } catch {
  } finally {
    clearTimeout(timeout)
  }

  // Fallback: changelog scrape
  const controller2 = new AbortController()
  const timeout2 = setTimeout(() => controller2.abort(), 5000)
  try {
    const res = await fetch(CHANGELOG_URL, { signal: controller2.signal })
    if (res.ok) {
      const text = (await res.text()).slice(0, 5000)
      const match = text.match(VERSION_REGEX)
      if (match && isVersionGte(match[0], ANTIGRAVITY_VERSION_FALLBACK)) {
        setAntigravityVersion(match[0])
        return
      }
    }
  } catch {
  } finally {
    clearTimeout(timeout2)
  }

  // Use hardcoded fallback
  setAntigravityVersion(ANTIGRAVITY_VERSION_FALLBACK)
}

// Antigravity randomized platforms for fingerprinting
const ANTIGRAVITY_PLATFORMS = ["windows/amd64", "darwin/arm64", "darwin/amd64"] as const

/**
 * Get headers for Antigravity mode.
 * In antigravity mode, User-Agent is formatted as antigravity/ide/<version> <platform>.
 */
export function getAntigravityHeaders(): Record<string, string> {
  const platform = ANTIGRAVITY_PLATFORMS[Math.floor(Math.random() * ANTIGRAVITY_PLATFORMS.length)]
  return {
    "User-Agent": `antigravity/ide/${getAntigravityVersion()} ${platform}`,
  }
}

// Legacy static headers (kept for backward compat)
export const ANTIGRAVITY_HEADERS = {
  "User-Agent": `antigravity/ide/${ANTIGRAVITY_VERSION_FALLBACK} windows/amd64`,
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
export type ModelFamily = "claude" | "gemini" | "openweight"

// Model name → backend model mapping
export const MODEL_MAPPING: Record<
  string,
  { name: string; backend: string; family: ModelFamily; headerStyle: HeaderStyle }
> = {
  // Gemini 3.8 Flash
  "gemini-3.8-flash-high": {
    name: "Gemini 3.8 Flash (High)",
    backend: "gemini-3.8-flash-high",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.8-flash-medium": {
    name: "Gemini 3.8 Flash (Medium)",
    backend: "gemini-3.8-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.8-flash-low": {
    name: "Gemini 3.8 Flash (Low)",
    backend: "gemini-3.8-flash-low",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.8-flash": {
    name: "Gemini 3.8 Flash",
    backend: "gemini-3.8-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.8-flash-tiered": {
    name: "Gemini 3.8 Flash (Tiered)",
    backend: "gemini-3.8-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3.7 Flash
  "gemini-3.7-flash-high": {
    name: "Gemini 3.7 Flash (High)",
    backend: "gemini-3.7-flash-high",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.7-flash-medium": {
    name: "Gemini 3.7 Flash (Medium)",
    backend: "gemini-3.7-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.7-flash-low": {
    name: "Gemini 3.7 Flash (Low)",
    backend: "gemini-3.7-flash-low",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.7-flash": {
    name: "Gemini 3.7 Flash",
    backend: "gemini-3.7-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.7-flash-tiered": {
    name: "Gemini 3.7 Flash (Tiered)",
    backend: "gemini-3.7-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3.6 Flash
  "gemini-3.6-flash-high": {
    name: "Gemini 3.6 Flash (High)",
    backend: "gemini-3.6-flash-high",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.6-flash-medium": {
    name: "Gemini 3.6 Flash (Medium)",
    backend: "gemini-3.6-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.6-flash-low": {
    name: "Gemini 3.6 Flash (Low)",
    backend: "gemini-3.6-flash-low",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.6-flash": {
    name: "Gemini 3.6 Flash",
    backend: "gemini-3.6-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.6-flash-tiered": {
    name: "Gemini 3.6 Flash (Tiered)",
    backend: "gemini-3.6-flash-medium",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3.5 Flash
  "gemini-3.5-flash": {
    name: "Gemini 3.5 Flash",
    backend: "gemini-3.5-flash-low",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3.5 Flash Lite
  "gemini-3.5-flash-lite": {
    name: "Gemini 3.5 Flash Lite",
    backend: "gemini-3.5-flash-lite",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3.1 Pro
  "gemini-3.1-pro-high": {
    name: "Gemini 3.1 Pro (High)",
    backend: "gemini-pro-agent",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.1-pro-low": {
    name: "Gemini 3.1 Pro (Low)",
    backend: "gemini-3.1-pro-low",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.1-pro": {
    name: "Gemini 3.1 Pro",
    backend: "gemini-3.1-pro-low",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-3.1-flash-lite": {
    name: "Gemini 3.1 Flash Lite",
    backend: "gemini-3.1-flash-lite",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 3 Flash
  "gemini-3-flash": { name: "Gemini 3 Flash", backend: "gemini-3-flash", family: "gemini", headerStyle: "antigravity" },
  "gemini-3-flash-agent": {
    name: "Gemini 3 Flash Agent",
    backend: "gemini-3-flash-agent",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini 2.5 Flash (Antigravity mode)
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    backend: "gemini-2.5-flash",
    family: "gemini",
    headerStyle: "antigravity",
  },
  "gemini-2.5-flash-lite": {
    name: "Gemini 2.5 Flash Lite",
    backend: "gemini-2.5-flash-lite",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Gemini Pro agent
  "gemini-pro-agent": {
    name: "Gemini Pro Agent",
    backend: "gemini-pro-agent",
    family: "gemini",
    headerStyle: "antigravity",
  },

  // Claude
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6 (Thinking)",
    backend: "claude-sonnet-4-6",
    family: "claude",
    headerStyle: "antigravity",
  },
  "claude-opus-4-6-thinking": {
    name: "Claude Opus 4.6 (Thinking)",
    backend: "claude-opus-4-6-thinking",
    family: "claude",
    headerStyle: "antigravity",
  },

  // OSS
  "gpt-oss-120b-medium": {
    name: "GPT-OSS 120B (Medium)",
    backend: "gpt-oss-120b-medium",
    family: "openweight",
    headerStyle: "antigravity",
  },

  // === Gemini CLI models (production endpoint, no wrapped body) ===
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro (CLI)",
    backend: "gemini-2.5-pro",
    family: "gemini",
    headerStyle: "gemini-cli",
  },
}

// Get model info from model ID
export function getModelInfo(modelId: string) {
  // Remove provider prefix if present
  const cleanId = modelId.replace(/^antigravity\//, "")
  return MODEL_MAPPING[cleanId] || null
}
