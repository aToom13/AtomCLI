import "../preload"
import { describe, test, expect } from "bun:test"
import { TaskFlowTool } from "@/integrations/tool/taskflow"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { HarnessState } from "@/core/session/harness-state"
import { Config } from "@/core/config/config"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { ExecutionRuntime } from "@/core/execution/runtime"

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

  test("action='update' keeps completed state synchronized with HarnessState", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_taskflow_sync_${crypto.randomUUID()}`
        const ctx = { ...dummyCtx, sessionID }
        const instance = await TaskFlowTool.init({})

        await instance.execute(
          {
            action: "start",
            plan: [
              { id: "spawn-test", name: "Agent spawn test" },
              { id: "status-test", name: "Agent status test" },
            ],
          },
          ctx,
        )
        await instance.execute({ action: "update", step_id: "spawn-test", status: "running" }, ctx)
        const completed = await instance.execute({ action: "update", step_id: "spawn-test", status: "completed" }, ctx)
        const next = await instance.execute({ action: "update", step_id: "status-test", status: "running" }, ctx)

        expect(completed.metadata.status).toBe("completed")
        expect(HarnessState.getSteps(sessionID).map((step) => step.status)).toEqual(["completed", "running"])
        expect(next.metadata.status).toBe("running")
        HarnessState.reset(sessionID)
      },
    })
  })

  test("backs plan items with durable blockers and clear cannot erase unresolved work", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: messageID,
        })
        const permissions: string[] = []
        const ctx = {
          ...dummyCtx,
          sessionID: session.id,
          messageID,
          extra: { execution },
          ask: async (request: { permission: string }) => {
            permissions.push(request.permission)
          },
        }
        const instance = await TaskFlowTool.init({})

        const started = await instance.execute(
          {
            action: "start",
            plan: [
              { id: "implement", name: "Implement change" },
              { id: "verify", name: "Verify change" },
            ],
          },
          ctx,
        )
        expect(started.metadata.status).toBeUndefined()
        const binding = HarnessState.getPlanBinding(session.id)!
        expect(binding.revision).toBe(1)
        expect(ExecutionRuntime.blocker(binding.items.implement.blockerID)).toMatchObject({
          state: "pending",
          planRevision: 1,
        })

        const blocked = await instance.execute({ action: "clear" }, ctx)
        expect(blocked.metadata.status).toBe("blocked")
        expect(HarnessState.getSteps(session.id)).toHaveLength(2)

        await instance.execute({ action: "update", step_id: "implement", status: "running" }, ctx)
        await instance.execute({ action: "complete", step_id: "implement" }, ctx)
        expect(ExecutionRuntime.blocker(binding.items.implement.blockerID)?.state).toBe("resolved")

        await instance.execute({ action: "update", step_id: "verify", status: "running" }, ctx)
        await instance.execute({ action: "fail", step_id: "verify", output: "fixture failure" }, ctx)
        expect(ExecutionRuntime.blocker(binding.items.verify.blockerID)?.state).toBe("failed")

        const missingReason = await instance.execute({ action: "clear", force: true }, ctx)
        expect(missingReason.output).toContain("waive_reason is required")
        const cleared = await instance.execute(
          { action: "clear", force: true, waive_reason: "User accepts the failed verification fixture" },
          ctx,
        )
        expect(cleared.metadata.status).toBe("cleared")
        expect(ExecutionRuntime.blocker(binding.items.verify.blockerID)).toMatchObject({
          state: "waived",
          planRevision: 1,
        })
        expect(permissions).toContain("taskflow.force")
        expect(HarnessState.getSteps(session.id)).toHaveLength(0)
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })
})
