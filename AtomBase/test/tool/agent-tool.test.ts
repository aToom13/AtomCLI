import { describe, test, expect } from "bun:test"
import "../preload"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "@/core/session"
import { SessionStatus } from "@/core/session/status"

describe("AgentTool", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test("defines correct parameters schema and action default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        expect(instance.description).toContain("Unified Agent tool")
        expect(instance.parameters).toBeDefined()
      },
    })
  })

  test("action='workflow' delegates to OrchestrateTool plan when tasks provided", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [
              { id: "task1", prompt: "Step 1 analysis", category: "analysis" },
              { id: "task2", prompt: "Step 2 code", category: "coding", dependsOn: ["task1"] },
            ],
          },
          dummyCtx,
        )

        expect(result.title).toBeDefined()
        expect(result.output).toContain("task1")
        expect(result.output).toContain("task2")
      },
    })
  })

  test("action='status' with workflowId delegates to OrchestrateTool status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "status",
            workflowId: "non-existent-wf-id",
          },
          dummyCtx,
        )

        expect(result.output).toContain('Workflow "non-existent-wf-id" not found')
      },
    })
  })

  test("action='status' with session_id returns status metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id, title: "Inspect files (@explore subagent)" })
        SessionStatus.set(child.id, { type: "busy" })
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "status",
            session_id: child.id,
          },
          { ...dummyCtx, sessionID: parent.id },
        )

        expect(result.title).toBe("Task Status")
        expect(result.output).toContain("is running")
        expect(result.metadata.sessionId).toBe(child.id)
        expect(result.metadata.status).toBe("running")
      },
    })
  })

  test("action='status' throws Error when neither workflowId nor session_id is provided", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        expect(instance.execute({ action: "status" }, dummyCtx)).rejects.toThrow(
          "Parameter 'workflowId' or 'session_id' is required for action='status'",
        )
      },
    })
  })

  test("action='abort' reports a missing workflow instead of a false success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "abort",
            workflowId: "non-existent-wf-id",
          },
          dummyCtx,
        )

        expect(result.metadata.error).toBe(true)
        expect(result.output).toContain('Workflow "non-existent-wf-id" not found')
      },
    })
  })

  test("action='workflow' permission gate asks default 'coder' when task omits agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const askCalls: Array<{ permission: string; patterns: string[]; metadata: any }> = []
        const recordingCtx = {
          ...dummyCtx,
          ask: async (req: any) => {
            askCalls.push(req)
          },
        }
        const result = await instance.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [
              { id: "no-agent-task", prompt: "Do something" },
              { id: "explicit-agent-task", prompt: "Do another", agent: "explore" },
            ],
          },
          recordingCtx,
        )

        expect(result.title).toBeDefined()
        expect(askCalls.length).toBe(2)
        expect(askCalls[0].permission).toBe("task")
        expect(askCalls[0].patterns).toEqual(["coder"])
        expect(askCalls[0].metadata.subagent_type).toBe("coder")
        expect(askCalls[1].patterns).toEqual(["explore"])
        expect(askCalls[1].metadata.subagent_type).toBe("explore")
      },
    })
  })

  test("action='workflow' skips permission gate when bypassAgentCheck is set", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const askCalls: Array<{ permission: string }> = []
        const bypassCtx = {
          ...dummyCtx,
          extra: { bypassAgentCheck: true },
          ask: async (req: any) => {
            askCalls.push(req)
          },
        }
        const result = await instance.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [{ id: "no-agent-task", prompt: "Do something" }],
          },
          bypassCtx,
        )

        expect(result.title).toBeDefined()
        expect(askCalls.length).toBe(0)
      },
    })
  })

  test("action='abort' with session_id validates ownership before delegating", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "abort",
            session_id: child.id,
          },
          { ...dummyCtx, sessionID: parent.id },
        )

        expect(result.title).toBe("Abort Successful")
        expect(result.output).toContain(child.id)
      },
    })
  })

  test("status rejects an unrelated session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const otherParent = await Session.create({})
        const foreignChild = await Session.create({ parentID: otherParent.id })
        const instance = await AgentTool.init({})

        expect(
          instance.execute({ action: "status", session_id: foreignChild.id }, { ...dummyCtx, sessionID: parent.id }),
        ).rejects.toThrow("is not a child of the current session")
      },
    })
  })

  test("workflow status rejects a workflow owned by another parent session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const owner = await Session.create({})
        const stranger = await Session.create({})
        const planned = await instance.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [{ id: "inspect", prompt: "Inspect orchestration", agent: "explore" }],
          },
          { ...dummyCtx, sessionID: owner.id, extra: { bypassAgentCheck: true } },
        )

        const result = await instance.execute(
          { action: "status", workflowId: planned.metadata.workflowId },
          { ...dummyCtx, sessionID: stranger.id },
        )

        expect(result.metadata.error).toBe(true)
        expect(result.output).toContain("does not belong to the current session")
      },
    })
  })
})
