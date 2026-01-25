import { createMemo, createSignal, For, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Locale } from "@/util/locale"
import type { Part, UserMessage as UserMessageType } from "@atomcli/sdk/v2"
import { useSession } from "../context"

const MIME_BADGE: Record<string, string> = {
    "text/plain": "txt",
    "image/png": "img",
    "image/jpeg": "img",
    "image/gif": "img",
    "image/webp": "img",
    "application/pdf": "pdf",
    "application/x-directory": "dir",
}

export function UserMessage(props: {
    message: UserMessageType
    parts: Part[]
    onMouseUp: () => void
    index: number
    pending?: string
}) {
    const ctx = useSession()
    const local = useLocal()
    const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
    const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
    const sync = useSync()
    const { theme } = useTheme()
    const [hover, setHover] = createSignal(false)
    const queued = createMemo(() => props.pending && props.message.id > props.pending)
    const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))
    const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

    const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

    return (
        <>
            <Show when={text()}>
                <box
                    id={props.message.id}
                    border={["left"]}
                    borderColor={color()}
                    customBorderChars={SplitBorder.customBorderChars}
                    marginTop={props.index === 0 ? 0 : 1}
                >
                    <box
                        onMouseOver={() => {
                            setHover(true)
                        }}
                        onMouseOut={() => {
                            setHover(false)
                        }}
                        onMouseUp={props.onMouseUp}
                        paddingTop={1}
                        paddingBottom={1}
                        paddingLeft={2}
                        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                        flexShrink={0}
                    >
                        <text fg={theme.text}>{text()?.text}</text>
                        <Show when={files().length}>
                            <box flexDirection="row" paddingBottom={metadataVisible() ? 1 : 0} paddingTop={1} gap={1} flexWrap="wrap">
                                <For each={files()}>
                                    {(file) => {
                                        const bg = createMemo(() => {
                                            if (file.mime.startsWith("image/")) return theme.accent
                                            if (file.mime === "application/pdf") return theme.primary
                                            return theme.secondary
                                        })
                                        return (
                                            <text fg={theme.text}>
                                                <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                                                <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                                            </text>
                                        )
                                    }}
                                </For>
                            </box>
                        </Show>
                        <Show
                            when={queued()}
                            fallback={
                                <Show when={ctx.showTimestamps()}>
                                    <text fg={theme.textMuted}>
                                        <span style={{ fg: theme.textMuted }}>
                                            {Locale.todayTimeOrDateTime(props.message.time.created)}
                                        </span>
                                    </text>
                                </Show>
                            }
                        >
                            <text fg={theme.textMuted}>
                                <span style={{ bg: theme.accent, fg: theme.backgroundPanel, bold: true }}> QUEUED </span>
                            </text>
                        </Show>
                    </box>
                </box>
            </Show>
            <Show when={compaction()}>
                <box
                    marginTop={1}
                    border={["top"]}
                    title=" Compaction "
                    titleAlignment="center"
                    borderColor={theme.borderActive}
                />
            </Show>
        </>
    )
}
