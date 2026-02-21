import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Locale } from "@/util/util/locale"
import type { AssistantMessage as AssistantMessageType, Part } from "@atomcli/sdk/v2"
import { ReasoningPart } from "./ReasoningPart"
import { TextPart } from "./TextPart"
import { ToolPart } from "./ToolPart"

const PART_MAPPING = {
    text: TextPart,
    tool: ToolPart,
    reasoning: ReasoningPart,
}

export function AssistantMessage(props: { message: AssistantMessageType; parts: Part[]; last: boolean }) {
    const local = useLocal()
    const { theme } = useTheme()
    const sync = useSync()
    const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

    const final = createMemo(() => {
        return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
    })

    const duration = createMemo(() => {
        if (!final()) return 0
        if (!props.message.time.completed) return 0
        const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
        if (!user || !user.time) return 0
        return props.message.time.completed - user.time.created
    })

    return (
        <>
            <For each={props.parts}>
                {(part, index) => {
                    const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
                    return (
                        <Show when={component()}>
                            <Dynamic
                                last={index() === props.parts.length - 1}
                                component={component()}
                                part={part as any}
                                message={props.message}
                            />
                        </Show>
                    )
                }}
            </For>
            <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
                <box
                    border={["left"]}
                    paddingTop={1}
                    paddingBottom={1}
                    paddingLeft={2}
                    marginTop={1}
                    backgroundColor={theme.backgroundPanel}
                    customBorderChars={SplitBorder.customBorderChars}
                    borderColor={theme.error}
                >
                    <text fg={theme.textMuted}>{props.message.error?.data.message}</text>
                </box>
            </Show>
            <Switch>
                <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
                    <box paddingLeft={3}>
                        <text marginTop={1}>
                            <span
                                style={{
                                    fg:
                                        props.message.error?.name === "MessageAbortedError"
                                            ? theme.textMuted
                                            : local.agent.color(props.message.agent),
                                }}
                            >
                                ▣{" "}
                            </span>{" "}
                            <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.mode)}</span>
                            <span style={{ fg: theme.textMuted }}> · {props.message.modelID}</span>
                            <Show when={duration()}>
                                <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
                            </Show>
                            <Show when={props.message.error?.name === "MessageAbortedError"}>
                                <span style={{ fg: theme.textMuted }}> · interrupted</span>
                            </Show>
                        </text>
                    </box>
                </Match>
            </Switch>
        </>
    )
}
