import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../../../../ui/toast"
import { useRenderer } from "@opentui/solid"
import { Clipboard } from "../../../../util/clipboard"
import type { SessionCommandContext } from "./types"
import type { PromptInfo } from "../../../../component/prompt/history"

export function useMessageOperationsCommands(ctx: SessionCommandContext) {
    const route = useRouteData("session") as any
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const renderer = useRenderer()

    return [
        {
            title: "Undo previous message",
            value: "session.undo",
            keybind: "messages_undo",
            category: "Session",
            onSelect: async (dialog: any) => {
                const status = sync.data.session_status?.[route.sessionID]
                if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => { })
                const revert = ctx.session()?.revert?.messageID
                const message = ctx.messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
                if (!message) return
                sdk.client.session
                    .revert({
                        sessionID: route.sessionID,
                        messageID: message.id,
                    })
                    .then(() => {
                        ctx.toBottom()
                    })
                const parts = sync.data.part[message.id]
                ctx.prompt?.set(
                    parts.reduce(
                        (agg: any, part: any) => {
                            if (part.type === "text") {
                                if (!part.synthetic) agg.input += part.text
                            }
                            if (part.type === "file") agg.parts.push(part)
                            return agg
                        },
                        { input: "", parts: [] as PromptInfo["parts"] },
                    ),
                )
                dialog.clear()
            },
        },
        {
            title: "Redo",
            value: "session.redo",
            keybind: "messages_redo",
            disabled: !ctx.session()?.revert?.messageID,
            category: "Session",
            onSelect: (dialog: any) => {
                dialog.clear()
                const messageID = ctx.session()?.revert?.messageID
                if (!messageID) return
                const message = ctx.messages().find((x) => x.role === "user" && x.id > messageID)
                if (!message) {
                    sdk.client.session.unrevert({
                        sessionID: route.sessionID,
                    })
                    ctx.prompt?.set({ input: "", parts: [] })
                    return
                }
                sdk.client.session.revert({
                    sessionID: route.sessionID,
                    messageID: message.id,
                })
            },
        },
        {
            title: "Page up",
            value: "session.page.up",
            keybind: "messages_page_up",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollBy(-ctx.scroll.height / 2)
                dialog.clear()
            },
        },
        {
            title: "Page down",
            value: "session.page.down",
            keybind: "messages_page_down",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollBy(ctx.scroll.height / 2)
                dialog.clear()
            },
        },
        {
            title: "Half page up",
            value: "session.half.page.up",
            keybind: "messages_half_page_up",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollBy(-ctx.scroll.height / 4)
                dialog.clear()
            },
        },
        {
            title: "Half page down",
            value: "session.half.page.down",
            keybind: "messages_half_page_down",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollBy(ctx.scroll.height / 4)
                dialog.clear()
            },
        },
        {
            title: "First message",
            value: "session.first",
            keybind: "messages_first",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollTo(0)
                dialog.clear()
            },
        },
        {
            title: "Last message",
            value: "session.last",
            keybind: "messages_last",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                if (ctx.scroll) ctx.scroll.scrollTo(ctx.scroll.scrollHeight)
                dialog.clear()
            },
        },
        {
            title: "Jump to last user message",
            value: "session.messages_last_user",
            keybind: "messages_last_user",
            category: "Session",
            onSelect: () => {
                const messages = sync.data.message[route.sessionID]
                if (!messages || !messages.length) return
                for (let i = messages.length - 1; i >= 0; i--) {
                    const message = messages[i]
                    if (!message || message.role !== "user") continue
                    const parts = sync.data.part[message.id]
                    if (!parts || !Array.isArray(parts)) continue
                    const hasValidTextPart = parts.some(
                        (part: any) => part && part.type === "text" && !part.synthetic && !part.ignored,
                    )
                    if (hasValidTextPart) {
                        const child = ctx.scroll?.getChildren().find((child) => {
                            return child.id === message.id
                        })
                        if (child && ctx.scroll) ctx.scroll.scrollBy(child.y - ctx.scroll.y - 1)
                        break
                    }
                }
            },
        },
        {
            title: "Next message",
            value: "session.message.next",
            keybind: "messages_next",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => ctx.scrollToMessage("next", dialog),
        },
        {
            title: "Previous message",
            value: "session.message.previous",
            keybind: "messages_previous",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => ctx.scrollToMessage("prev", dialog),
        },
        {
            title: "Copy last assistant message",
            value: "messages.copy",
            keybind: "messages_copy",
            category: "Session",
            onSelect: (dialog: any) => {
                const revertID = ctx.session()?.revert?.messageID
                const lastAssistantMessage = ctx.messages().findLast(
                    (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
                )
                if (!lastAssistantMessage) {
                    toast.show({ message: "No assistant messages found", variant: "error" })
                    dialog.clear()
                    return
                }
                const parts = sync.data.part[lastAssistantMessage.id] ?? []
                const textParts = parts.filter((part: any) => part.type === "text")
                if (textParts.length === 0) {
                    toast.show({ message: "No text parts found in last assistant message", variant: "error" })
                    dialog.clear()
                    return
                }
                const text = textParts
                    .map((part: any) => part.text)
                    .join("\n")
                    .trim()
                if (!text) {
                    toast.show({
                        message: "No text content found in last assistant message",
                        variant: "error",
                    })
                    dialog.clear()
                    return
                }
                const base64 = Buffer.from(text).toString("base64")
                const osc52 = `\x1b]52;c;${base64}\x07`
                const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
                /* @ts-expect-error */
                renderer.writeOut(finalOsc52)
                Clipboard.copy(text)
                    .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
                    .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
                dialog.clear()
            },
        },
    ]
}
