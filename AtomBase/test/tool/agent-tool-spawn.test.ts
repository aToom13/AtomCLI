import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock SubAgent.spawn so AgentTool spawn never hits a real model.
// The mock must be registered BEFORE agent-tool / orchestrate are imported.
const spawnMock = mock(async (args: any) => {
  const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
  return {
    sessionId: "ses_" + Math.random().toString(36).slice(2, 14),
    isNewSession: true,
    output: isQA ? "VERDICT: PASSED\nIndependent verification complete." : "Task output: analysis done.",
    parts: [],
  }
})

mock.module("../../src/integrations/tool/subagent", () => ({
  SubAgent: {
    spawn: spawnMock,
    buildFromAgent: (agent: any) => agent.permission ?? [],
    buildPermissions: (parent: any[]) => parent,
  },
}))

const { AgentTool } = await import("@/integrations/tool/agent-tool")
const { Session } = await import("@/core/session")
const { Storage } = await import("@/core/storage/storage")
const { Identifier } = await import("@/core/id/id")
const { Instance } = await import("@/services/project/instance")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(async (args: any) => {
    const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
    return {
      sessionId: "ses_" + Math.random().toString(36).slice(2, 14),
      isNewSession: true,
      output: isQA ? "VERDICT: PASSED\nIndependent verification complete." : "Task output: analysis done.",
      parts: [],
    }
  })
})

function mockCtx(sessionID: string, messageID: string) {
  return {
    sessionID,
    messageID,
    callID: "call-123",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => {},
    ask: async () => {},
    extra: { bypassAgentCheck: true },
  }
}

async function createAssistantMessageContext() {
  const session = await Session.create({})
  const messageID = Identifier.create("message", false)
  const msgInfo = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    time: { created: Date.now() },
    agent: "build",
    modelID: "test",
    providerID: "test",
    mode: "",
  }
  await Storage.write(["message", session.id, messageID], msgInfo)
  return { session, messageID }
}

describe("AgentTool spawn (blocking orchestrator behavior)", () => {
  test("spawn without required params throws validation error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const ctx = mockCtx("ses-test-1", Identifier.create("message", false))

        expect(instance.execute({ action: "spawn", prompt: "do something" }, ctx)).rejects.toThrow(
          "subagent_type, prompt, and description are required",
        )
      },
    })
  })

  test("spawn runs a single-task blocking workflow with reviewer QA and returns success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})

        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Analyze the codebase structure",
            description: "Analyze codebase",
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        expect(result.metadata?.error).toBe(false)
        expect(result.output).toContain("1 succeeded")
        expect(spawnMock).toHaveBeenCalled()
        // The task spawn and the reviewer QA spawn both went through SubAgent.spawn
        const descriptions = spawnMock.mock.calls.map(([args]) => (args as any).description)
        expect(descriptions.some((d) => d && d.startsWith("[QA"))).toBe(true)
      },
    })
  })

  test("spawn passes session_id through to the workflow task for session continuation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})

        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Analyze the codebase structure",
            description: "Analyze codebase",
            session_id: "ses-existing-123",
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        const spawnArgs = spawnMock.mock.calls.map(([args]) => args as any)
        const taskSpawn = spawnArgs.find((a) => a.description && !a.description.startsWith("[QA"))
        expect(taskSpawn?.sessionId).toBe("ses-existing-123")
      },
    })
  })
})
