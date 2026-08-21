import { describe, expect, test } from "bun:test"
import { SlashCommand } from "@tui/component/prompt/slash-command"

const active = { session: true, sharing: true }
const home = { session: false, sharing: true }

describe("TUI slash commands", () => {
  test("shows only six intent-based command families", () => {
    const commands = SlashCommand.list(active)
    expect(commands.map((command) => command.name)).toEqual([
      "session",
      "model",
      "agent",
      "settings",
      "workflow",
      "help",
    ])
    const names = commands.flatMap((command) => [command.name, ...(command.aliases ?? [])])
    expect(new Set(names).size).toBe(names.length)
  })

  test("expands every command-tree level into contextual subcommands", () => {
    const root = SlashCommand.suggestions("", active)
    expect(root).toHaveLength(6)
    expect(root.find((item) => item.value === "session")?.expand).toBe(true)

    const session = SlashCommand.suggestions("session ", active).map((item) => item.value)
    expect(session).toContain("session history")
    expect(session).toContain("session compact")

    const history = SlashCommand.suggestions("session history ", active).map((item) => item.value)
    expect(history).toEqual([
      "session history undo",
      "session history redo",
      "session history timeline",
      "session history fork",
    ])

    const thinking = SlashCommand.suggestions("model think ", active).map((item) => item.value)
    expect(thinking).toEqual([
      "model think none",
      "model think minimal",
      "model think low",
      "model think medium",
      "model think high",
      "model think max",
      "model think xhigh",
      "model think default",
      "model think off",
    ])

    const homeSession = SlashCommand.suggestions("session ", home).map((item) => item.value)
    expect(homeSession).toContain("session new")
    expect(homeSession).not.toContain("session history")
    expect(homeSession).not.toContain("session transcript")
  })

  test("shows only thinking levels supported by the active model", () => {
    const openAICompatible = { ...active, thinkingLevels: ["low", "medium", "high"] }
    expect(SlashCommand.suggestions("model think ", openAICompatible).map((item) => item.value)).toEqual([
      "model think low",
      "model think medium",
      "model think high",
      "model think off",
    ])
    expect(SlashCommand.parse("/model think xhigh", openAICompatible)).toBeUndefined()
    expect(SlashCommand.parse("/model think high", openAICompatible)?.arguments).toBe("high")
  })

  test("keeps reset available when the active model has no configurable thinking level", () => {
    const fixedReasoning = { ...active, thinkingLevels: [] }
    expect(SlashCommand.suggestions("model think ", fixedReasoning).map((item) => item.value)).toEqual([
      "model think off",
    ])
  })

  test("parses grouped actions and useful defaults", () => {
    expect(SlashCommand.parse("/session", active)?.command.action).toBe("session.list")
    expect(SlashCommand.parse("/session compact", active)?.command.action).toBe("session.compact")
    expect(SlashCommand.parse("/session history undo", active)?.command.action).toBe("session.undo")
    expect(SlashCommand.parse("/session transcript export", active)?.command.action).toBe("session.export")
    expect(SlashCommand.parse("/session sharing share", active)?.command.action).toBe("session.share")
    expect(SlashCommand.parse("/model", active)?.command.action).toBe("model.list")
    expect(SlashCommand.parse("/model visibility", active)?.command.action).toBe("session.toggle.thinking")
    expect(SlashCommand.parse("/agent skills", active)?.command.action).toBe("skill.list")
    expect(SlashCommand.parse("/settings mcp", active)?.command.action).toBe("mcp.list")
    expect(SlashCommand.parse("/settings approvals autonomous", active)?.command.action).toBe("mode.autonomous")
    expect(SlashCommand.parse("/workflow", active)?.command.action).toBe("group.help")
  })

  test("passes free-form and selected preset arguments", () => {
    const thinking = SlashCommand.parse("/model think high", active)
    expect(thinking?.command.action).toBe("think.set")
    expect(thinking?.arguments).toBe("high")

    const smart = SlashCommand.parse("/model smart off", active)
    expect(smart?.command.action).toBe("smart-model.toggle")
    expect(smart?.arguments).toBe("off")

    const refactor = SlashCommand.parse("/workflow refactor simplify provider loading", active)
    expect(refactor?.command.action).toBe("workflow.prompt")
    expect(refactor?.arguments).toBe("simplify provider loading")
    expect(SlashCommand.renderWorkflow(refactor!.command, refactor!.arguments)).toContain("simplify provider loading")
  })

  test("keeps old flat commands parse-only for compatibility", () => {
    expect(SlashCommand.parse("/compact", active)?.command.action).toBe("session.compact")
    expect(SlashCommand.parse("/session undo", active)?.command.action).toBe("session.undo")
    expect(SlashCommand.parse("/settings autonomous", active)?.command.action).toBe("mode.autonomous")
    expect(SlashCommand.parse("/review", active)?.command.action).toBe("workflow.prompt")
    expect(SlashCommand.parse("/smart_model", active)?.command.action).toBe("smart-model.toggle")
    expect(SlashCommand.parse("/tests src/server", active)?.arguments).toBe("src/server")

    const visible = SlashCommand.list(active).flatMap((command) => [command.name, ...(command.aliases ?? [])])
    expect(visible).not.toContain("compact")
    expect(visible).not.toContain("review")
    expect(visible).not.toContain("smart-model")
  })

  test("does not expose invalid or redundant commands", () => {
    expect(SlashCommand.parse("/session undo", home)).toBeUndefined()
    expect(SlashCommand.parse("/workflow nonsense", active)).toBeUndefined()
    expect(SlashCommand.parse("/model think high unexpected", active)).toBeUndefined()
    expect(SlashCommand.parse("/session compact unexpected", active)).toBeUndefined()
    expect(SlashCommand.parse("/commands", active)).toBeUndefined()
    expect(SlashCommand.parse("/exit", active)).toBeUndefined()
    expect(SlashCommand.parse("/yolo", active)).toBeUndefined()
  })

  test("keeps autocomplete open at every expandable level", () => {
    expect(SlashCommand.canComplete("session ", active)).toBe(true)
    expect(SlashCommand.canComplete("session history ", active)).toBe(true)
    expect(SlashCommand.canComplete("session history u", active)).toBe(true)
    expect(SlashCommand.canComplete("session history undo ", active)).toBe(false)
    expect(SlashCommand.canComplete("model think ", active)).toBe(true)
    expect(SlashCommand.canComplete("model think xh", active)).toBe(true)
    expect(SlashCommand.canComplete("model think xhigh ", active)).toBe(false)
    expect(SlashCommand.canComplete("workflow ref", active)).toBe(true)
    expect(SlashCommand.canComplete("workflow refactor ", active)).toBe(false)
    expect(SlashCommand.canComplete("unknown ", active)).toBe(false)
  })

  test("exposes every declared child recursively", () => {
    function verify(nodes: SlashCommand.Info[], prefix = "") {
      for (const node of nodes) {
        const path = [prefix, node.name].filter(Boolean).join(" ")
        if (!node.children?.length) continue
        const suggestions = SlashCommand.suggestions(path + " ", active)
        expect(suggestions.map((item) => item.value)).toEqual(node.children.map((child) => `${path} ${child.name}`))
        verify(node.children, path)
      }
    }

    verify(SlashCommand.list(active))
  })
})
