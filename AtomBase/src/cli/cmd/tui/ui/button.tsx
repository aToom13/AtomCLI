import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { Focusable } from "../context/spatial"
import { Identifier } from "@/id/id"
import { TextAttributes, BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"

export type ButtonProps = {
    id?: string
    label: string
    onPress: () => void
    disabled?: boolean
    variant?: "primary" | "secondary" | "danger" | "ghost"
    paddingLeft?: number
    paddingRight?: number
}

export function Button(props: ButtonProps) {
    const { theme } = useTheme()
    const id = props.id || Identifier.ascending("part")

    return (
        <Focusable id={id} onPress={props.onPress} disabled={props.disabled}>
            {(focused: () => boolean) => {
                let bg
                let fg
                let bold = false

                if (props.disabled) {
                    bg = undefined
                    fg = theme.textMuted
                } else if (focused()) {
                    // Elevated hover/focus state
                    bg = theme.primary
                    fg = theme.selectedListItemText
                    bold = true
                } else {
                    switch (props.variant) {
                        case "primary":
                            bg = theme.primary
                            fg = theme.selectedListItemText
                            bold = true
                            break
                        case "danger":
                            bg = "#ff4444"
                            fg = theme.background
                            break
                        case "ghost":
                            bg = undefined
                            fg = theme.text
                            break
                        case "secondary":
                        default:
                            bg = theme.backgroundElement
                            fg = theme.text
                            break
                    }
                }

                return (
                    <box
                        paddingLeft={props.paddingLeft ?? 2}
                        paddingRight={props.paddingRight ?? 2}
                        paddingTop={1}
                        paddingBottom={1}
                        backgroundColor={bg}
                        onMouseUp={(e) => {
                            if (!props.disabled) {
                                props.onPress()
                            }
                        }}
                    >
                        <text
                            attributes={bold ? TextAttributes.BOLD : undefined}
                            fg={fg}
                        >
                            {props.label}
                        </text>
                    </box>
                )
            }}
        </Focusable>
    )
}
