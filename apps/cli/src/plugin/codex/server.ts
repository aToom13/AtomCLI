import { Log } from "../../util/log"
import { OAUTH_PORT } from "./constants"
import { exchangeCodeForTokens, type PkceCodes, type TokenResponse } from "./utils"

const log = Log.create({ service: "plugin.codex.server" })

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
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
    pkce: PkceCodes
    state: string
    resolve: (tokens: TokenResponse) => void
    reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

export async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
    if (oauthServer) {
        return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
    }

    oauthServer = Bun.serve({
        port: OAUTH_PORT,
        fetch(req) {
            const url = new URL(req.url)

            if (url.pathname === "/auth/callback") {
                const code = url.searchParams.get("code")
                const state = url.searchParams.get("state")
                const error = url.searchParams.get("error")
                const errorDescription = url.searchParams.get("error_description")

                if (error) {
                    const errorMsg = errorDescription || error
                    pendingOAuth?.reject(new Error(errorMsg))
                    pendingOAuth = undefined
                    return new Response(HTML_ERROR(errorMsg), {
                        headers: { "Content-Type": "text/html" },
                    })
                }

                if (!code) {
                    const errorMsg = "Missing authorization code"
                    pendingOAuth?.reject(new Error(errorMsg))
                    pendingOAuth = undefined
                    return new Response(HTML_ERROR(errorMsg), {
                        status: 400,
                        headers: { "Content-Type": "text/html" },
                    })
                }

                if (!pendingOAuth || state !== pendingOAuth.state) {
                    const errorMsg = "Invalid state - potential CSRF attack"
                    pendingOAuth?.reject(new Error(errorMsg))
                    pendingOAuth = undefined
                    return new Response(HTML_ERROR(errorMsg), {
                        status: 400,
                        headers: { "Content-Type": "text/html" },
                    })
                }

                const current = pendingOAuth
                pendingOAuth = undefined

                exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
                    .then((tokens) => current.resolve(tokens))
                    .catch((err) => current.reject(err))

                return new Response(HTML_SUCCESS, {
                    headers: { "Content-Type": "text/html" },
                })
            }

            if (url.pathname === "/cancel") {
                pendingOAuth?.reject(new Error("Login cancelled"))
                pendingOAuth = undefined
                return new Response("Login cancelled", { status: 200 })
            }

            return new Response("Not found", { status: 404 })
        },
    })

    log.info("codex oauth server started", { port: OAUTH_PORT })
    return { port: OAUTH_PORT, redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

export function stopOAuthServer() {
    if (oauthServer) {
        oauthServer.stop()
        oauthServer = undefined
        log.info("codex oauth server stopped")
    }
}

export function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => {
                if (pendingOAuth) {
                    pendingOAuth = undefined
                    reject(new Error("OAuth callback timeout - authorization took too long"))
                }
            },
            5 * 60 * 1000,
        ) // 5 minute timeout

        pendingOAuth = {
            pkce,
            state,
            resolve: (tokens) => {
                clearTimeout(timeout)
                resolve(tokens)
            },
            reject: (error) => {
                clearTimeout(timeout)
                reject(error)
            },
        }
    })
}
