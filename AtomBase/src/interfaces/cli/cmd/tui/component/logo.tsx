import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { UI } from "@/interfaces/cli/ui"

export function Logo() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  return (
    <Show
      when={dimensions().width >= UI.Logo.width + 4}
      fallback={
        <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
          AtomCLI
        </text>
      }
    >
      <box>
        <For each={UI.Logo.left}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted} selectable={false}>
                {line}
              </text>
              <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
                {UI.Logo.right[index()]}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
