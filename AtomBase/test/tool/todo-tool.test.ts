import "../preload"
import { describe, expect, test } from "bun:test"
import { TodoTool } from "@/integrations/tool/todo-tool"
import { Todo } from "@/core/session/todo"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"

describe("TodoTool", () => {
  const makeCtx = (sessionID: string) => ({
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  })

  test("creates, lists, checks, updates, and removes a user-visible checklist item", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ctx = makeCtx(session.id)
        const tool = await TodoTool.init({})

        await tool.execute({ action: "add", content: "Fix the parser" }, ctx)
        await tool.execute({ action: "add", content: "Add tests", priority: "high" }, ctx)

        const listed = await tool.execute({ action: "list" }, ctx)
        expect(listed.output).toContain("Fix the parser")
        expect(listed.output).toContain("Add tests")

        // Persisted to the user-visible Todo storage (survives independent of execution lifecycle).
        const stored = await Todo.get(session.id)
        expect(stored).toHaveLength(2)

        const first = stored.find((item) => item.content === "Fix the parser")!
        await tool.execute({ action: "check", id: first.id }, ctx)
        const afterCheck = await Todo.get(session.id)
        expect(afterCheck.find((item) => item.id === first.id)?.status).toBe("completed")

        await tool.execute({ action: "update", id: first.id, status: "in_progress" }, ctx)
        const afterUpdate = await Todo.get(session.id)
        expect(afterUpdate.find((item) => item.id === first.id)?.status).toBe("in_progress")

        await tool.execute({ action: "remove", id: first.id }, ctx)
        const afterRemove = await Todo.get(session.id)
        expect(afterRemove.find((item) => item.id === first.id)).toBeUndefined()
        expect(afterRemove).toHaveLength(1)
      },
    })
  })

  test("rejects actions missing required fields without mutating state", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ctx = makeCtx(session.id)
        const tool = await TodoTool.init({})
        await expect(tool.execute({ action: "add" }, ctx)).rejects.toThrow(/content is required/)
        await expect(tool.execute({ action: "check" }, ctx)).rejects.toThrow(/id is required/)
        expect(await Todo.get(session.id)).toHaveLength(0)
      },
    })
  })
})
