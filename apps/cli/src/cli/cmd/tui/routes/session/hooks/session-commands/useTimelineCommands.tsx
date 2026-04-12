import { useRouteData } from "@tui/context/route"
import { DialogTimeline } from "../../dialog-timeline"
import { DialogForkFromTimeline } from "../../dialog-fork-from-timeline"
import type { PromptInfo } from "../../../../component/prompt/history"
import type { SessionCommandContext } from "./types"

export function useTimelineCommands(ctx: SessionCommandContext) {
    const route = useRouteData("session") as any

    return [
        {
            title: "Jump to message",
            value: "session.timeline",
            keybind: "session_timeline",
            category: "Session",
            onSelect: (dialog: any) => {
                dialog.replace(() => (
                    <DialogTimeline
                        onMove={(messageID: string) => {
                            const child = ctx.scroll?.getChildren().find((child) => {
                                return child.id === messageID
                            })
                            if (child && ctx.scroll) ctx.scroll.scrollBy(child.y - ctx.scroll.y - 1)
                        }}
                        sessionID={route.sessionID}
                        setPrompt={(promptInfo: PromptInfo) => ctx.prompt?.set(promptInfo)}
                    />
                ))
            },
        },
        {
            title: "Fork from message",
            value: "session.fork",
            keybind: "session_fork",
            category: "Session",
            onSelect: (dialog: any) => {
                dialog.replace(() => (
                    <DialogForkFromTimeline
                        onMove={(messageID: string) => {
                            const child = ctx.scroll?.getChildren().find((child) => {
                                return child.id === messageID
                            })
                            if (child && ctx.scroll) ctx.scroll.scrollBy(child.y - ctx.scroll.y - 1)
                        }}
                        sessionID={route.sessionID}
                    />
                ))
            },
        },
    ]
}
