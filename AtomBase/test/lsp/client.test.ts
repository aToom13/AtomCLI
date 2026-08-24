import "../preload"
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
function spawnFakeServer(capabilities: Record<string, unknown> = {}) {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const connection = createMessageConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  )
  connection.onRequest("initialize", async () => ({ capabilities }))
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
    request(method: string, params: unknown = {}) {
      return connection.sendRequest(method, params)
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

  test("retains server capabilities for feature negotiation", async () => {
    const handle = spawnFakeServer({ renameProvider: true, documentFormattingProvider: true }) as any
    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
        }),
    })

    expect(client.capabilities.renameProvider).toBe(true)
    expect(client.capabilities.documentFormattingProvider).toBe(true)
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

    expect(
      await handle.request("client/registerCapability", {
        registrations: [{ id: "rename", method: "workspace/willRenameFiles" }],
      }),
    ).toBeNull()
    expect(client.supports("workspace/willRenameFiles")).toBe(true)

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

    await handle.request("client/registerCapability", {
      registrations: [
        { id: "rename-1", method: "workspace/willRenameFiles" },
        { id: "rename-2", method: "workspace/willRenameFiles" },
      ],
    })
    expect(client.supports("workspace/willRenameFiles")).toBe(true)
    expect(
      await handle.request("client/unregisterCapability", {
        unregisterations: [{ id: "rename-1", method: "workspace/willRenameFiles" }],
      }),
    ).toBeNull()
    expect(client.supports("workspace/willRenameFiles")).toBe(true)
    expect(
      await handle.request("client/unregisterCapability", {
        unregistrations: [{ id: "rename-2", method: "workspace/willRenameFiles" }],
      }),
    ).toBeNull()
    expect(client.supports("workspace/willRenameFiles")).toBe(false)

    await client.shutdown()
  })
})
