import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
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

    // Whether the message is done (finished, aborted, or errored)
    const isDone = createMemo(() => {
        if (props.message.error) return true
        return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
    })

    // Find the parent user message creation time
    const userCreated = createMemo(() => {
        const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
        return user?.time?.created ?? 0
    })

    // Live ticking timer — updates every second while the message is in progress
    const [now, setNow] = createSignal(Date.now())
    const timer = setInterval(() => {
        if (!isDone()) setNow(Date.now())
    }, 1000)
    onCleanup(() => clearInterval(timer))

    const duration = createMemo(() => {
        const start = userCreated()
        if (!start) return 0
        if (isDone() && props.message.time.completed) {
            // Final: show exact completed duration
            return props.message.time.completed - start
        }
        if (isDone()) {
            // Aborted/errored: freeze at current time
            return now() - start
        }
        // Live: show ticking elapsed time
        return now() - start
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
                <Match when={props.last || isDone() || props.message.error?.name === "MessageAbortedError"}>
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
                            <Show when={duration() > 0}>
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
