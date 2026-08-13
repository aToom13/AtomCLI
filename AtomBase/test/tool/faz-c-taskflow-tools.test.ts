import { describe, expect, test } from "bun:test"
import { SubAgent } from "@/integrations/tool/subagent"
import { TaskTool } from "@/integrations/tool/task"
import { PermissionNext } from "@/util/permission/next"
import { Session } from "@/core/session"
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
