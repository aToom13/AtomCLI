import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { createSignal, For } from "solid-js"
import { Button } from "./button"

const HELP_SECTIONS = [
  {
    title: "🚀 Quick Start",
    items: [
      { key: "Tab", desc: "Switch primary agent" },
      { key: "Ctrl+A", desc: "Connect provider or select model" },
      { key: "Ctrl+P", desc: "Open command palette" },
      { key: "Escape", desc: "Cancel or close dialog" },
    ],
  },
  {
    title: "💬 Session",
    items: [
      { key: "/session", desc: "List or switch sessions" },
      { key: "/session new", desc: "Create new session" },
      { key: "/session compact", desc: "Compress session context" },
      { key: "/session sharing share", desc: "Share session link" },
      { key: "Ctrl+Z", desc: "Undo last message" },
    ],
  },
  {
    title: "🔧 Models & Settings",
    items: [
      { key: "/model", desc: "Choose a model" },
      { key: "/model think high", desc: "Set model thinking level" },
      { key: "/model smart on", desc: "Enable smart model routing" },
      { key: "/agent skills", desc: "List available skills" },
      { key: "/settings mcp", desc: "Configure MCP servers" },
      { key: "/settings approvals safe", desc: "Use safe tool approvals" },
      { key: "@skillname", desc: "Load a skill inline" },
    ],
  },
  {
    title: "🤖 Agents",
    items: [
      { key: "build", desc: "Default coding agent" },
      { key: "plan", desc: "Planning mode (read-only)" },
      { key: "explore", desc: "Codebase exploration" },
      { key: "agent", desc: "Autonomous task-chain mode" },
    ],
  },
  {
    title: "⚙ Workflows",
    items: [
      { key: "/workflow review", desc: "Review workspace changes" },
      { key: "/workflow security", desc: "Run a security audit" },
      { key: "/workflow refactor <goal>", desc: "Refactor toward a goal" },
      { key: "/workflow tests <scope>", desc: "Generate regression tests" },
      { key: "/help", desc: "View keyboard help and command families" },
    ],
  },
]

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const [section, setSection] = createSignal(0)

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
    if (evt.name === "left" || evt.name === "h") {
      setSection((s) => Math.max(0, s - 1))
    }
    if (evt.name === "right" || evt.name === "l") {
      setSection((s) => Math.min(HELP_SECTIONS.length - 1, s + 1))
    }
  })

  const current = () => HELP_SECTIONS[section()]

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help - {current().title}
        </text>
        <text fg={theme.textMuted}>←/→ navigate · esc close</text>
      </box>

      <box paddingTop={1}>
        <For each={current().items}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.primary} minWidth={20}>
                {item.key}
              </text>
              <text fg={theme.textMuted}>{item.desc}</text>
            </box>
          )}
        </For>
      </box>

      <box flexDirection="row" gap={1} paddingTop={1}>
        <For each={HELP_SECTIONS}>
          {(_, i) => (
            <text fg={i() === section() ? theme.primary : theme.textMuted}>{i() === section() ? "●" : "○"}</text>
          )}
        </For>
      </box>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>Type / in the prompt or run 'atomcli --help' in a shell to discover commands.</text>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <Button label={"ok"} variant="primary" onPress={() => dialog.clear()} />
      </box>
    </box>
  )
}
