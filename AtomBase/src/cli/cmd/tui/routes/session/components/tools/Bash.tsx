import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import stripAnsi from "strip-ansi"
import { BashTool } from "@/tool/bash"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"

export function Bash(props: ToolProps<typeof BashTool>) {
    const { theme } = useTheme()
    const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
    const [expanded, setExpanded] = createSignal(false)
    const lines = createMemo(() => output().split("\n"))
    const overflow = createMemo(() => lines().length > 10)
    const limited = createMemo(() => {
        if (expanded() || !overflow()) return output()
        return [...lines().slice(0, 10), "…"].join("\n")
    })

    return (
        <Switch>
            <Match when={props.metadata.output !== undefined}>
                <BlockTool
                    title={"# " + (props.input.description ?? "Shell")}
                    part={props.part}
                    onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
                >
                    <box gap={1}>
                        <text fg={theme.text}>$ {props.input.command}</text>
                        <text fg={theme.text}>{limited()}</text>
                        <Show when={overflow()}>
                            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
                        </Show>
                    </box>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
                    {props.input.command}
                </InlineTool>
            </Match>
        </Switch>
    )
}
