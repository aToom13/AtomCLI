import { describe, test, expect } from "bun:test"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

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
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "status",
            session_id: "test-session-123",
          },
          dummyCtx,
        )

        expect(result.title).toBe("Task Status")
        expect(result.metadata.sessionId).toBe("test-session-123")
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

  test("action='abort' with workflowId delegates to OrchestrateTool abort", async () => {
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

        expect(result.output).toContain("Aborted/Removed 0 tasks/sessions")
      },
    })
  })

  test("action='abort' with session_id delegates to TaskTool abort", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "abort",
            session_id: "test-session-456",
          },
          dummyCtx,
        )

        expect(result.title).toBe("Abort Successful")
        expect(result.output).toContain("test-session-456")
      },
    })
  })
})
