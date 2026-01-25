import { BusEvent } from "@/bus/bus-event"
import { Log } from "../util/log"
import { openAPIRouteHandler, generateSpecs, validator } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { proxy } from "hono/proxy"
import { websocket } from "hono/bun"
import { MDNS } from "./mdns"
import { QuestionRoute } from "./question"
import { McpRoute } from "./routes/mcp"
import { ProviderRoute } from "./routes/provider"
import { TuiRoute } from "./tui"
import { TuiGeneralRoute } from "./tui"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@atomcli/util/error"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { lazy } from "../util/lazy"

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
import { SystemRoute } from "./routes/system"
import { PermissionRoute } from "./routes/permission"

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
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
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
                version: "0.0.3",
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
        .route("/provider", ProviderRoute)
        .all("/*", async (c) => {
          const path = c.req.path
          const response = await proxy(`https://app.atomcli.ai${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.atomcli.ai",
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
          )
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "atomcli",
          version: "1.0.0",
          description: "atomcli api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
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
}
