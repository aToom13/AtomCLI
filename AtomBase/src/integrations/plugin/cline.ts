import type { Hooks, PluginInput } from "@atomcli/plugin"
import { Cline } from "@/integrations/provider/cline"
import { OAUTH_DUMMY_KEY } from "@/services/auth"
import { Log } from "@/util/util/log"

const REFRESH_BUFFER_MS = 5 * 60 * 1000
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

const log = Log.create({ service: "plugin.cline" })

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" }
const HTML_SUCCESS =
  "<!doctype html><title>AtomCLI</title><h1>Cline login complete</h1><p>You can close this window.</p>"
const errorPage = (message: string) =>
  `<!doctype html><title>AtomCLI</title><h1>Cline login failed</h1><p>${escapeHtml(message)}</p>`

export namespace ClineOAuth {
  type Pending = {
    path: string
    redirectUri: string
    resolve: (tokens: Cline.Tokens) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }

  let server: ReturnType<typeof Bun.serve> | undefined
  let pending: Pending | undefined

  export function stopServer() {
    if (pending) {
      clearTimeout(pending.timeout)
      pending = undefined
    }
    if (server) {
      server.stop()
      server = undefined
    }
  }

  export function errorHtml(message: string) {
    return errorPage(message)
  }

  export async function beginAuthorization(port = 0) {
    if (server || pending) throw new Error("A Cline OAuth authorization is already in progress")
    const secret = crypto.randomUUID()
    const path = `/auth/callback/${secret}`

    try {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(request) {
          const url = new URL(request.url)
          const current = pending
          if (!current || url.pathname !== current.path) return new Response("Not found", { status: 404 })

          const remoteError = url.searchParams.get("error_description") || url.searchParams.get("error")
          if (remoteError) {
            current.reject(new Error(remoteError))
            queueMicrotask(stopServer)
            return new Response(errorPage(remoteError), { status: 400, headers: HTML_HEADERS })
          }

          const code = url.searchParams.get("code")
          if (!code)
            return new Response(errorPage("Missing authorization code"), { status: 400, headers: HTML_HEADERS })

          try {
            const tokens = await Cline.exchangeAuthorizationCode(code, current.redirectUri)
            current.resolve(tokens)
            return new Response(HTML_SUCCESS, { headers: HTML_HEADERS })
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error))
            current.reject(failure)
            return new Response(errorPage(failure.message), { status: 502, headers: HTML_HEADERS })
          } finally {
            queueMicrotask(stopServer)
          }
        },
      })
    } catch (error) {
      server = undefined
      throw new Error(`Cline OAuth callback port ${port} is unavailable`, { cause: error })
    }

    const redirectUri = `http://127.0.0.1:${server.port}${path}`
    let current: Pending
    const callbackPromise = new Promise<Cline.Tokens>((resolve, reject) => {
      current = {
        path,
        redirectUri,
        resolve: (tokens) => {
          clearTimeout(current.timeout)
          resolve(tokens)
        },
        reject: (error) => {
          clearTimeout(current.timeout)
          reject(error)
        },
        timeout: setTimeout(() => {
          reject(new Error("Cline OAuth callback timed out"))
          stopServer()
        }, OAUTH_TIMEOUT_MS),
      }
      pending = current
    })

    const url = new URL(Cline.AUTHORIZE_URL)
    url.searchParams.set("client_type", "extension")
    url.searchParams.set("callback_url", redirectUri)
    url.searchParams.set("redirect_uri", redirectUri)

    return {
      url: url.toString(),
      instructions: "Complete Cline sign-in in your browser. This window will close automatically.",
      method: "auto" as const,
      callback: async () => {
        try {
          const tokens = await callbackPromise
          return { type: "success" as const, ...tokens }
        } finally {
          stopServer()
        }
      },
    }
  }
}

