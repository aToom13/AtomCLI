import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { FindTool } from "@/integrations/tool/find"
import { InvalidTool } from "@/integrations/tool/invalid"
import { MemoryTool } from "@/integrations/tool/memory"
import { QuestionTool } from "@/integrations/tool/question"
import { SystemHealthTool } from "@/integrations/tool/system-health"
import { ToolRegistry } from "@/integrations/tool/registry"
import { Question } from "@/interfaces/question"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const context = (abort: AbortSignal = AbortSignal.any([])) => ({
  sessionID: "ses_tool_audit",
  messageID: "msg_tool_audit",
  callID: "call_tool_audit",
  agent: "build",
  abort,
  metadata: () => {},
  ask: async () => {},
})

describe("active tool audit", () => {
  test("registry exposes the current built-ins without removed legacy tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { plugin: [], experimental: { batch_tool: false } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(new Set(ids).size).toBe(ids.length)
        expect([...ids].sort()).toEqual(
          [
            "agent",
            "bash",
            "batch",
            "browser",
            "companion_preview",
            "companion_send",
            "edit",
            "find",
            "grep",
            "invalid",
            "lsp",
            "memory",
            "question",
            "read",
            "skill",
            "ssh",
            "system_health",
            "taskflow",
            "webfetch",
            "websearch",
            "write",
          ].sort(),
        )
        expect(ids).not.toContain("codesearch")
        expect(ids).not.toContain("finance_analyze")
      },
    })
  })

  test("invalid tool returns the supplied validation failure", async () => {
    const tool = await InvalidTool.init()
    const result = await tool.execute({ tool: "demo", error: "missing field" }, context())
    expect(result.title).toBe("Invalid Tool")
    expect(result.output).toContain("missing field")
  })

  test("find executes both pattern and tree modes", async () => {
    await using tmp = await tmpdir({
      init: async (directory) => {
        await fs.mkdir(path.join(directory, "src"), { recursive: true })
        await Bun.write(path.join(directory, "src", "main.ts"), "export const answer = 42\n")
        await Bun.write(path.join(directory, "README.md"), "audit\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await FindTool.init()
        // Omit mode to verify Tool.define forwards Zod's parsed/defaulted value.
        const pattern = await tool.execute({ pattern: "**/*.ts" }, context())
        expect(pattern.metadata.count).toBe(1)
        expect(pattern.output).toContain(path.join("src", "main.ts"))

        const tree = await tool.execute({ mode: "tree" }, context())
        expect(tree.metadata.count).toBe(2)
        expect(tree.output).toContain("src/")
        expect(tree.output).toContain("README.md")
      },
    })
  })

  test("question validates select options and completes a real reply cycle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await QuestionTool.init()
        await expect(
          tool.execute({ questions: [{ question: "Choose", header: "Choice", type: "select" }] }, context()),
        ).rejects.toThrow(/at least one option/)

        const execution = tool.execute(
          {
            questions: [
              {
                question: "Choose one",
                header: "Choice",
                type: "select",
                options: [{ label: "A", description: "First option" }],
              },
            ],
          },
          context(),
        )
        await Bun.sleep(0)
        const pending = await Question.list()
        expect(pending).toHaveLength(1)
        await Question.reply({ requestID: pending[0].id, answers: [["A"]] })
        const result = await execution
        expect(result.metadata.answers).toEqual([["A"]])
        expect(result.output).toContain('"Choose one"="A"')
      },
    })
  })

  test("memory validates action fields and supports save, search, and list", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MemoryTool.init()
        await expect(tool.execute({ action: "save" } as never, context())).rejects.toThrow(/content/)

        const marker = `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const saved = await tool.execute(
          { action: "save", content: `${marker} TypeScript fix`, tags: [marker] },
          context(),
        )
        expect(saved.title).toBe("Memory Saved")

        const searched = await tool.execute({ action: "search", query: marker, limit: 5 }, context())
        expect(searched.metadata.count).toBeGreaterThan(0)
        expect(searched.output).toContain(marker)

        const listed = await tool.execute({ action: "list", tag: marker, limit: 5 }, context())
        expect(listed.metadata.shown).toBe(1)
        expect(listed.output).toContain(marker)
      },
    })
  })

  test("system health propagates cancellation instead of disguising it", async () => {
    const controller = new AbortController()
    controller.abort(new Error("audit cancelled"))
    const tool = await SystemHealthTool.init()
    await expect(tool.execute({ action: "processes" }, context(controller.signal))).rejects.toThrow("audit cancelled")
  })
})
