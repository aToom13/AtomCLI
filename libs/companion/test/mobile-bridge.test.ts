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

    bus.emit("event", {
      directory: "/home/user/project",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "message_failed",
            sessionID: "session_live",
            role: "assistant",
            error: {
              name: "APIError",
              data: {
                message: "Add credits token=private https://user:pass@example.test/buy?key=secret",
                statusCode: 402,
                isRetryable: false,
                responseBody: "sensitive provider response",
                responseHeaders: { authorization: "Bearer secret" },
              },
            },
          },
        },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "message_updated",
      payload: {
        info: {
          id: "message_failed",
          error: {
            name: "APIError",
            data: {
              message: "Add credits token=<redacted> https://example.test/buy",
              statusCode: 402,
              isRetryable: false,
            },
          },
        },
      },
    })
    expect(JSON.stringify(messages.at(-1))).not.toContain("sensitive provider response")
    expect(JSON.stringify(messages.at(-1))).not.toContain("user:pass")

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

    for (const workflowId of ["wf_one", "wf_two"]) {
      bus.emit("event", {
        directory: "/home/user/shared-project",
        payload: {
          type: "tui.chain.add_step",
          properties: {
            workflowId,
            stepId: "build",
            name: "build",
            description: workflowId,
            sessionID: "session_shared",
          },
        },
      })
    }
    bus.emit("event", {
      directory: "/home/user/shared-project",
      payload: {
        type: "tui.chain.parallel.update",
        properties: {
          workflowId: "wf_two",
          sessionID: "session_shared",
          stepIndex: 0,
          status: "running",
        },
      },
    })
    MobileBridge.sendSnapshot("phone")
    const shared = messages
      .at(-1)
      ?.payload.dag.filter((step: Record<string, unknown>) => step.directory === "/home/user/shared-project")
    expect(shared).toMatchObject([
      { workflowId: "wf_one", status: "pending" },
      { workflowId: "wf_two", status: "running" },
    ])

    bus.emit("event", {
      directory: "/home/user/shared-project",
      payload: {
        type: "tui.subagent.active",
        properties: {
          sessionId: "ses_child",
          parentSessionId: "session_shared",
          parentStepId: "build",
          agentType: "reviewer",
          description: "Review build",
        },
      },
    })
    bus.emit("event", {
      payload: {
        type: "tui.subagent.activity",
        properties: {
          sessionId: "ses_child",
          kind: "tool",
          label: "Running tests",
          status: "completed",
          output: "3 passed",
          time: 123,
        },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "sub_agent_activity",
      payload: { sessionID: "ses_child", label: "Running tests", output: "3 passed" },
    })
    for (const label of ["Draft", "Draft complete"]) {
      bus.emit("event", {
        payload: {
          type: "tui.subagent.activity",
          properties: { sessionId: "ses_child", kind: "transcript", label, time: 124 },
        },
      })
    }
    bus.emit("event", {
      payload: {
        type: "tui.subagent.failed",
        properties: { sessionId: "ses_child", error: "review failed" },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "sub_agent_failed",
      payload: { sessionID: "ses_child", error: "review failed" },
    })
    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.sub_agents).toContainEqual(
      expect.objectContaining({
        sessionID: "ses_child",
        parentStepId: "build",
        directory: "/home/user/shared-project",
        status: "failed",
        activities: [
          expect.objectContaining({ label: "Running tests", status: "completed" }),
          expect.objectContaining({ label: "Draft complete", kind: "transcript" }),
        ],
      }),
    )

    bus.emit("event", {
      directory: "/home/user/project-a",
      payload: { type: "tui.chain.start", properties: {} },
    })

    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.artifacts).toContainEqual(expect.objectContaining({ id: "artifact_test" }))
    expect(messages.at(-1)?.payload.previews).toContainEqual(expect.objectContaining({ id: "preview_test" }))
    expect(messages.at(-1)?.payload.dag).not.toContainEqual(
      expect.objectContaining({ name: "build", directory: "/home/user/project-a" }),
    )
    expect(messages.at(-1)?.payload.dag).toContainEqual(
      expect.objectContaining({ name: "build", directory: "/home/user/project-b" }),
    )
    expect(messages.at(-1)?.payload.bridge_epoch).toBe(MobileBridge.epoch())
    expect(messages.at(-1)?.bridge_epoch).toBe(MobileBridge.epoch())
    expect(messages.at(-1)?.payload.cursor).toEqual({
      bridge_epoch: MobileBridge.epoch(),
      seq_id: messages.at(-1)?.payload.current_seq_id,
    })

    bus.emit("event", {
      payload: {
        type: "companion.artifact.deleted",
        properties: { id: "artifact_test" },
      },
    })
    expect(messages.at(-1)).toMatchObject({
      type: "artifact_deleted",
      payload: { id: "artifact_test" },
    })
    MobileBridge.sendSnapshot("phone")
    expect(messages.at(-1)?.payload.artifacts).toEqual([])
    const sequenceBeforeIdleStream = messages.at(-1)?.payload.current_seq_id

    MobileBridge.unregisterClient("phone")
    expect(MobileBridge.connectedClientCount()).toBe(0)

    bus.emit("event", {
      directory: "/home/user/project",
      payload: {
        type: "message.part.updated",
        properties: {
          delta: "ignored while no phone is connected",
          part: {
            id: "part_idle",
            messageID: "message_idle",
            sessionID: "session_idle",
            type: "text",
            text: "ignored while no phone is connected",
          },
        },
      },
    })

    MobileBridge.registerClient("idle-probe", (data) => messages.push(JSON.parse(data)))
    MobileBridge.sendSnapshot("idle-probe")
    expect(messages.at(-1)?.payload.current_seq_id).toBe(sequenceBeforeIdleStream)
    MobileBridge.unregisterClient("idle-probe")
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

  test("rejects a cursor from another bridge epoch", () => {
    const messages: Record<string, any>[] = []
    MobileBridge.registerClient("stale-phone", (data) => messages.push(JSON.parse(data)))

    expect(MobileBridge.replayMissed("stale-phone", 0, crypto.randomUUID())).toBe("epoch_mismatch")
    expect(messages).toEqual([])

    MobileBridge.unregisterClient("stale-phone")
  })
})
