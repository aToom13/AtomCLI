import "../preload"
import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { CompanionAuth } from "@atomcli/companion"
import { CompanionProtocol } from "@/server/companion-protocol"
import { Server } from "@/server/server"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Bus } from "@/core/bus"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
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

describe("companion checkpoint transport", () => {
  test("delivers checkpoint parts through live events, history and snapshots", async () => {
    await using tmp = await tmpdir({ git: true })
    const keyPair = generateKeyPairSync("ed25519")
    const publicDer = keyPair.publicKey.export({ format: "der", type: "spki" })
    const deviceName = `test-device-${crypto.randomUUID()}`
    const deviceId = `test-installation-${crypto.randomUUID()}`

    // The user message is created before the companion listener boots:
    // InstanceBootstrap registers ShareNext which resolves user-message models
    // through Provider.getModel, and the test catalog has no credentialed
    // providers. Transport behavior does not depend on that ordering.
    const seed = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "xai", modelID: "grok-4-fast-non-reasoning" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "do the work",
        })
        return { sessionID: session.id, userID }
      },
    })

    const server = Server.listenCompanion({ port: 0, directory: tmp.path })
    const pairResponse = await fetch(`http://127.0.0.1:${server.port}/companion/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_token: CompanionAuth.issueToken(),
        public_key: publicDer.subarray(publicDer.length - 32).toString("base64"),
        device_name: deviceName,
        device_id: deviceId,
      }),
    })
    expect(pairResponse.status).toBe(200)

    const checkpointEvents: Array<Record<string, unknown>> = []
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/companion/ws`)
    const next = messages(socket)

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true })
        socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true })
      })

      const challenge = await next((value) => value.type === "auth_challenge")
      const authentication: Record<string, unknown> = {
        type: "authenticate",
        challenge: challenge.challenge,
        timestamp: Date.now(),
        device_name: deviceName,
        device_id: deviceId,
        protocol_version: 3,
        capabilities: ["core.sync", "identity.v1", "actions.signed"],
      }
      authentication.signature = sign(
        null,
        Buffer.from(CompanionProtocol.canonicalPayload(authentication)),
        keyPair.privateKey,
      ).toString("base64")
      socket.send(JSON.stringify(authentication))
      await next((value) => value.type === "auth_ok")
      await next((value) => value.type === "snapshot")

      // The assistant message and checkpoint part are created after auth so
      // the live relay path (message.part.updated -> message_part) is
      // exercised end to end.
      const setup = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Bus state is project-scoped, so subscribe inside the instance.
          const unsubscribe = Bus.subscribe(ExecutionRuntime.Event.Checkpoint, (event) =>
            checkpointEvents.push(event.properties as Record<string, unknown>),
          )
          try {
            const assistantID = Identifier.ascending("message")
            await Session.updateMessage({
              id: assistantID,
              sessionID: seed.sessionID,
              role: "assistant",
              parentID: seed.userID,
              agent: "build",
              path: { cwd: tmp.path, root: tmp.path },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: "grok-4-fast-non-reasoning",
              providerID: "xai",
              time: { created: Date.now() },
            })
            await Session.updatePart({
              id: Identifier.ascending("part"),
              messageID: assistantID,
              sessionID: seed.sessionID,
              type: "checkpoint",
              sequence: 1,
              decision: "continue",
              requestedCalls: 30,
              grantedCalls: 30,
              objectiveAssessment: "objective intact",
              progressSummary: "halfway",
              discoveries: ["found the seam"],
              completedWork: ["implemented parser"],
              remainingWork: ["wire the renderer"],
              failures: [],
              blockers: [],
              routeAssessment: "route is appropriate",
              nextActions: ["wire the renderer"],
              runtime: {
                executionID: "exec_cp_transport",
                reason: "requested",
                model: "xai/grok-4-fast-non-reasoning",
                allowance: { limit: 50, used: 20, extensions: 1, toolCalls: 20 },
              },
            })
            const execution = await ExecutionRuntime.resolveInvocation({
              sessionID: seed.sessionID,
              invocationID: seed.userID,
            })
            ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("test"))
            ExecutionRuntime.applyCheckpoint(
              execution.executionID,
              assistantID,
              {
                decision: "continue",
                requestedCalls: 30,
                objectiveAssessment: "objective intact",
                progressSummary: "halfway",
                discoveries: ["found the seam"],
                completedWork: ["implemented parser"],
                remainingWork: ["wire the renderer"],
                failures: [],
                blockers: [],
                routeAssessment: "route is appropriate",
                routeDecision: "keep" as const,
                selfCritique: "No issues.",
                failedApproaches: [],
                whatToChanges: [],
                planChanged: false,
                routeChanged: false,
                estimatedRemainingCalls: 30,
                nextActions: ["wire the renderer"],
              },
              undefined,
              { triggerMessageID: seed.userID },
            )
            return { assistantID, executionID: execution.executionID }
          } finally {
            unsubscribe()
          }
        },
      })

      // COMP-CP-01: the live bridge relays the checkpoint part with its data.
      const live = await next(
        (value) => value.type === "message_part" && (value.payload as Record<string, any>)?.part?.type === "checkpoint",
      )
      expect((live.payload as Record<string, any>).part).toMatchObject({
        messageID: setup.assistantID,
        sessionID: seed.sessionID,
        type: "checkpoint",
        sequence: 1,
        decision: "continue",
        grantedCalls: 30,
        progressSummary: "halfway",
        completedWork: ["implemented parser"],
        remainingWork: ["wire the renderer"],
        runtime: {
          allowance: { limit: 50, used: 20, extensions: 1, toolCalls: 20 },
        },
      })

      // COMP-CP-05: the checkpoint event must bind to the owning message.
      expect(checkpointEvents.at(-1)).toMatchObject({
        sessionID: seed.sessionID,
        executionID: setup.executionID,
        messageID: setup.assistantID,
        triggerMessageID: seed.userID,
        sequence: 1,
      })

      // COMP-CP-02: history must carry every checkpoint field.
      const historyRequestID = crypto.randomUUID()
      socket.send(
        JSON.stringify({
          type: "get_messages",
          session_id: seed.sessionID,
          client_request_id: historyRequestID,
        }),
      )
      const history = await next(
        (value) => value.type === "messages_result" && value.client_request_id === historyRequestID,
      )
      expect(history.status).toBe("ok")
      const serialized = (history.messages as Array<Record<string, any>>).find((m) => m.id === setup.assistantID)
      expect(serialized).toBeDefined()
      const checkpointPart = serialized!.parts.find((p: Record<string, unknown>) => p.type === "checkpoint")
      expect(checkpointPart).toMatchObject({
        messageID: setup.assistantID,
        sessionID: seed.sessionID,
        type: "checkpoint",
        sequence: 1,
        decision: "continue",
        requestedCalls: 30,
        grantedCalls: 30,
        objectiveAssessment: "objective intact",
        progressSummary: "halfway",
        discoveries: ["found the seam"],
        completedWork: ["implemented parser"],
        remainingWork: ["wire the renderer"],
        failures: [],
        blockers: [],
        routeAssessment: "route is appropriate",
        nextActions: ["wire the renderer"],
        runtime: {
          executionID: "exec_cp_transport",
          reason: "requested",
          model: "xai/grok-4-fast-non-reasoning",
          allowance: { limit: 50, used: 20, extensions: 1, toolCalls: 20 },
        },
      })

      // COMP-CP-06: snapshots carry the latest checkpoint per active execution.
      socket.send(JSON.stringify({ type: "request_snapshot" }))
      const snapshot = await next((value) => value.type === "snapshot")
      const recent = (snapshot.payload as Record<string, any>).recent_checkpoints as Array<Record<string, any>>
      const entry = recent.find((item) => item.executionID === setup.executionID)
      expect(entry).toBeDefined()
      expect(entry).toMatchObject({
        sessionID: seed.sessionID,
        executionID: setup.executionID,
        directory: tmp.path,
        part: {
          type: "checkpoint",
          messageID: setup.assistantID,
          sequence: 1,
          decision: "continue",
          progressSummary: "halfway",
        },
      })
    } finally {
      socket.close()
      await server.stop(true)
    }
  })
})
