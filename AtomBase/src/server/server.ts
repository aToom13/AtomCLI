import { BusEvent } from "@/core/bus/bus-event"
import { Log } from "@/util/util/log"
import { openAPIRouteHandler, generateSpecs, validator } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { websocket } from "hono/bun"
import { MDNS } from "./mdns"
import { QuestionRoute } from "./question"
import { McpRoute } from "./routes/mcp"
import { ProviderRoute } from "./routes/provider"
import { TuiRoute } from "./tui"
import { TuiGeneralRoute } from "./tui"
import z from "zod"
import { Provider } from "@/integrations/provider/provider"
import { NamedError } from "@atomcli/util/error"
import { Instance } from "@/services/project/instance"
import { InstanceBootstrap } from "@/services/project/bootstrap"
import { Storage } from "@/core/storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { lazy } from "@/util/util/lazy"

import { ProjectRoute } from "./project"
import { PtyRoute } from "./routes/pty"
import { GlobalRoute } from "./routes/global"
import { ConfigRoute } from "./routes/config"
import { ToolRoute } from "./routes/tool"
import { InstanceRoute } from "./routes/instance"
import { SessionRoute } from "./routes/session/index"
import { FileRoute } from "./routes/file"
import { FindRoute } from "./routes/find"
import { AuthRoute } from "./routes/auth"
import { AgentRoute } from "./routes/agent"
import { CommandRoute } from "./routes/command"
import { SkillRoute } from "./routes/skill"
import { SystemRoute } from "./routes/system"
import { PermissionRoute } from "./routes/permission"
import { LspRoute } from "./routes/lsp"
import { FormatterRoute } from "./routes/formatter"
import { CompanionRoute, CompanionPairRoute } from "./companion"
import { ServerSecurity } from "./security"
import { Installation } from "@/services/installation"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  export const Event = {
    Connected: BusEvent.define("server.connected", z.object({})),
    Disposed: BusEvent.define("global.disposed", z.object({})),
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof Storage.NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          // F21: only create timer when logging is active
          let timer: ReturnType<typeof log.time> | undefined
          if (!skipLogging) {
            timer = log.time("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          await next()
          timer?.stop()
        })
        .use(
          cors({
            origin(input) {
              if (!input) return

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (input === "tauri://localhost" || input === "http://tauri.localhost") return input

              // *.atomcli.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*atomcli\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoute)
        .use(async (c, next) => {
          let directory = c.req.query("directory") || c.req.header("x-atomcli-directory") || process.cwd()
          try {
            directory = decodeURIComponent(directory)
          } catch {
            // fallback to original value
          }
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "atomcli",
                version: Installation.VERSION,
                description: "atomcli api",
              },
              openapi: "3.1.1",
            },
          }),
        )
        .use(validator("query", z.object({ directory: z.string().optional() })))
        .route("/project", ProjectRoute)
        .route("/pty", PtyRoute)
        .route("/config", ConfigRoute)
        .route("/file", FileRoute)
        .route("/find", FindRoute)
        .route("/auth", AuthRoute) // Mounted at /auth
        .route("/agent", AgentRoute)
        .route("/command", CommandRoute)
        .route("/", SystemRoute) // Mounted at / (handles /log, /event)
        .route("/", PermissionRoute) // Mounted at / (handles /permission, /session/.../permissions)
        .route("/experimental/tool", ToolRoute)
        .route("/instance", InstanceRoute)
        .route("/", InstanceRoute)
        .route("/session", SessionRoute)
        .route("/tui", TuiGeneralRoute)
        .route("/tui/control", TuiRoute)
        .route("/question", QuestionRoute)
        .route("/mcp", McpRoute)
        .route("/skill", SkillRoute)
        .route("/provider", ProviderRoute)
        .route("/lsp", LspRoute)
        .route("/formatter", FormatterRoute)
        .all("/dashboard", (c) => c.notFound())
        .all("/dashboard/*", (c) => c.notFound())
        .all("/companion/*", (c) => c.notFound())
        .all("/*", (c) => c.json({ error: "route_not_found" }, 404)) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "atomcli",
          version: Installation.VERSION,
          description: "atomcli api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export interface ListenOptions {
    port: number
    hostname: string
    mdns?: boolean
    cors?: string[]
    auth?: string
  }

  function securedFetch(app: Hono, policy: ServerSecurity.RequestPolicy) {
    return (request: Request, server?: unknown) => {
      const rejection = ServerSecurity.reject(request, policy)
      if (rejection) return rejection
      return app.fetch(request, server as never)
    }
  }

  export function listen(opts: ListenOptions) {
    if (!ServerSecurity.isLoopback(opts.hostname) && !opts.auth) {
      throw new Error(`Refusing non-loopback control-plane bind on ${opts.hostname} without --auth`)
    }
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: securedFetch(App(), {
        authToken: opts.auth,
        allowedHosts: [opts.hostname],
        allowedOrigins: opts.cors,
      }),
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : (tryServe(opts.port) ?? tryServe(0))
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, `atomcli-${server.port!}`)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }

  export function listenCompanion(opts: { port: number; directory: string; hostname?: string }) {
    const hostname = opts.hostname ?? "0.0.0.0"
    const companionApp = new Hono()
      .use(async (_c, next) =>
        Instance.provide({
          directory: opts.directory,
          init: InstanceBootstrap,
          fn: next,
        }),
      )
      .route("/", CompanionPairRoute)
      .route("/", CompanionRoute)

    const args = {
      hostname,
      idleTimeout: 0,
      fetch: securedFetch(companionApp, { allowedHosts: [hostname] }),
      websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = tryServe(opts.port)
    if (!server) {
      throw new Error(
        opts.port === 0
          ? "Failed to start companion server on an available port"
          : `Failed to start companion server on port ${opts.port}. The port is already in use or unavailable.`,
      )
    }
    return server
  }
}
