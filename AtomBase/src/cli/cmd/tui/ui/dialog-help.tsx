import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { createSignal, For } from "solid-js"

const HELP_SECTIONS = [
  {
    title: "🚀 Quick Start",
    items: [
      { key: "Tab", desc: "Switch agent (build/plan/explore)" },
      { key: "Ctrl+A", desc: "Connect provider or select model" },
      { key: "Ctrl+P", desc: "Open command palette" },
      { key: "Escape", desc: "Cancel or close dialog" },
    ],
  },
  {
    title: "💬 Session",
    items: [
      { key: "/new", desc: "Create new session" },
      { key: "/fork", desc: "Fork from a message" },
      { key: "/compact", desc: "Compress session context" },
      { key: "/share", desc: "Share session link" },
      { key: "Ctrl+Z", desc: "Undo last message" },
    ],
  },
  {
    title: "🔧 Tools & Skills",
    items: [
      { key: "/skill", desc: "List available skills" },
      { key: "/mcp", desc: "Toggle MCP servers" },
      { key: "/smart_model", desc: "Toggle smart model routing" },
      { key: "@skillname", desc: "Load a skill inline" },
      { key: "atomcli features", desc: "View all hidden features" },
    ],
  },
  {
    title: "🤖 Agents",
    items: [
      { key: "build", desc: "Default coding agent" },
      { key: "plan", desc: "Planning mode (read-only)" },
      { key: "explore", desc: "Codebase exploration" },
      { key: "agent", desc: "Autonomous mode (yolo)" },
    ],
  },
  {
    title: "📁 Files",
    items: [
      { key: "/review", desc: "Review uncommitted changes" },
      { key: "/export", desc: "Export session to file" },
      { key: "/copy", desc: "Copy transcript to clipboard" },
      { key: "Ctrl+R", desc: "Quick review" },
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
              <text fg={theme.primary} minWidth={20}>{item.key}</text>
              <text fg={theme.textMuted}>{item.desc}</text>
            </box>
          )}
        </For>
      </box>

      <box flexDirection="row" gap={1} paddingTop={1}>
        <For each={HELP_SECTIONS}>
          {(_, i) => (
            <text fg={i() === section() ? theme.primary : theme.textMuted}>
              {i() === section() ? "●" : "○"}
            </text>
          )}
        </For>
      </box>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>
          Tip: Run 'atomcli features' in terminal for detailed feature documentation.
        </text>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}

