import { Tool } from "./tool"
import { Todo } from "@/core/session/todo"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import { MessageV2 } from "@/core/session/message-v2"
import z from "zod"

export const TodoTool = Tool.define("todo", {
  effects: { workspace: "none", external: "none", reversible: true, destructive: false, privileged: false },
  description:
    "Manage a visible checklist of tasks for the user. Use this tool to create, update, check off, and remove todo items. This tool does not affect execution lifecycle, acceptance, review, checkpoint, or completion authority.",
  parameters: z.object({
    action: z.enum([
      "add",      // add a new todo item
      "list",     // list all todo items
      "check",    // check off a todo item by id
      "uncheck",  // uncheck a todo item by id
      "remove",   // remove a todo item by id
      "update",   // update content/priority/status of a todo item by id
    ]),
    id: z.string().optional().describe("The todo item ID (required for check, uncheck, remove, update)"),
    content: z.string().optional().describe("The todo item content (for add/update)"),
    status: z.string().optional().describe("The status: pending, in_progress, completed, cancelled (for update)"),
    priority: z.string().optional().describe("The priority: high, medium, low (for update)"),
  }),
  async execute(params, ctx) {
    const log = Log.create({ service: "tool.todo", sessionID: ctx.sessionID })
    const sessionID = ctx.sessionID
    switch (params.action) {
      case "add": {
        if (!params.content) {
          throw new Error("content is required for action='add'")
        }
        const newTodo: Todo.Info = {
          id: Identifier.ascending("tool"),
          content: params.content.trim(),
          status: "pending",
          priority: params.priority ?? "medium",
        }
        const current = await Todo.get(sessionID)
        const updated = [...current, newTodo]
        await Todo.update({ sessionID, todos: updated })
        return {
          title: "Todo added",
          output: JSON.stringify(newTodo, null, 2),
          metadata: { id: newTodo.id },
          attachments: [] as MessageV2.FilePart[],
        }
      }
      case "list": {
        const todos = await Todo.get(sessionID)
        return {
          title: "Todo list",
          output: todos.length === 0 ? "(no todos)" : JSON.stringify(todos, null, 2),
          metadata: { id: "todo-list" },
          attachments: [] as MessageV2.FilePart[],
        }
      }
      case "check": {
        if (!params.id) {
          throw new Error("id is required for action='check'")
        }
        const current = await Todo.get(sessionID)
        const updated = current.map(t => t.id === params.id ? { ...t, status: "completed" } : t)
        await Todo.update({ sessionID, todos: updated })
        return {
          title: "Todo checked",
          output: `Todo ${params.id} marked as completed`,
          metadata: { id: params.id },
          attachments: [] as MessageV2.FilePart[],
        }
      }
      case "uncheck": {
        if (!params.id) {
          throw new Error("id is required for action='uncheck'")
        }
        const current = await Todo.get(sessionID)
        const updated = current.map(t => t.id === params.id ? { ...t, status: "pending" } : t)
        await Todo.update({ sessionID, todos: updated })
        return {
          title: "Todo unchecked",
          output: `Todo ${params.id} marked as pending`,
          metadata: { id: params.id },
          attachments: [] as MessageV2.FilePart[],
        }
      }
      case "remove": {
        if (!params.id) {
          throw new Error("id is required for action='remove'")
        }
        const current = await Todo.get(sessionID)
        const updated = current.filter(t => t.id !== params.id)
        await Todo.update({ sessionID, todos: updated })
        return {
          title: "Todo removed",
          output: `Todo ${params.id} removed`,
          metadata: { id: params.id },
          attachments: [] as MessageV2.FilePart[],
        }
      }
      case "update": {
        if (!params.id) {
          throw new Error("id is required for action='update'")
        }
        if (!params.content && !params.status && !params.priority) {
          throw new Error("at least one of content, status, priority must be provided for update")
        }
        const current = await Todo.get(sessionID)
        const updated = current.map(t => {
          if (t.id !== params.id) return t
          return {
            ...t,
            content: params.content ?? t.content,
            status: params.status ?? t.status,
            priority: params.priority ?? t.priority,
          }
        })
        await Todo.update({ sessionID, todos: updated })
        return {
          title: "Todo updated",
          output: `Todo ${params.id} updated`,
          metadata: { id: params.id },
          attachments: [] as MessageV2.FilePart[],
        }
      }
    }
  },
})
