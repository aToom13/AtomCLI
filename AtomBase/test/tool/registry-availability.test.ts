import "../preload"
import { describe, expect, test } from "bun:test"
import { ToolRegistry } from "@/integrations/tool/registry"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionPrompt } from "@/core/session/prompt"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { requestedToolIDs } from "@/core/session/prompt/tools"

describe("tool availability", () => {
  test("scope and agent capability intersect without exposing internal delegation tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cases = [
          {
            scope: "direct",
            intent: "answer",
            agent: "build",
            present: ["scope_control"],
            absent: ["read", "edit", "agent", "taskflow"],
          },
          {
            scope: "direct",
            intent: "inspect",
            agent: "build",
            present: ["read", "grep"],
            absent: ["edit", "bash", "agent"],
          },
          {
            scope: "focused",
            intent: "change",
            agent: "build",
            present: ["edit", "bash"],
            absent: ["agent", "taskflow"],
          },
          {
            scope: "focused",
            intent: "inspect",
            agent: "build",
            present: ["read", "bash", "lsp"],
            absent: ["edit", "write", "agent"],
          },
          {
            // Coordinated is the only normal surface that advertises the
            // coordination tools: the visible checklist (todo) plus delegation
            // (agent). Internal taskflow/orchestrate/normal-task stay hidden.
            scope: "coordinated",
            intent: "change",
            agent: "build",
            present: ["agent", "todo", "edit", "bash"],
            absent: ["task", "orchestrate", "taskflow"],
          },
          {
            scope: "coordinated",
            intent: "inspect",
            agent: "explore",
            present: ["read", "bash"],
            absent: ["edit", "write", "agent"],
          },
          {
            scope: "coordinated",
            intent: "inspect",
            agent: "checker",
            present: ["read", "lsp"],
            absent: ["edit", "write", "agent"],
          },
          {
            scope: "coordinated",
            intent: "inspect",
            agent: "reviewer",
            present: ["read", "grep"],
            absent: ["edit", "write", "agent"],
          },
          {
            scope: "coordinated",
            intent: "change",
            agent: "documenter",
            present: ["read", "edit", "write"],
            absent: ["agent"],
          },
        ] as const
        for (const item of cases) {
          const allowed = ExecutionPolicy.selectAllowedTools(item.scope, item.intent)
          const requested = requestedToolIDs(allowed, true)
          const ids = (await ToolRegistry.tools("test", { name: item.agent } as never, requested)).map(
            (tool) => tool.id,
          )
          for (const id of item.present) expect(ids).toContain(id)
          if (item.scope !== "direct") expect(ids).toContain("static_check")
          for (const id of item.absent) expect(ids).not.toContain(id)
        }
      },
    })
  })

  test("a direct answer advertises only execution controls", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // direct + answer is the only contract that yields an empty allowlist.
        const allowedTools = ExecutionPolicy.selectAllowedTools("direct", "answer")
        expect(allowedTools).toEqual([])

        const requested = requestedToolIDs(allowedTools, true)
        expect([...requested!]).toEqual(["model_control", "scope_control", "skill", "invalid"])

        const tools = await ToolRegistry.tools("test", undefined, requested)
        const ids = tools.map((t) => t.id)
        expect(ids).toEqual(["invalid", "model_control", "scope_control", "skill"])
      },
    })
  })

  test("a real policy allowlist narrows the toolset as intended", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const allowedTools = ExecutionPolicy.selectAllowedTools("direct", "inspect")
        const requested = requestedToolIDs(allowedTools, true)
        const ids = (await ToolRegistry.tools("test", undefined, requested)).map((t) => t.id)
        expect(ids).toContain("read")
        expect(ids).toContain("model_control")
        expect(ids).toContain("scope_control")
        expect(ids).not.toContain("write")
        expect(ids).not.toContain("bash")
      },
    })
  })

  test("the casual-turn path keeps only execution control tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // shouldLoadTools rejects a bare greeting, which is what keeps a chat
        // turn cheap now that an empty allowlist no longer means "no tools".
        expect(
          SessionPrompt._internals.shouldLoadTools({
            providerID: "test",
            prompt: "merhaba",
            explicitTools: false,
            bypassAgentCheck: false,
            hasPriorToolActivity: false,
          }),
        ).toBe(false)

        const requested = requestedToolIDs(undefined, false)
        expect([...requested]).toEqual(["model_control", "scope_control", "skill", "invalid"])
      },
    })
  })

  test("a continuation without restrictive policy resolves the full toolset", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompt = "Devam et lütfen"
        expect(SessionPrompt._internals.isDirectAnswer(prompt, "agent")).toBe(false)
        const loadAll = SessionPrompt._internals.shouldLoadTools({
          providerID: "test",
          prompt,
          explicitTools: false,
          bypassAgentCheck: false,
          hasPriorToolActivity: false,
        })
        expect(loadAll).toBe(true)
        const ids = (await ToolRegistry.tools("test", undefined, requestedToolIDs(undefined, loadAll))).map((t) => t.id)
        expect(ids).toContain("read")
        expect(ids).toContain("bash")
      },
    })
  })

  test("an empty resolved toolset is reported rather than silently dropped", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // A genuinely empty intersection is still possible (agent allowlist ∩
        // request). It must not throw and must not be silently swallowed.
        const explore = await ToolRegistry.tools("test", { name: "explore" } as never, new Set(["nope"]))
        expect(explore).toEqual([])
      },
    })
  })

  test("hidden invalid-tool repair survives agent allowlists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = await ToolRegistry.tools("test", { name: "explore" } as never, new Set(["invalid"]))
        expect(tools.map((tool) => tool.id)).toEqual(["invalid"])
      },
    })
  })
})
