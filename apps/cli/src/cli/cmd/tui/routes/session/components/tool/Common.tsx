import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useRenderer, type JSX } from "@opentui/solid"
import { BoxRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useSessionContext } from "../../context" // We will need to export context from a separate file or modify imports
import type { ToolPart } from "@atomcli/sdk/v2"
import { SplitBorder } from "@tui/component/border"

export function InlineTool(props: {
    icon: string
    iconColor?: RGBA
    complete: any
    pending: string
    children: JSX.Element
    part: ToolPart
}) {
    const [margin, setMargin] = createSignal(0)
    const { theme } = useTheme()
    const ctx = useSessionContext()
    const sync = useSync()

    const permission = createMemo(() => {
        const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
        if (!callID) return false
        return callID === props.part.callID
    })

    const fg = createMemo(() => {
        if (permission()) return theme.warning
        if (props.complete) return theme.textMuted
        return theme.text
    })

    const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

    const denied = createMemo(
        () =>
            error()?.includes("rejected permission") ||
            error()?.includes("specified a rule") ||
            error()?.includes("user dismissed"),
    )

    return (
        <box
            marginTop={margin()}
            paddingLeft={3}
            renderBefore={function () {
                const el = this as BoxRenderable
                const parent = el.parent
                if (!parent) {
                    return
                }
                if (el.height > 1) {
                    setMargin(1)
                    return
                }
                const children = parent.getChildren()
                const index = children.indexOf(el)
                const previous = children[index - 1]
                if (!previous) {
                    setMargin(0)
                    return
                }
                if (previous.height > 1 || previous.id.startsWith("text-")) {
                    setMargin(1)
                    return
                }
            }}
        >
            <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
                <Show fallback={<>~ {props.pending}</>} when={props.complete}>
                    <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
                </Show>
            </text>
            <Show when={error() && !denied()}>
                <text fg={theme.error}>{error()}</text>
            </Show>
        </box>
    )
}

export function BlockTool(props: { title: string; children: JSX.Element; onClick?: () => void; part?: ToolPart }) {
    const { theme } = useTheme()
    const renderer = useRenderer()
    const [hover, setHover] = createSignal(false)
    const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
    return (
        <box
            border={["left"]}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            marginTop={1}
            gap={1}
            backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
            customBorderChars={SplitBorder.customBorderChars}
            borderColor={theme.background}
            onMouseOver={() => props.onClick && setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                props.onClick?.()
            }}
        >
            <text paddingLeft={3} fg={theme.textMuted}>
                {props.title}
            </text>
            {props.children}
            <Show when={error()}>
                <text fg={theme.error}>{error()}</text>
            </Show>
        </box>
    )
}
