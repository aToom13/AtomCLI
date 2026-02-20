import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"
import { Focusable } from "../context/spatial"
import { Identifier } from "@/id/id"
import { useTheme } from "../context/theme"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href
  const id = Identifier.ascending("part")
  const { theme } = useTheme()

  return (
    <Focusable id={id} onPress={() => open(props.href).catch(() => { })}>
      {(focused: () => boolean) => (
        <box
          backgroundColor={focused() ? theme.primary : undefined}
          onMouseUp={() => {
            open(props.href).catch(() => { })
          }}
        >
          <text fg={focused() ? theme.selectedListItemText : props.fg}>
            {displayText}
          </text>
        </box>
      )}
    </Focusable>
  )
}
