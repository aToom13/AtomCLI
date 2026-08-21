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
import { useSession } from "../context"

const PART_MAPPING = {
    text: TextPart,
    tool: ToolPart,
    reasoning: ReasoningPart,
}

export function AssistantMessage(props: { message: AssistantMessageType; parts: Part[]; last: boolean }) {
    const local = useLocal()
    const { theme } = useTheme()
    const sync = useSync()
    const session = useSession()
    const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])

    // Whether the message is done (finished, aborted, or errored)
    const isDone = createMemo(() => {
        if (props.message.error) return true
        return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
    })

    const userMessage = createMemo(() => messages().find((x) => x.role === "user" && x.id === props.message.parentID))
    const userCreated = createMemo(() => userMessage()?.time?.created ?? 0)
    const thinkingVariant = createMemo(() => {
        const message = userMessage()
        return message?.role === "user" ? message.variant : undefined
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

    const reasoningTokens = createMemo(() => {
        let chars = 0
        for (const part of props.parts) {
            if (part.type === "reasoning") {
                chars += (part.text || "").replace("[REDACTED]", "").length
            } else if (part.type === "tool" && ((part as any).tool === "sequentialthinking" || (part as any).tool === "sequential_thinking")) {
                const thought = (part as any).state?.input?.thought || ""
                chars += thought.length
            }
        }
        const estimated = chars > 0 ? Math.round(chars / 3) : 0
        return Math.max(props.message.tokens?.reasoning ?? 0, estimated)
    })
    const compact = createMemo(() => session.width < 58)
    const modelLabel = createMemo(() => Locale.truncateMiddle(props.message.modelID, compact() ? 18 : 32))

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
                        <text marginTop={session.verticalMode === "normal" ? 1 : 0} wrapMode="word">
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
                            <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.agent)}</span>
                            <span style={{ fg: theme.textMuted }}> · {modelLabel()}</span>
                            <Show when={reasoningTokens() > 0 && !compact()}>
                                <span style={{ fg: theme.textMuted }}> · 🧠 {reasoningTokens().toLocaleString()} tokens</span>
                            </Show>
                            <Show when={thinkingVariant() && session.width >= 70}>
                                <span style={{ fg: theme.accent }}> · think {thinkingVariant()?.toUpperCase()}</span>
                            </Show>
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
