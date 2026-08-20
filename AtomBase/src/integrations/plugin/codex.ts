import type { Hooks, PluginInput } from "@atomcli/plugin"
import { Log } from "@/util/util/log"
import { OAUTH_DUMMY_KEY } from "@/services/auth"
import type { Provider } from "@/integrations/provider/provider"
import { Installation } from "@/services/installation"

const log = Log.create({ service: "plugin.codex" })

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
const OAUTH_PORT = 1455
const MAX_MODELS_RESPONSE_BYTES = 5 * 1024 * 1024
const MODELS_REQUEST_TIMEOUT_MS = 15_000
const FALLBACK_MODEL_IDS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
])

interface CodexRemoteModel {
  slug: string
  display_name?: string
  supported_in_api?: boolean
  visibility?: string
  context_window?: number
  supported_reasoning_levels?: Array<{ effort?: string } | string>
  input_modalities?: string[]
  supports_reasoning_summary_parameter?: boolean
  default_reasoning_summary?: string
}

interface CodexModelsResponse {
  models?: CodexRemoteModel[]
}

async function readJsonBounded(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > maxBytes) throw new Error("Codex models response is too large")
  if (!response.body) throw new Error("Codex models response is empty")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error("Codex models response is too large")
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return JSON.parse(parts.join(""))
  } finally {
    reader.releaseLock()
  }
}

export namespace CodexModels {
  export function applyFallback(models: Provider.Info["models"]) {
    for (const modelID of Object.keys(models)) {
      if (!FALLBACK_MODEL_IDS.has(modelID)) delete models[modelID]
    }
    return Object.keys(models).length
  }

