import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { CompanionAuth } from "@atomcli/companion"
import { CompanionProtocol } from "@/server/companion-protocol"
import { Server } from "@/server/server"
import { Question } from "@/interfaces/question"
import { Session } from "@/core/session"
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
  test("does not silently move a companion listener to another port", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = Server.listenCompanion({ port: 0, directory: tmp.path })
    try {
      expect(() => Server.listenCompanion({ port: first.port, directory: tmp.path })).toThrow(
        `Failed to start companion server on port ${first.port}`,
      )
    } finally {
      await first.stop(true)
    }
  })

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
      const modelList = await next((value) => value.type === "models_list")
      expect(Array.isArray(modelList.models)).toBe(true)
      const firstModel = (modelList.models as Array<Record<string, unknown>>)[0]
      if (firstModel) {
        expect(typeof firstModel.free).toBe("boolean")
        expect(typeof firstModel.reasoning).toBe("boolean")
        expect(Array.isArray(firstModel.variants)).toBe(true)
      }
      expect(Array.isArray((await next((value) => value.type === "session_list")).sessions)).toBe(true)

      const directoryRequestID = crypto.randomUUID()
      socket.send(
        JSON.stringify({
          type: "list_directories",
          path: tmp.path,
          client_request_id: directoryRequestID,
        }),
      )
      const directories = await next(
        (value) => value.type === "directories_result" && value.client_request_id === directoryRequestID,
      )
      expect(directories.status).toBe("ok")
      expect(directories.path).toBe(tmp.path)
      expect(Array.isArray(directories.directories)).toBe(true)

      const historySession = await Instance.provide({
        directory: tmp.path,
        fn: () => Session.create({}),
      })
      const historyRequestID = crypto.randomUUID()
      socket.send(
        JSON.stringify({
          type: "get_messages",
          session_id: historySession.id,
          client_request_id: historyRequestID,
        }),
      )
      const history = await next(
        (value) => value.type === "messages_result" && value.client_request_id === historyRequestID,
      )
      expect(history.status).toBe("ok")
      expect(history.session_id).toBe(historySession.id)
      expect(history.messages).toEqual([])

      const failedHistoryRequestID = crypto.randomUUID()
      socket.send(
        JSON.stringify({
          type: "get_messages",
          session_id: historySession.id,
          directory: "/",
          client_request_id: failedHistoryRequestID,
        }),
      )
      const failedHistory = await next(
        (value) => value.type === "action_result" && value.client_request_id === failedHistoryRequestID,
      )
      expect(failedHistory).toMatchObject({
        action: "get_messages",
        status: "error",
        id: historySession.id,
      })

      const commandRequestID = crypto.randomUUID()
      const command: Record<string, unknown> = {
        type: "command",
        action: "test",
        client_request_id: commandRequestID,
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
      const unsupported = await next(
        (value) => value.type === "action_result" && value.client_request_id === commandRequestID,
      )
      expect(unsupported.status).toBe("error")
      expect(unsupported.error).toBe("unsupported_command")
      socket.send(JSON.stringify(command))
      const replayed = await next(
        (value) => value.type === "action_result" && value.client_request_id === commandRequestID,
      )
      expect(replayed.status).toBe("error")
      expect(replayed.error).toBe("replayed_message")

      const pendingAnswer = Instance.provide({
        directory: tmp.path,
        fn: () =>
          Question.ask({
            sessionID: "session_mobile_test",
            questions: [
              {
                header: "Choice",
                question: "Which option?",
                type: "select",
                options: [{ label: "A", description: "First option" }],
              },
            ],
          }),
      })
      const question = await next((value) => value.type === "question_request")
      expect(question.payload).toMatchObject({
        sessionID: "session_mobile_test",
        directory: tmp.path,
        questions: [{ header: "Choice" }],
      })

      socket.send(JSON.stringify({ type: "request_snapshot" }))
      const snapshot = await next((value) => {
        if (value.type !== "snapshot") return false
        const pendingQuestions = (value.payload as Record<string, unknown>)?.pending_questions
        return (
          Array.isArray(pendingQuestions) &&
          pendingQuestions.some((pending) => (pending as Record<string, unknown>).sessionID === "session_mobile_test")
        )
      })
      expect((snapshot.payload as Record<string, unknown>).pending_questions).toContainEqual(
        expect.objectContaining({ sessionID: "session_mobile_test", directory: tmp.path }),
      )

      const questionPayload = question.payload as Record<string, unknown>
      const questionRequestID = crypto.randomUUID()
      const questionReply: Record<string, unknown> = {
        type: "question_reply",
        id: questionPayload.req_id,
        answers: [["A"]],
        directory: tmp.path,
        client_request_id: questionRequestID,
        connection_id: authenticated.connection_id,
        counter: 2,
        timestamp: Date.now(),
        device_name: deviceName,
      }
      questionReply.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(questionReply)),
        keyPair.privateKey,
      ).toString("base64")
      socket.send(JSON.stringify(questionReply))
      const replied = await next(
        (value) => value.type === "action_result" && value.client_request_id === questionRequestID,
      )
      expect(replied.status).toBe("ok")
      expect(await pendingAnswer).toEqual([["A"]])

      const pingTimestamp = Date.now()
      socket.send(JSON.stringify({ type: "ping", timestamp: pingTimestamp }))
      expect((await next((value) => value.type === "pong")).timestamp).toBe(pingTimestamp)

      const uploadRequestID = crypto.randomUUID()
      const createUpload: Record<string, unknown> = {
        type: "create_upload",
        session_id: historySession.id,
        filename: "phone.png",
        mime: "image/png",
        size: 4,
        directory: tmp.path,
        client_request_id: uploadRequestID,
        connection_id: authenticated.connection_id,
        counter: 3,
        timestamp: Date.now(),
        device_name: deviceName,
      }
      createUpload.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(createUpload)),
        keyPair.privateKey,
      ).toString("base64")
      socket.send(JSON.stringify(createUpload))
      const uploadTicket = await next(
        (value) => value.type === "action_result" && value.client_request_id === uploadRequestID,
      )
      expect(uploadTicket.status).toBe("ok")
      const uploadResponse = await fetch(`http://127.0.0.1:${server.port}${uploadTicket.upload_path}`, {
        method: "PUT",
        headers: { "content-type": "image/png", "content-length": "4" },
        body: new Uint8Array([137, 80, 78, 71]),
        signal: AbortSignal.timeout(3000),
      })
      expect(uploadResponse.status).toBe(200)
      expect(await uploadResponse.json()).toMatchObject({ status: "ok", artifact: { title: "phone.png" } })

      const requestID = crypto.randomUUID()
      const unpair: Record<string, unknown> = {
        type: "unpair",
        client_request_id: requestID,
        connection_id: authenticated.connection_id,
        counter: 4,
        timestamp: Date.now(),
        device_name: deviceName,
      }
      unpair.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(unpair)),
        keyPair.privateKey,
      ).toString("base64")
      socket.send(JSON.stringify(unpair))
      const unpaired = await next((value) => value.type === "action_result" && value.client_request_id === requestID)
      expect(unpaired.status).toBe("ok")
      expect(CompanionAuth.getDevice(deviceName)).toBeUndefined()
      socket.send(JSON.stringify({ type: "request_snapshot" }))
      expect((await next((value) => value.error === "authentication_required")).error).toBe("authentication_required")
    } finally {
      socket.close()
      await server.stop(true)
      await Instance.disposeAll()
      CompanionAuth.removeDevice(deviceName)
    }
  }, 15_000)
})
