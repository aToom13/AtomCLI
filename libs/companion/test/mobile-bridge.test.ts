import { describe, expect, test } from "bun:test"
import { EventEmitter } from "events"
import { MobileBridge } from "../src/mobile-bridge"

describe("MobileBridge", () => {
  test("forwards question events and keeps the pending snapshot authoritative", () => {
    const bus = new EventEmitter()
    const messages: Record<string, any>[] = []
    MobileBridge.initialize(bus)
    MobileBridge.registerClient("phone", (data) => messages.push(JSON.parse(data)))
    expect(MobileBridge.connectedClientCount()).toBe(1)

    bus.emit("event", {
      directory: "/home/user/project",
      payload: {
        type: "question.asked",
        properties: {
          id: "question_test",
          sessionID: "session_test",
          questions: [
            {
              header: "Choice",
              question: "Which option?",
              type: "select",
              options: [{ label: "A", description: "First" }],
            },
          ],
        },
      },
    })

    expect(messages.at(-1)).toMatchObject({
      type: "question_request",
      payload: {
        req_id: "question_test",
        sessionID: "session_test",
        directory: "/home/user/project",
      },
    })

    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.pending_questions).toHaveLength(1)

    bus.emit("event", {
      payload: {
        type: "question.replied",
        properties: {
          sessionID: "session_test",
          requestID: "question_test",
          answers: [["A"]],
        },
      },
    })
    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.pending_questions).toEqual([])

    bus.emit("event", {
      payload: {
        type: "companion.artifact.shared",
        properties: {
          id: "artifact_test",
          kind: "image",
          direction: "pc_to_mobile",
          sourceDevice: "cachyos-atom13",
          title: "Screenshot",
          name: "screen.png",
          mime: "image/png",
          size: 128,
          createdAt: 1000,
          downloadPath: "/companion/artifact/artifact_test?token=test",
        },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "artifact_shared",
      payload: { id: "artifact_test", sourceDevice: "cachyos-atom13" },
    })

    bus.emit("event", {
      payload: {
        type: "companion.preview.updated",
        properties: {
          id: "preview_test",
          title: "Documentation",
          command: "bun run dev",
          port: 3000,
          status: "running",
          endpoints: ["http://100.64.0.1:3000"],
          logTail: "ready",
          createdAt: 1000,
          sourceDevice: "cachyos-atom13",
          directory: "/home/user/project",
        },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "preview_updated",
      payload: { id: "preview_test", status: "running" },
    })

    bus.emit("event", {
      directory: "/home/user/project",
      payload: {
        type: "message.part.updated",
        properties: {
          delta: "stream",
          part: {
            id: "part_live",
            messageID: "message_live",
            sessionID: "session_live",
            type: "text",
            text: "stream",
          },
        },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "message_part",
      payload: {
        delta: "stream",
        part: { id: "part_live", sessionID: "session_live" },
      },
    })

    for (const directory of ["/home/user/project-a", "/home/user/project-b"]) {
      bus.emit("event", {
        directory,
        payload: {
          type: "tui.chain.add_step",
          properties: {
            name: "build",
            description: `Build ${directory}`,
            sessionID: `session_${directory.at(-1)}`,
          },
        },
      })
    }

    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.dag).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "build", directory: "/home/user/project-a" }),
        expect.objectContaining({ name: "build", directory: "/home/user/project-b" }),
      ]),
    )

    bus.emit("event", {
      directory: "/home/user/project-a",
      payload: { type: "tui.chain.start", properties: {} },
    })

    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.artifacts).toContainEqual(expect.objectContaining({ id: "artifact_test" }))
    expect(messages.at(-1)?.payload.previews).toContainEqual(expect.objectContaining({ id: "preview_test" }))
    expect(messages.at(-1)?.payload.dag).toEqual([
      expect.objectContaining({ name: "build", directory: "/home/user/project-b" }),
    ])
    expect(messages.at(-1)?.payload.bridge_epoch).toBe(MobileBridge.epoch())

    MobileBridge.unregisterClient("phone")
    expect(MobileBridge.connectedClientCount()).toBe(0)
  })

  test("can rebuild missed pending state from the server source of truth", () => {
    const messages: Record<string, any>[] = []
    MobileBridge.registerClient("reconnected-phone", (data) => messages.push(JSON.parse(data)))
    MobileBridge.replacePendingQuestions([
      {
        req_id: "question_recovered",
        sessionID: "session_recovered",
        questions: [{ header: "Recovered", question: "Still pending?", type: "text" }],
      },
    ])

    MobileBridge.sendSnapshot("reconnected-phone")

    expect(messages.at(-1)?.payload.pending_questions).toMatchObject([
      { req_id: "question_recovered", sessionID: "session_recovered" },
    ])
    MobileBridge.unregisterClient("reconnected-phone")
  })
})
