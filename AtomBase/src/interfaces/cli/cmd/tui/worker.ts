import { Installation } from "@/services/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { InstanceBootstrap } from "@/services/project/bootstrap"
import { Rpc } from "@/util/util/rpc"
import { upgrade } from "@/interfaces/cli/upgrade"
import { Config } from "@/core/config/config"
import { Bus } from "@/core/bus"
import { GlobalBus } from "@/core/bus/global"
import type { BunWebSocketData } from "hono/bun"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  tui: true,
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Bun.Server<BunWebSocketData> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const request = new Request(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
    })
    const response = await Server.App().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = Server.listen(input)
    return { url: server.url.toString() }
  },
  async subscribe(input: { directory: string }) {
    return Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        Bus.subscribeAll((event) => {
          Rpc.emit("event", event)
        })
        // Emit connected event
        Rpc.emit("event", { type: "server.connected", properties: {} })
        return { subscribed: true }
      },
    })
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    await Instance.disposeAll()
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)
