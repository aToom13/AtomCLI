import "../preload"
import { describe, expect, test, mock, spyOn } from "bun:test"
import fs from "fs/promises"
import path from "path"

// Controllable child: spawn returns a promise we resolve later, so we can prove
// the tool call resolves BEFORE the background child completes.
let spawnCalled = false
let childResolved = false
let resolveChild: (result: any) => void = () => {}
const childPromise = new Promise<any>((resolve) => {
  resolveChild = (result) => {
    childResolved = true
    resolve(result)
  }
})

// Mock SubAgent.spawn BEFORE the task tool is imported so the background spawn
// is fully under test control (no real model, no real event loop child).
mock.module("../../src/integrations/tool/subagent", () => ({
  SubAgent: {
    spawn: () => {
      spawnCalled = true
      return childPromise
    },
    status: () => ({ status: "running" }),
    wait: async () => ({}),
    cancel: async () => {},
    capabilities: () => ({ wait: true, status: true, revive: true, steer: false }),
    buildFromAgent: (agent: any) => [...(agent?.permission ?? [])],
    buildPermissions: (parent: any[]) => parent,
  },
}))

const { TaskTool } = await import("@/integrations/tool/task")
const { Session } = await import("@/core/session")
const { Storage } = await import("@/core/storage/storage")
const { Identifier } = await import("@/core/id/id")
const { Instance } = await import("@/services/project/instance")
const { WorkflowFS } = await import("@/integrations/tool/workflow-fs")
const { tmpdir } = await import("../fixture/fixture")

async function createAssistantMessageContext() {
  const session = await Session.create({})
  const userMessageID = Identifier.create("message", false)
  const messageID = Identifier.create("message", false)
  await Storage.write(["message", session.id, userMessageID], {
    id: userMessageID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() - 1 },
    agent: "build",
    model: { providerID: "atomcli", modelID: "hy3-free" },
  })
  await Storage.write(["message", session.id, messageID], {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    parentID: userMessageID,
    time: { created: Date.now() },
    agent: "build",
    modelID: "hy3-free",
    providerID: "atomcli",
    mode: "",
  })
  return { session, messageID }
}

const mockCtx = (sessionID: string, messageID: string) => ({
  sessionID,
  messageID,
  callID: "call-1",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms))

describe("task.run background contract", () => {
  test("returns before the child completes; the result lands only after", async () => {
    await using tmp = await tmpdir({ git: false })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        spawnCalled = false
        childResolved = false
        const ctx = mockCtx(session.id, messageID)
        const tool = await TaskTool.init()
        const writeSuccess = spyOn(WorkflowFS, "writeSuccess").mockResolvedValue(undefined)

        try {
          // The tool must resolve while the child is still pending (non-blocking).
          const result = await tool.execute(
            { description: "background task", prompt: "do some work", subagent_type: "explore" },
            ctx,
          )
          expect(result.output).toContain("started in background")
          const childSessionID = result.metadata.sessionId
          expect(childSessionID).toBeTruthy()

          // Let the detached setTimeout closure start and reach SubAgent.spawn.
          await flush()

          // The child was launched in the background and has NOT completed yet,
          // yet the tool call already returned -> task.run is non-blocking.
          expect(spawnCalled).toBe(true)
          expect(childResolved).toBe(false)
          expect(writeSuccess).not.toHaveBeenCalled()

          // Complete the child now; the background closure writes the result file.
          resolveChild({
            sessionId: childSessionID,
            isNewSession: true,
            output: "DONE: background work complete",
            parts: [],
          })
          await flush()

          expect(childResolved).toBe(true)
          expect(writeSuccess).toHaveBeenCalled()
          const calls = writeSuccess.mock.calls as unknown as Array<unknown[]>
          const last = calls[calls.length - 1]
          expect(last[0]).toBe(`task_${childSessionID}`)
          expect(String(last[3])).toContain("DONE: background work complete")
        } finally {
          writeSuccess.mockRestore()
        }
      },
    })
  })
})