export async function ClineAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: Cline.PROVIDER_ID,
      async loader(getAuth, provider) {
        const initial = await getAuth()
        if (initial.type !== "oauth") return {}

        provider.name = "Cline"
        let refreshing: Promise<Cline.Tokens> | undefined

        const validTokens = async () => {
          const auth = await getAuth()
          if (auth.type !== "oauth") throw new Error("Cline authentication is unavailable")
          if (auth.access && auth.expires > Date.now() + REFRESH_BUFFER_MS) return auth

          refreshing ??= Cline.refreshToken(auth.refresh)
            .then(async (tokens) => {
              await input.client.auth.set({ providerID: Cline.PROVIDER_ID, auth: { type: "oauth", ...tokens } })
              return tokens
            })
            .finally(() => {
              refreshing = undefined
            })
          return refreshing
        }

        const authenticatedFetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
          const url = Cline.resolveRequestUrl(requestInput)
          const tokens = await validTokens()
          const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
          for (const [name, value] of new Headers(init?.headers)) headers.set(name, value)
          const target = requestInput instanceof Request ? new Request(url, requestInput) : url
          const response = await fetch(target, { ...init, headers: Cline.buildHeaders(tokens.access, headers) })
          return Cline.normalizeResponse(response)
        }

        try {
          const catalogResponse = await authenticatedFetch(Cline.MODELS_URL, {
            signal: AbortSignal.timeout(15_000),
          })
          if (!catalogResponse.ok) throw new Error(`Cline models endpoint returned ${catalogResponse.status}`)
          const [recommended, metadata] = await Promise.all([
            authenticatedFetch(Cline.RECOMMENDED_MODELS_URL, {
              signal: AbortSignal.timeout(15_000),
            })
              .then(async (response) => {
                if (!response.ok) throw new Error(`endpoint returned ${response.status}`)
                return Cline.readJsonBounded<Cline.RecommendedModels>(response)
              })
              .catch((error) => {
                log.warn("failed to load Cline promoted free models; using catalog suffixes", { error })
                return { free: [] }
              }),
            Cline.loadModelMetadata().catch((error) => {
              log.warn("failed to load Cline model metadata; using catalog IDs", { error })
              return []
            }),
          ])
          const count = Cline.applyModels(
            provider.models,
            await Cline.readJsonBounded(catalogResponse),
            recommended,
            metadata,
          )
          log.info("refreshed Cline free models", { count })
        } catch (error) {
          log.warn("failed to refresh Cline free models", { error })
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          baseURL: Cline.API_BASE_URL,
          fetch: authenticatedFetch,
        }
      },
      methods: [
        {
          label: "Cline (Browser login)",
          type: "oauth" as const,
          authorize: () => ClineOAuth.beginAuthorization(),
        },
      ],
    },
    dispose: async () => ClineOAuth.stopServer(),
  }
}

export async function ClineApiAuthPlugin(): Promise<Hooks> {
  return {
    auth: {
      provider: Cline.API_PROVIDER_ID,
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "api") return {}

        const authenticatedFetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
          const url = Cline.resolveRequestUrl(requestInput)
          const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
          for (const [name, value] of new Headers(init?.headers)) headers.set(name, value)
          const target = requestInput instanceof Request ? new Request(url, requestInput) : url
          const response = await fetch(target, { ...init, headers: Cline.buildApiHeaders(auth.key, headers) })
          return Cline.normalizeResponse(response)
        }

        try {
          const catalogResponse = await authenticatedFetch(Cline.MODELS_URL, {
            signal: AbortSignal.timeout(15_000),
          })
          if (!catalogResponse.ok) throw new Error(`Cline models endpoint returned ${catalogResponse.status}`)
          const [recommended, metadata] = await Promise.all([
            authenticatedFetch(Cline.RECOMMENDED_MODELS_URL, { signal: AbortSignal.timeout(15_000) })
              .then(async (response) => {
                if (!response.ok) throw new Error(`endpoint returned ${response.status}`)
                return Cline.readJsonBounded<Cline.RecommendedModels>(response)
              })
              .catch((error) => {
                log.warn("failed to load Cline Pass aliases; using full catalog", { error })
                return {}
              }),
            Cline.loadModelMetadata().catch((error) => {
              log.warn("failed to load Cline API model metadata; using catalog IDs", { error })
              return []
            }),
          ])
          const count = Cline.applyAllModels(
            provider.models,
            await Cline.readJsonBounded(catalogResponse),
            recommended,
            metadata,
          )
          log.info("refreshed Cline API models", { count })
        } catch (error) {
          log.warn("failed to refresh Cline API models", { error })
        }

        return {
          apiKey: auth.key,
          baseURL: Cline.API_BASE_URL,
          fetch: authenticatedFetch,
        }
      },
      methods: [{ label: "Cline API Token", type: "api" as const }],
    },
  }
}
