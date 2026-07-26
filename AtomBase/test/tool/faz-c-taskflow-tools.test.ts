import { describe, expect, test } from "bun:test"
import { SubAgent } from "@/integrations/tool/subagent"
import { ChainUpdateTool } from "@/integrations/tool/chainupdate"
import { TodoWriteTool, TodoReadTool } from "@/integrations/tool/todo"
import { TaskTool } from "@/integrations/tool/task"
import { PermissionNext } from "@/util/permission/next"
import { Session } from "@/core/session"
import { Bus } from "@/core/bus"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const mockCtx = (sessionID = "test-session-123") => ({
  sessionID,
  messageID: "msg-123",
  callID: "call-123",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

describe("Faz C: SubAgent permission and spawn utilities", () => {
  test("buildPermissions merges parent permissions with BASE_DENIED_PERMISSIONS", () => {
    const parentPermissions: PermissionNext.Rule[] = [
      { permission: "bash", pattern: "*", action: "allow" },
    ]
    const merged = SubAgent.buildPermissions(parentPermissions)

    expect(merged).toContainEqual({ permission: "todowrite", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "todoread", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "bash", pattern: "*", action: "allow" })
  })

  test("buildFromAgent uses agent permission base and enforces deny rules", () => {
    const agentInfo = {
      name: "reviewer",
      permission: [
        { permission: "read", pattern: "*", action: "allow" as const },
      ],
    } as any

    const merged = SubAgent.buildFromAgent(agentInfo)

    expect(merged).toContainEqual({ permission: "todowrite", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "todoread", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
    expect(merged).toContainEqual({ permission: "read", pattern: "*", action: "allow" })
  })
})

describe("Faz C: ChainUpdateTool actions and validation", () => {
  test("action='start' initializes chain and emits Bus events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = mockCtx("chain-session-1")
        let eventsEmitted: string[] = []
        const unsub = Bus.subscribeAll((evt: any) => {
          eventsEmitted.push(evt.type)
        })

        try {
          const chainTool = await ChainUpdateTool.init()
          const res = await chainTool.execute(
            {
              action: "start",
              steps: [
                { name: "Analyze requirements" },
                { name: "Write code", todos: ["Write test", "Implement"] },
              ],
            },
            ctx,
          )

          expect(res.title).toContain("Chain started with 2 steps")
          expect(eventsEmitted).toContain("tui.chain.clear")
          expect(eventsEmitted).toContain("tui.chain.start")
          expect(eventsEmitted).toContain("tui.chain.add_step")
          expect(eventsEmitted).toContain("tui.chain.update_step")
        } finally {
          unsub()
        }
      },
    })
  })

  test("action='add_step', 'update', 'set_todos', 'todo_done'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = mockCtx("chain-session-2")
        const chainTool = await ChainUpdateTool.init()

        const addRes = await chainTool.execute(
          {
            action: "add_step",
            step_name: "New Step",
            step_description: "New Step Desc",
            step_todos: ["subtask 1"],
          },
          ctx,
        )
        expect(addRes.title).toBe("Added: New Step")

        const updateRes = await chainTool.execute(
          { action: "update", status: "coding", tool: "edit" },
          ctx,
        )
        expect(updateRes.title).toBe("coding (edit)")

        const todosRes = await chainTool.execute(
          { action: "set_todos", todos: ["item 1", "item 2"] },
          ctx,
        )
        expect(todosRes.title).toBe("2 todos set")

        const doneRes = await chainTool.execute(
          { action: "todo_done", todo_index: 0 },
          ctx,
        )
        expect(doneRes.title).toBe("Todo #1 ✓")
      },
    })
  })

  test("action='sub_plan', 'sub_plan_end', 'parallel_update', 'clear'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = mockCtx("chain-session-3")
        const chainTool = await ChainUpdateTool.init()

        const subPlanRes = await chainTool.execute(
          {
            action: "sub_plan",
            step_index: 1,
            reason: "Fix compile error",
            sub_steps: [{ name: "Install package", description: "bun add pkg" }],
          },
          ctx,
        )
        expect(subPlanRes.title).toBe("Sub-plan for step 2")

        const subPlanEndRes = await chainTool.execute(
          { action: "sub_plan_end", step_index: 1 },
          ctx,
        )
        expect(subPlanEndRes.title).toBe("Sub-plan completed ✓")

        const parallelRes = await chainTool.execute(
          { action: "parallel_update", step_index: 0, status: "analyzing" },
          ctx,
        )
        expect(parallelRes.title).toBe("Step 1: analyzing")

        const clearRes = await chainTool.execute({ action: "clear" }, ctx)
        expect(clearRes.title).toBe("Chain cleared")
      },
    })
  })

  test("formatValidationError provides actionable hints", async () => {
    const chainTool = await ChainUpdateTool.init()
    const fakeError = {
      issues: [
        { path: ["steps"], code: "invalid_type", message: "Expected array" },
      ],
    } as any

    const formatted = chainTool.formatValidationError!(fakeError)
    expect(formatted).toContain("Invalid 'steps' parameter")
    expect(formatted).toContain("Strings: [\"Step 1\", \"Step 2\"]")
  })
})

describe("Faz C: TodoWriteTool & TodoReadTool", () => {
  test("writes and reads todos for session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ctx = mockCtx(session.id)

        const todoWrite = await TodoWriteTool.init()
        const todoRead = await TodoReadTool.init()

        const testTodos = [
          { id: "todo-1", content: "Task 1", status: "in_progress", priority: "high" },
          { id: "todo-2", content: "Task 2", status: "completed", priority: "medium" },
        ]

        const writeRes = await todoWrite.execute({ todos: testTodos }, ctx)
        expect(writeRes.title).toBe("1 todos")

        const readRes = await todoRead.execute({}, ctx)
        expect(readRes.title).toBe("1 todos")
        const readData = JSON.parse(readRes.output)
        expect(readData).toHaveLength(2)
        expect(readData[0].content).toBe("Task 1")
      },
    })
  })
})

describe("Faz C: TaskTool parameter validation and abort action", () => {
  test("action='abort' requires session_id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = mockCtx()
        const taskToolInstance = await TaskTool.init()

        expect(
          taskToolInstance.execute({ action: "abort" }, ctx),
        ).rejects.toThrow("session_id is required to abort a task")
      },
    })
  })

  test("action='run' (default) requires description, prompt, and subagent_type", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ctx = mockCtx()
        const taskToolInstance = await TaskTool.init()

        expect(
          taskToolInstance.execute(
            { description: "Test", prompt: "Do something" },
            ctx,
          ),
        ).rejects.toThrow("description, prompt, and subagent_type are required")
      },
    })
  })

  test("action='run' with unknown subagent_type throws error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ctx = mockCtx(session.id)
        const taskToolInstance = await TaskTool.init()

        expect(
          taskToolInstance.execute(
            {
              description: "Test task",
              prompt: "Do work",
              subagent_type: "nonexistent-agent-12345",
            },
            ctx,
          ),
        ).rejects.toThrow("Unknown agent type: nonexistent-agent-12345")
      },
    })
  })
})
