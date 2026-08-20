import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { CompanionAuth } from "@atomcli/companion"
import { CompanionProtocol } from "@/server/companion-protocol"
import { Server } from "@/server/server"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

function messages(socket: WebSocket) {
  const queue: Array<Record<string, unknown>> = []
  const waiters: Array<{
    predicate: (value: Record<string, unknown>) => boolean
    resolve: (value: Record<string, unknown>) => void
  }> = []

  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data)) as Record<string, unknown>
    const index = waiters.findIndex((waiter) => waiter.predicate(value))
    if (index >= 0) {
      waiters.splice(index, 1)[0]!.resolve(value)
      return
    }
    queue.push(value)
  })

  return (predicate: (value: Record<string, unknown>) => boolean) => {
    const index = queue.findIndex(predicate)
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]!)
    return Promise.race([
      new Promise<Record<string, unknown>>((resolve) => waiters.push({ predicate, resolve })),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for companion message")), 3000),
      ),
    ])
  }
}

describe("companion authentication", () => {
  test("sends no snapshot before challenge authentication and rejects replayed mutations", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyPair = generateKeyPairSync("ed25519")
    const publicDer = keyPair.publicKey.export({ format: "der", type: "spki" })
    const deviceName = `test-device-${crypto.randomUUID()}`
    CompanionAuth.registerDevice(deviceName, publicDer.subarray(publicDer.length - 32).toString("base64"))

    const server = Server.listenCompanion({ port: 0, directory: tmp.path })
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/companion/ws`)
    const next = messages(socket)

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true })
        socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true })
      })

      const challenge = await next((value) => value.type === "auth_challenge")
      socket.send(JSON.stringify({ type: "request_snapshot" }))
      expect((await next((value) => value.error === "authentication_required")).error).toBe("authentication_required")

      const authentication: Record<string, unknown> = {
        type: "authenticate",
        challenge: challenge.challenge,
        timestamp: Date.now(),
        device_name: deviceName,
      }
      authentication.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(authentication)),
        keyPair.privateKey,
      ).toString("base64")
      socket.send(JSON.stringify(authentication))

      const authenticated = await next((value) => value.type === "auth_ok")
      const command: Record<string, unknown> = {
        type: "command",
        action: "test",
        connection_id: authenticated.connection_id,
        counter: 1,
        timestamp: Date.now(),
        device_name: deviceName,
      }
      command.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(command)),
        keyPair.privateKey,
      ).toString("base64")

      socket.send(JSON.stringify(command))
      expect((await next((value) => value.status === "ok" && value.action === "test")).status).toBe("ok")
      socket.send(JSON.stringify(command))
      expect((await next((value) => value.error === "replayed_message")).error).toBe("replayed_message")
    } finally {
      socket.close()
      await server.stop(true)
      await Instance.disposeAll()
      CompanionAuth.removeDevice(deviceName)
    }
  })
})
