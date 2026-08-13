import { describe, expect, test, beforeEach } from "bun:test"
import { LSPClient } from "@/integrations/lsp/client"
import { LSPServer } from "@/integrations/lsp/server"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"
import { PassThrough } from "stream"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"

// Minimal in-memory LSP server. Keeping both ends as Node streams exercises the
// same vscode-jsonrpc transport without depending on Bun child-process pipe
// behavior, which differs across Bun versions and operating systems.
function spawnFakeServer() {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const connection = createMessageConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  )
  connection.onRequest("initialize", async () => ({ capabilities: {} }))
  connection.listen()

  return {
    process: {
      stdin: clientToServer,
      stdout: serverToClient,
      pid: process.pid,
      kill() {
        connection.end()
        connection.dispose()
        clientToServer.destroy()
        serverToClient.destroy()
        return true
      },
    },
    request(method: string) {
      return connection.sendRequest(method, {})
    },
  }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    const result = await handle.request("workspace/workspaceFolders")
    expect(result).toEqual([{ name: "workspace", uri: new URL(`file://${process.cwd()}`).href }])

    await client.shutdown()
  })

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    expect(await handle.request("client/registerCapability")).toBeNull()

    await client.shutdown()
  })

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    expect(await handle.request("client/unregisterCapability")).toBeNull()

    await client.shutdown()
  })
})
