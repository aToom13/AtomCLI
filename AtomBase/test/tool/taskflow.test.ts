import "../preload"
import { describe, test, expect } from "bun:test"
import { TaskFlow, TaskFlowTool } from "@/integrations/tool/taskflow"
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
    expect(
      instance.parameters.safeParse({
        action: "start",
        plan: Array.from({ length: 101 }, (_, index) => ({ name: `Step ${index}` })),
      }).success,
    ).toBe(false)
    expect(
      instance.parameters.safeParse({
        action: "start",
        plan: [{ name: "Step", todos: Array.from({ length: 101 }, (_, index) => `Todo ${index}`) }],
      }).success,
    ).toBe(false)
  })

  test("restores explicit independent review step types", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = { ...dummyCtx, sessionID: session.id, messageID, extra: { execution } }
        const tool = await TaskFlowTool.init({})
        await tool.execute(
          {
            action: "start",
            plan: [{ id: "audit", name: "Audit result", type: "independent_review" }],
          },
          ctx,
        )

        HarnessState.reset(session.id)
        await TaskFlow.restore(session.id, execution.executionID)

        expect(HarnessState.getSteps(session.id)[0]).toMatchObject({
          id: "audit",
          name: "Audit result",
          type: "independent_review",
        })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
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

  test("honors start status, serializes dependent calls and restores a durable plan after memory loss", async () => {
    await using tmp = await tmpdir({
      config: { review: { enabled: false, max_attempts: 1, reviewer_count: 1, policy: "off", high_risk_patterns: [] } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = { ...dummyCtx, sessionID: session.id, messageID, extra: { execution } }
        const tool = await TaskFlowTool.init({})
        await tool.execute(
          {
            action: "start",
            plan: [
              { id: "inspect", name: "Inspect source", status: "running" },
              { id: "verify", name: "Verify observations" },
            ],
          },
          ctx,
        )
        expect(HarnessState.getRunningStep(session.id)).toBe("inspect")
        const [completed, next] = await Promise.all([
          tool.execute({ action: "complete", step_id: "inspect", output: "Source read" }, ctx),
          tool.execute({ action: "update", step_id: "verify", status: "running" }, ctx),
        ])
        expect(completed.metadata.status).toBe("completed")
        expect(next.metadata.status).toBe("running")
        HarnessState.reset(session.id)
        await TaskFlow.restore(session.id, execution.executionID)
        expect(HarnessState.getSteps(session.id).map((step) => [step.id, step.status])).toEqual([
          ["inspect", "completed"],
          ["verify", "running"],
        ])
        expect(HarnessState.getPlanBinding(session.id)?.executionID).toBe(execution.executionID)
        await tool.execute({ action: "complete", step_id: "verify" }, ctx)
        await tool.execute({ action: "clear" }, ctx)
        HarnessState.reset(session.id)
        await TaskFlow.restore(session.id, execution.executionID)
        expect(HarnessState.getSteps(session.id)).toHaveLength(0)
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("activates the first pending durable step before work begins", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const ctx = { ...dummyCtx, sessionID: session.id, messageID, extra: { execution } }
        const tool = await TaskFlowTool.init({})
        await tool.execute(
          {
            action: "start",
            plan: [
              { id: "inspect", name: "Inspect source" },
              { id: "verify", name: "Verify result" },
            ],
          },
          ctx,
        )

        await TaskFlow.activateForWork(ctx)

        expect(HarnessState.getSteps(session.id).map((step) => step.status)).toEqual(["running", "pending"])
        const binding = HarnessState.getPlanBinding(session.id)!
        expect(ExecutionRuntime.blocker(binding.items.inspect.blockerID)?.state).toBe("running")
        expect(ExecutionRuntime.blocker(binding.items.verify.blockerID)?.state).toBe("pending")
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })

  test("rejects unsupported initial statuses instead of silently claiming completion", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await TaskFlowTool.init({})
        const result = await tool.execute(
          { action: "start", plan: [{ id: "report", name: "Unwritten report", status: "completed" }] },
          dummyCtx,
        )
        expect(result.metadata.status).toBe("error")
        expect(HarnessState.getSteps(dummyCtx.sessionID)).toHaveLength(0)
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
        await instance.execute(
          { action: "update", step_id: "implement", status: "reopened", output: "new regression evidence" },
          ctx,
        )
        expect(ExecutionRuntime.blocker(binding.items.implement.blockerID)?.state).toBe("reopened")
        await instance.execute({ action: "update", step_id: "implement", status: "running" }, ctx)
        await instance.execute({ action: "complete", step_id: "implement" }, ctx)

        await instance.execute(
          { action: "revise", plan: [{ id: "audit", name: "Audit newly discovered behavior" }] },
          ctx,
        )
        const revised = HarnessState.getPlanBinding(session.id)!
        expect(revised.revision).toBe(2)
        expect(revised.items.implement).toBeDefined()
        expect(revised.items.audit).toBeDefined()
        await instance.execute({ action: "update", step_id: "audit", status: "running" }, ctx)
        await instance.execute(
          { action: "update", step_id: "audit", status: "blocked", output: "waiting for fixture" },
          ctx,
        )
        expect(ExecutionRuntime.blocker(revised.items.audit.blockerID)?.state).toBe("blocked")
        await instance.execute({ action: "update", step_id: "audit", status: "running" }, ctx)
        await instance.execute({ action: "complete", step_id: "audit" }, ctx)

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

  test("continues and clears a taskflow after execution ownership changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const firstMessageID = Identifier.ascending("message")
        const firstExecution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: firstMessageID,
        })
        const instance = await TaskFlowTool.init({})
        const firstCtx = {
          ...dummyCtx,
          sessionID: session.id,
          messageID: firstMessageID,
          extra: { execution: firstExecution },
        }

        await instance.execute(
          {
            action: "start",
            plan: [{ id: "verify", name: "Verify the result" }],
          },
          firstCtx,
        )
        expect(HarnessState.getPlanBinding(session.id)?.executionID).toBe(firstExecution.executionID)

        ExecutionRuntime.finishInvocation(firstExecution, "completed")
        ExecutionRuntime.cancelExecution(firstExecution)
        const secondMessageID = Identifier.ascending("message")
        const secondExecution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: secondMessageID,
        })
        expect(secondExecution.executionID).not.toBe(firstExecution.executionID)
        const secondCtx = {
          ...dummyCtx,
          sessionID: session.id,
          messageID: secondMessageID,
          extra: { execution: secondExecution },
        }

        const running = await instance.execute({ action: "update", step_id: "verify", status: "running" }, secondCtx)
        expect(running.metadata.status).toBe("running")
        expect(HarnessState.getPlanBinding(session.id)?.executionID).toBe(secondExecution.executionID)
        expect(ExecutionRuntime.taskflowPlan(secondExecution.executionID, session.id)).toHaveLength(1)

        await instance.execute({ action: "complete", step_id: "verify" }, secondCtx)
        const cleared = await instance.execute({ action: "clear" }, secondCtx)
        expect(cleared.metadata.status).toBe("cleared")
        expect(HarnessState.hasActivePlan(session.id)).toBe(false)
        ExecutionRuntime.cancelExecution(secondExecution)
      },
    })
  })

  test("does not detach a taskflow while its execution is still running", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const instance = await TaskFlowTool.init({})
        const ctx = { ...dummyCtx, sessionID: session.id, messageID, extra: { execution } }

        await instance.execute({ action: "start", plan: [{ id: "work", name: "Keep working" }] }, ctx)
        const competingCtx = {
          ...ctx,
          extra: { execution: { ...execution, executionID: `${execution.executionID}:competing` } },
        }
        const blocked = await instance.execute({ action: "update", step_id: "work", status: "running" }, competingCtx)

        expect(blocked.metadata.status).toBe("error")
        expect(blocked.output).toContain("belongs to another execution")
        expect(HarnessState.getPlanBinding(session.id)?.executionID).toBe(execution.executionID)
        ExecutionRuntime.finishInvocation(execution, "completed")
        ExecutionRuntime.cancelExecution(execution)
        HarnessState.reset(session.id)
      },
    })
  })

  test("detaches taskflow bindings per session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parentID = `ses_parent_${crypto.randomUUID()}`
        const childID = `ses_child_${crypto.randomUUID()}`
        const binding = {
          executionID: "execution",
          revision: 1,
          items: { work: { blockerID: "blocker", version: 1, state: "pending" } },
        }
        HarnessState.startPlan(parentID, [{ id: "work", name: "Parent work" }], binding)
        HarnessState.startPlan(childID, [{ id: "work", name: "Child work" }], binding)

        HarnessState.detachPlanBinding(childID)

        expect(HarnessState.getPlanBinding(childID)).toBeUndefined()
        expect(HarnessState.getPlanBinding(parentID)).toEqual(binding)
        HarnessState.reset(parentID)
        HarnessState.reset(childID)
      },
    })
  })

  test("preserves a parent execution binding when checked from a subagent session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: messageID })
        const instance = await TaskFlowTool.init({})
        HarnessState.startPlan(child.id, [{ id: "work", name: "Child work" }], {
          executionID: execution.executionID,
          revision: 1,
          items: { work: { blockerID: "unused", version: 1, state: "pending" } },
        })
        const competingCtx = {
          ...dummyCtx,
          sessionID: child.id,
          messageID: Identifier.ascending("message"),
          extra: { execution: { ...execution, executionID: `${execution.executionID}:competing` } },
        }

        const blocked = await instance.execute({ action: "update", step_id: "work", status: "running" }, competingCtx)

        expect(blocked.metadata.status).toBe("error")
        expect(blocked.output).toContain("belongs to another execution")
        expect(HarnessState.getPlanBinding(child.id)?.executionID).toBe(execution.executionID)
        ExecutionRuntime.finishInvocation(execution, "completed")
        ExecutionRuntime.cancelExecution(execution)
        HarnessState.reset(child.id)
      },
    })
  })
})
