import { createMemo, Match, Show, Switch } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import type { TaskTool } from "@/tool/task"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"

export function Task(props: ToolProps<typeof TaskTool>) {
    const { theme } = useTheme()
    const keybind = useKeybind()
    const { navigate } = useRoute()
    const local = useLocal()

    const current = createMemo(() => props.metadata.summary?.findLast((x) => x.state.status !== "pending"))
    const color = createMemo(() => local.agent.color(props.input.subagent_type ?? "unknown"))

    return (
        <Switch>
            <Match when={props.metadata.summary?.length}>
                <BlockTool
                    title={"# " + Locale.titlecase(props.input.subagent_type ?? "unknown") + " Task"}
                    onClick={
                        props.metadata.sessionId
                            ? () => navigate({ type: "session", sessionID: props.metadata.sessionId! })
                            : undefined
                    }
                    part={props.part}
                >
                    <box>
                        <text style={{ fg: theme.textMuted }}>
                            {props.input.description} ({props.metadata.summary?.length} toolcalls)
                        </text>
                        <Show when={current()}>
                            <text style={{ fg: current()!.state.status === "error" ? theme.error : theme.textMuted }}>
                                └ {Locale.titlecase(current()!.tool)}{" "}
                                {current()!.state.status === "completed" ? current()!.state.title : ""}
                            </text>
                        </Show>
                    </box>
                    <text fg={theme.text}>
                        {keybind.print("session_child_cycle")}
                        <span style={{ fg: theme.textMuted }}> view subagents</span>
                    </text>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool
                    icon="◉"
                    iconColor={color()}
                    pending="Delegating..."
                    complete={props.input.subagent_type ?? props.input.description}
                    part={props.part}
                >
                    <span style={{ fg: theme.text }}>{Locale.titlecase(props.input.subagent_type ?? "unknown")}</span> Task "
                    {props.input.description}"
                </InlineTool>
            </Match>
        </Switch>
    )
}
