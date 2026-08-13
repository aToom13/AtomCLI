import { describe, expect, test } from "bun:test"
import { SlashCommand } from "@tui/component/prompt/slash-command"

describe("TUI slash commands", () => {
  test("has unique names and aliases", () => {
    const commands = SlashCommand.list({ session: true, sharing: true })
    const names = commands.flatMap((command) => [command.name, ...(command.aliases ?? [])])
    expect(new Set(names).size).toBe(names.length)
  })

  test("does not expose session-only actions on the home screen", () => {
    expect(SlashCommand.parse("/undo", { session: false, sharing: true })).toBeUndefined()
    expect(SlashCommand.parse("/models", { session: false, sharing: true })?.command.action).toBe("model.list")
    expect(SlashCommand.parse("/model", { session: false, sharing: true })?.command.action).toBe("model.list")
  })

  test("uses explicit safe and autonomous actions", () => {
    expect(SlashCommand.parse("/autonomous", { session: false, sharing: true })?.command.action).toBe("mode.autonomous")
    expect(SlashCommand.parse("/safe", { session: false, sharing: true })?.command.action).toBe("mode.safe")
    expect(SlashCommand.parse("/yolo", { session: false, sharing: true })).toBeUndefined()
  })

  test("parses arguments and compatibility aliases", () => {
    const thinking = SlashCommand.parse("/think high", { session: true, sharing: true })
    expect(thinking?.command.action).toBe("think.set")
    expect(thinking?.arguments).toBe("high")
    expect(SlashCommand.parse("/smart_model", { session: true, sharing: true })?.command.action).toBe(
      "smart-model.toggle",
    )
  })
})
