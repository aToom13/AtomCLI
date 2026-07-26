import { describe, test, expect } from "bun:test"
import { TaskFlowTool } from "@/integrations/tool/taskflow"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("TaskFlowTool", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test("defines parameters schema and description", async () => {
    const instance = await TaskFlowTool.init({})
    expect(instance.description).toContain("Unified progress tracking tool")
    expect(instance.parameters).toBeDefined()
  })

  test("action='start' initializes plan with steps and todos", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await TaskFlowTool.init({})
        const result = await instance.execute(
          {
            action: "start",
            plan: [
              { name: "Step 1: Setup", todos: ["Task A", "Task B"] },
              { name: "Step 2: Build", todos: [{ content: "Task C", status: "pending" }] },
            ],
          },
          dummyCtx,
        )

        expect(result.title).toContain("Taskflow started with 2 steps")
        expect(result.metadata.steps).toBe(2)
      },
    })
  })

  test("action='update' updates step and todo status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await TaskFlowTool.init({})
        const result = await instance.execute(
          {
            action: "update",
            step_id: "0",
            status: "running",
            todo_id: "0",
            todo_status: "completed",
          },
          dummyCtx,
        )

        expect(result.title).toBe("Taskflow updated")
        expect(result.metadata.status).toBe("running")
      },
    })
  })

  test("action='complete', 'fail', and 'clear' execute cleanly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await TaskFlowTool.init({})

        const compResult = await instance.execute({ action: "complete", output: "All steps done" }, dummyCtx)
        expect(compResult.title).toContain("completed")

        const failResult = await instance.execute({ action: "fail", output: "Build error" }, dummyCtx)
        expect(failResult.title).toContain("failed")

        const clearResult = await instance.execute({ action: "clear" }, dummyCtx)
        expect(clearResult.title).toContain("cleared")
      },
    })
  })
})