  export function apply(models: Provider.Info["models"], response: CodexModelsResponse) {
    if (!response || !Array.isArray(response.models)) throw new Error("Codex models response is missing models")
    for (const [index, model] of response.models.entries()) {
      if (
        !model ||
        typeof model !== "object" ||
        typeof model.slug !== "string" ||
        (model.visibility !== undefined && typeof model.visibility !== "string") ||
        (model.supported_in_api !== undefined && typeof model.supported_in_api !== "boolean") ||
        (model.context_window !== undefined && !Number.isFinite(model.context_window)) ||
        (model.supported_reasoning_levels !== undefined && !Array.isArray(model.supported_reasoning_levels)) ||
        (model.input_modalities !== undefined && !Array.isArray(model.input_modalities))
      ) {
        throw new Error(`Codex models response contains an invalid model at index ${index}`)
      }
    }

    const remote = response.models.filter(
      (model) =>
        typeof model.slug === "string" &&
        model.slug.length > 0 &&
        model.visibility === "list",
    )
    const next: Provider.Info["models"] = {}

    for (const item of remote) {
      const existing = models[item.slug]
      const efforts = (item.supported_reasoning_levels ?? [])
        .map((level) => (typeof level === "string" ? level : level.effort))
        .filter((effort): effort is string => !!effort)
      const variants = Object.fromEntries(
        efforts.map((effort) => [
          effort,
          {
            reasoningEffort: effort,
            ...(item.supports_reasoning_summary_parameter !== false && item.default_reasoning_summary !== "none"
              ? {
                  reasoningSummary: item.default_reasoning_summary ?? "auto",
                  include: ["reasoning.encrypted_content"],
                }
              : {}),
          },
        ]),
      )
      const input = item.input_modalities ?? ["text", "image"]
      const inputCapabilities = {
        text: input.includes("text"),
        audio: input.includes("audio"),
        image: input.includes("image"),
        video: input.includes("video"),
        pdf: input.includes("pdf"),
      }

      if (existing) {
        next[item.slug] = {
          ...existing,
          name: item.display_name ?? existing.name,
          api: { ...existing.api, id: item.slug, url: "https://chatgpt.com/backend-api/codex" },
          capabilities: {
            ...existing.capabilities,
            reasoning: efforts.length > 0,
            attachment: input.some((modality) => modality !== "text"),
            input: inputCapabilities,
          },
          limit: {
            ...existing.limit,
            context: item.context_window ?? existing.limit.context,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          variants,
        }
        continue
      }

      const model: Provider.Model = {
        id: item.slug,
        providerID: "openai",
        api: {
          id: item.slug,
          url: "https://chatgpt.com/backend-api/codex",
          npm: "@ai-sdk/openai",
        },
        name: item.display_name ?? item.slug,
        family: item.slug,
        capabilities: {
          temperature: false,
          reasoning: efforts.length > 0,
          attachment: input.some((modality) => modality !== "text"),
          toolcall: true,
          input: inputCapabilities,
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: item.context_window ?? 272000, output: 128000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
        variants,
      }
      next[item.slug] = model
    }

    for (const modelID of Object.keys(models)) delete models[modelID]
    Object.assign(models, next)
    return remote.length
  }
}

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export interface IdTokenClaims {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims && extractAccountIdFromClaims(claims)
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims ? extractAccountIdFromClaims(claims) : undefined
  }
  return undefined
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "atomcli",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return response.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return response.json()
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>AtomCLI - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to AtomCLI.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>AtomCLI - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${CodexOAuth.escapeHTML(error)}</div>
    </div>
  </body>
</html>`

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
}

export namespace CodexOAuth {
  export function escapeHTML(value: string) {
    return value.replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;"
        case "<":
          return "&lt;"
        case ">":
          return "&gt;"
        case '"':
          return "&quot;"
        default:
          return "&#39;"
      }
    })
  }

  export function errorPage(message: string) {
    return HTML_ERROR(message)
  }

  export function validateCallback(url: URL, expectedState: string) {
    if (url.searchParams.get("state") !== expectedState) {
      return { type: "invalid" as const, message: "Invalid state - potential CSRF attack" }
    }

    const error = url.searchParams.get("error")
    if (error) {
      return { type: "error" as const, message: url.searchParams.get("error_description") || error }
    }

    const code = url.searchParams.get("code")
    if (!code) return { type: "error" as const, message: "Missing authorization code" }
    return { type: "code" as const, code }
  }

  export function resolveRequestUrl(requestInput: RequestInfo | URL) {
    const parsed =
      requestInput instanceof URL
        ? new URL(requestInput)
        : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)

    if (parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")) {
      return new URL(CODEX_API_ENDPOINT)
    }

    const trustedOrigin = new URL(CODEX_API_ENDPOINT).origin
    const trustedPath = parsed.pathname === "/backend-api/codex" || parsed.pathname.startsWith("/backend-api/codex/")
    if (parsed.protocol !== "https:" || parsed.origin !== trustedOrigin || !trustedPath) {
      throw new Error(`Refusing to send Codex OAuth credentials to untrusted URL: ${parsed.origin}`)
    }
    return parsed
  }

  export async function startServer(port = OAUTH_PORT) {
    return startOAuthServer(port)
  }

  export function stopServer() {
    stopOAuthServer()
  }

  export async function beginAuthorization(port = OAUTH_PORT) {
    const pkce = await generatePKCE()
    const state = generateState()
    const { redirectUri } = await startOAuthServer(port)
    const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)

    let callbackPromise: Promise<TokenResponse>
    try {
      callbackPromise = waitForOAuthCallback(pkce, state, redirectUri)
    } catch (error) {
      stopOAuthServer()
      throw error
    }

    return {
      url: authUrl,
      instructions: "Complete authorization in your browser. This window will close automatically.",
      method: "auto" as const,
      callback: async () => {
        try {
          const tokens = await callbackPromise
          const accountId = extractAccountId(tokens)
          return {
            type: "success" as const,
            refresh: tokens.refresh_token,
            access: tokens.access_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            accountId,
          }
        } finally {
          stopOAuthServer()
        }
      },
    }
  }
}

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  redirectUri: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(port = OAUTH_PORT): Promise<{ hostname: "127.0.0.1"; port: number; redirectUri: string }> {
  if (oauthServer) {
    throw new Error("A Codex OAuth authorization is already in progress")
  }

  try {
    oauthServer = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/auth/callback") {
        const current = pendingOAuth
        if (!current) {
          return new Response(HTML_ERROR("No OAuth authorization is pending"), { status: 400, headers: HTML_HEADERS })
        }

        const callback = CodexOAuth.validateCallback(url, current.state)
        if (callback.type === "invalid") {
          // A forged callback must not cancel the genuine login still in flight.
          return new Response(HTML_ERROR(callback.message), { status: 400, headers: HTML_HEADERS })
        }

        pendingOAuth = undefined
        if (callback.type === "error") {
          current.reject(new Error(callback.message))
          queueMicrotask(stopOAuthServer)
          return new Response(HTML_ERROR(callback.message), { status: 400, headers: HTML_HEADERS })
        }

        try {
          const tokens = await exchangeCodeForTokens(callback.code, current.redirectUri, current.pkce)
          current.resolve(tokens)
          return new Response(HTML_SUCCESS, { headers: HTML_HEADERS })
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          current.reject(failure)
          return new Response(HTML_ERROR(failure.message), { status: 502, headers: HTML_HEADERS })
        } finally {
          queueMicrotask(stopOAuthServer)
        }
      }

      if (url.pathname === "/cancel") {
        const current = pendingOAuth
        if (!current || url.searchParams.get("state") !== current.state) {
          return new Response("Invalid state", { status: 400 })
        }
        pendingOAuth = undefined
        current.reject(new Error("Login cancelled"))
        queueMicrotask(stopOAuthServer)
        return new Response("Login cancelled", { status: 200 })
      }

      return new Response("Not found", { status: 404 })
      },
    })
  } catch (error) {
    oauthServer = undefined
    throw new Error(`Codex OAuth callback port ${port} is unavailable`, { cause: error })
  }

  const activePort = oauthServer.port
  const redirectUri = `http://localhost:${activePort}/auth/callback`
  log.info("codex oauth server started", { port: activePort })
  return { hostname: "127.0.0.1" as const, port: activePort, redirectUri }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.stop()
    oauthServer = undefined
    log.info("codex oauth server stopped")
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string, redirectUri: string): Promise<TokenResponse> {
  if (pendingOAuth) return Promise.reject(new Error("A Codex OAuth authorization is already in progress"))
  return new Promise((resolve, reject) => {
    let current: PendingOAuth
    const timeout = setTimeout(
      () => {
        if (pendingOAuth === current) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
          stopOAuthServer()
        }
      },
      5 * 60 * 1000,
    ) // 5 minute timeout

    current = {
      pkce,
      state,
      redirectUri,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
    pendingOAuth = current
  })
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        let refreshingToken: Promise<{ access: string; accountId?: string }> | undefined
        const authenticatedFetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
          // Resolve and validate the final destination before refreshing or
          // attaching credentials. Untrusted origins never receive a token.
          const url = CodexOAuth.resolveRequestUrl(requestInput)
          // Remove the SDK's dummy key before attaching the current OAuth token.
          const headers = new Headers(init?.headers)
          headers.delete("authorization")

          const currentAuth = await getAuth()
          if (!currentAuth || currentAuth.type !== "oauth") return fetch(requestInput, { ...init, headers })
          const authWithAccount = currentAuth as typeof currentAuth & { accountId?: string }

          if (!currentAuth.access || currentAuth.expires < Date.now()) {
            refreshingToken ??= (async () => {
              log.info("refreshing codex access token")
              const tokens = await refreshAccessToken(currentAuth.refresh)
              const accountId = extractAccountId(tokens) || authWithAccount.accountId
              await input.client.auth.set({
                providerID: "openai",
                auth: {
                  type: "oauth",
                  refresh: tokens.refresh_token || currentAuth.refresh,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  ...(accountId && { accountId }),
                },
              })
              return { access: tokens.access_token, accountId }
            })().finally(() => {
              refreshingToken = undefined
            })
            const refreshed = await refreshingToken
            currentAuth.access = refreshed.access
            authWithAccount.accountId = refreshed.accountId
          }

          headers.set("authorization", `Bearer ${currentAuth.access}`)
          if (authWithAccount.accountId) headers.set("ChatGPT-Account-Id", authWithAccount.accountId)

          return fetch(url, { ...init, headers })
        }

        try {
          const url = new URL(CODEX_MODELS_ENDPOINT)
          url.searchParams.set("client_version", Installation.VERSION)
          const response = await authenticatedFetch(url, {
            headers: { "User-Agent": Installation.USER_AGENT },
            signal: AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS),
          })
          if (!response.ok) throw new Error(`Codex models endpoint returned ${response.status}`)
          const count = CodexModels.apply(
            provider.models,
            (await readJsonBounded(response, MAX_MODELS_RESPONSE_BYTES)) as CodexModelsResponse,
          )
          log.info("refreshed codex models", { count })
        } catch (error) {
          // The account-specific endpoint is authoritative. If it is temporarily
          // unavailable, retain only models verified against the ChatGPT Codex
          // backend. The general OpenAI catalog contains IDs (for example the
          // plain gpt-5.6 model) that reject ChatGPT-account authentication.
          log.warn("failed to refresh codex models; using models.dev fallback", { error })
          CodexModels.applyFallback(provider.models)
        }

        for (const model of Object.values(provider.models)) {
          model.api.url = "https://chatgpt.com/backend-api/codex"
          model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          fetch: authenticatedFetch,
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus",
          type: "oauth",
          authorize: () => CodexOAuth.beginAuthorization(),
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
