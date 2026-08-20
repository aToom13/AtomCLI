import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock SubAgent.spawn so AgentTool spawn never hits a real model.
// The mock must be registered BEFORE agent-tool / orchestrate are imported.
const spawnMock = mock(async (args: any) => {
  const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
  const sessionId = "ses_" + Math.random().toString(36).slice(2, 14)
  await args.onSession?.({ sessionId, isNewSession: true })
  return {
    sessionId,
    isNewSession: true,
    output: isQA ? "VERDICT: PASSED\nIndependent verification complete." : "Task output: analysis done.",
    parts: [],
  }
})

mock.module("../../src/integrations/tool/subagent", () => ({
  SubAgent: {
    spawn: spawnMock,
    buildFromAgent: (agent: any) => [
      ...(agent.permission ?? []),
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
    buildPermissions: (parent: any[]) => [
      ...parent,
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  },
}))

const { AgentTool } = await import("@/integrations/tool/agent-tool")
const { Session } = await import("@/core/session")
const { Storage } = await import("@/core/storage/storage")
const { Identifier } = await import("@/core/id/id")
const { Instance } = await import("@/services/project/instance")
const { SessionTermination } = await import("@/core/session/termination")
const { HarnessState } = await import("@/core/session/harness-state")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(async (args: any) => {
    const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
    const sessionId = "ses_" + Math.random().toString(36).slice(2, 14)
    await args.onSession?.({ sessionId, isNewSession: true })
    return {
      sessionId,
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
  const msgInfo = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    parentID: userMessageID,
    time: { created: Date.now() },
    agent: "build",
    modelID: "hy3-free",
    providerID: "atomcli",
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

  test("spawn completes read-only analysis without a redundant reviewer", async () => {
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
        // Read-only analysis uses the primary sub-agent result directly.
        const descriptions = spawnMock.mock.calls.map(([args]) => (args as any).description)
        expect(descriptions.some((d) => d && d.startsWith("[QA"))).toBe(false)
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

  test("deleting a running child session does not resurrect it through retries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskSpawnCount = 0
        let reviewerSpawnCount = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
          if (isQA) {
            reviewerSpawnCount++
            return {
              sessionId: "ses_qa_unused",
              isNewSession: true,
              output: "VERDICT: PASSED",
              parts: [],
            }
          }

          taskSpawnCount++
          await args.onSession?.({ sessionId: "ses_deleted_child", isNewSession: true })
          // The real server abort route records this in the same worker isolate
          // before SessionPrompt.cancel wakes the orchestrator.
          SessionTermination.mark("ses_deleted_child")
          // SessionPrompt can resolve normally with a partial assistant message
          // after abort; the marker still has to suppress QA and retry.
          return {
            sessionId: "ses_deleted_child",
            isNewSession: true,
            output: "Partial output produced before cancellation",
            parts: [],
          }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Keep analyzing until stopped",
            description: "Cancelable analysis",
          },
          mockCtx(session.id, messageID),
        )

        expect(taskSpawnCount).toBe(1)
        expect(reviewerSpawnCount).toBe(0)
        expect(result.metadata?.status).toBe("failed")
        expect(result.output).toContain("1 failed")
      },
    })
  })

  test("deleting a running reviewer session does not recreate the reviewer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskSpawnCount = 0
        let reviewerSpawnCount = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
          if (!isQA) {
            taskSpawnCount++
            await args.onSession?.({ sessionId: "ses_task_under_review", isNewSession: true })
            HarnessState.addEditedFile("ses_task_under_review", "src/auth/token.ts")
            return {
              sessionId: "ses_task_under_review",
              isNewSession: true,
              output: "Task output awaiting review",
              parts: [],
            }
          }

          reviewerSpawnCount++
          await args.onSession?.({ sessionId: "ses_deleted_reviewer", isNewSession: true })
          SessionTermination.mark("ses_deleted_reviewer")
          // A streamed verdict may survive cancellation and resolve normally;
          // termination must win over that stale PASS.
          return {
            sessionId: "ses_deleted_reviewer",
            isNewSession: true,
            output: "VERDICT: PASSED\nPartial verdict before cancellation",
            parts: [],
          }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Implement a function and fix the code bug, then submit it for review",
            description: "Cancelable reviewer",
          },
          mockCtx(session.id, messageID),
        )

        expect(taskSpawnCount).toBe(1)
        expect(reviewerSpawnCount).toBe(1)
        expect(result.metadata?.status).toBe("failed")
      },
    })
  })
})
