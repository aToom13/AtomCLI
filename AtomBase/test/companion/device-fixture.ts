// Real Companion routes and storage; only the model's HTTP endpoint is scripted.
import fs from "node:fs/promises"
import path from "node:path"
import { CompanionAuth, CompanionProtocol, MobileBridge } from "@atomcli/companion"
import { Server } from "@/server/server"
import { Instance } from "@/services/project/instance"
import { InstanceBootstrap } from "@/services/project/bootstrap"
import { Session } from "@/core/session"
import { SessionStatus } from "@/core/session/status"
import { Question } from "@/interfaces/question"
import { PermissionNext } from "@/util/permission/next"
import { CompanionTransfer } from "@/services/companion/transfer"

const directory = process.env.ATOMCLI_DEVICE_WORKSPACE
const stateFile = process.env.ATOMCLI_DEVICE_STATE
if (!directory || !stateFile || !process.env.ATOMCLI_TEST_HOME)
  throw new Error("Isolated device fixture paths required")
await fs.mkdir(directory, { recursive: true })
const resolved: Record<string, unknown> = {}
let activeCalls = 0
let peakCalls = 0
const activeMarkers = new Set<string>()
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname.endsWith("/models")) {
      return Response.json({ data: [{ id: "model", object: "model", owned_by: "device-fixture" }] })
    }
    const input = (await request.json()) as {
      messages?: Array<{ role: string; content: unknown }>
      tools?: Array<{ function: { name: string } }>
    }
    const messages = input.messages ?? []
    const prompt = [...messages]
      .reverse()
      .find((item) => item.role === "user" && JSON.stringify(item.content).includes("E2E_"))
    const marker = JSON.stringify(prompt?.content ?? "").match(/E2E_[A-Z0-9_]+/)?.[0] ?? "E2E_REPLY"
    const after = messages.slice(messages.indexOf(prompt!) + 1)
    const write = marker.startsWith("E2E_WRITE_") && !after.some((item) => item.role === "tool")
    activeCalls++
    activeMarkers.add(marker)
    peakCalls = Math.max(peakCalls, activeCalls)
    await Bun.sleep(marker.includes("SLOW") ? 10000 : 250)
    const delta = write
      ? {
          tool_calls: [
            {
              index: 0,
              id: `call_${marker}`,
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({ filePath: path.join(directory, `${marker}.txt`), content: marker }),
              },
            },
          ],
        }
      : { content: `Completed ${marker}` }
    const chunk = (delta: unknown, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: `reply_${marker}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    activeCalls--
    activeMarkers.delete(marker)
    return new Response(
      chunk({ role: "assistant", ...delta }, null) + chunk({}, write ? "tool_calls" : "stop") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})
await Bun.write(
  path.join(directory, "atomcli.json"),
  JSON.stringify({
    model: "device-fixture/model",
    small_model: "device-fixture/model",
    plugin: [],
    mcp: {},
    snapshot: false,
    share: "disabled",
    formatter: false,
    permission: { "*": "allow" },
    retention: { enabled: false },
    review: { enabled: false, policy: "off" },
    experimental: { execution_classification: false, smart_model_routing: false },
    provider: {
      "device-fixture": {
        npm: "@ai-sdk/openai-compatible",
        name: "Device fixture",
        options: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fake-companion-e2e-key" },
        models: { model: { name: "Device fixture", limit: { context: 32000, output: 2000 } } },
      },
    },
  }),
)
await Instance.provide({
  directory,
  init: InstanceBootstrap,
  fn: async () => {
    let companion = Server.listenCompanion({ port: 0, directory })
    const port = companion.port
    const inProject = <T>(fn: () => Promise<T>) => Instance.provide({ directory, fn })
    const control = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        return inProject(async () => {
          const url = new URL(request.url)
          if (url.pathname === "/pairing")
            return Response.json({
              v: CompanionProtocol.PAIRING_VERSION,
              pairing_token: CompanionAuth.issueToken(),
              http_pair: `http://127.0.0.1:${port}/companion/pair`,
              endpoints: [`ws://127.0.0.1:${port}/companion/ws`],
            })
          if (url.pathname === "/state") {
            const sessions = []
            for await (const session of Session.list()) {
              const messages = await Session.messages({ sessionID: session.id })
              sessions.push({ id: session.id, title: session.title, status: SessionStatus.get(session.id), messages })
            }
            const files: Record<string, string> = {}
            for (const name of await fs.readdir(directory))
              if (/^E2E_[A-Z0-9_]+\.txt$/.test(name)) files[name] = await Bun.file(path.join(directory, name)).text()
            return Response.json({
              directory,
              clients: MobileBridge.connectedClientCount(),
              sessions,
              files,
              resolved,
              peakCalls,
              activeCalls,
              activeMarkers: [...activeMarkers],
            })
          }
          if (url.pathname === "/requests") {
            const session = await Session.create({ title: "E2E decisions" })
            void Question.ask({
              sessionID: session.id,
              questions: [
                {
                  type: "select",
                  question: "E2E choose a value",
                  header: "E2E question",
                  options: [{ label: "Approved", description: "Fixture choice" }],
                },
              ],
            })
              .then((value) => {
                resolved.question = value
              })
              .catch((error) => {
                resolved.question = String(error)
              })
            void PermissionNext.ask({
              sessionID: session.id,
              permission: "bash",
              patterns: ["E2E command"],
              always: [],
              metadata: {},
              ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
            })
              .then(() => {
                resolved.permission = "allowed"
              })
              .catch(() => {
                resolved.permission = "denied"
              })
            return Response.json({ sessionID: session.id })
          }
          if (url.pathname === "/disconnect") {
            await companion.stop(true)
            setTimeout(() => {
              companion = Server.listenCompanion({ port, directory })
            }, 1500)
            return Response.json({ disconnected: true })
          }
          if (url.pathname === "/share") {
            const filePath = path.join(directory, "device-download.txt")
            await Bun.write(filePath, "E2E_DOWNLOAD_CONTENT")
            return Response.json(await CompanionTransfer.shareFile({ filePath }))
          }
          return new Response("Not found", { status: 404 })
        })
      },
    })
    await Bun.write(stateFile, JSON.stringify({ port, controlPort: control.port, directory }))
    await fs.chmod(stateFile, 0o600)
  },
})
