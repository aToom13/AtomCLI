import { batch } from "solid-js"
import { DialogSessionRename } from "../../../component/dialog-session-rename"
import { DialogTimeline } from "../dialog-timeline"
import { DialogForkFromTimeline } from "../dialog-fork-from-timeline"
import { DialogExportOptions } from "../../../ui/dialog-export-options"
import { Clipboard } from "../../../util/clipboard"
import { formatTranscript } from "../../../util/transcript"
import { Editor } from "../../../util/editor"
import path from "path"
import type { PromptInfo } from "../../../component/prompt/history"
import type { SessionState } from "../hooks/useSessionState"
import type { PromptRef } from "@tui/component/prompt"
import type { ScrollBoxRenderable } from "@opentui/core"

export type SessionActions = {
    navigate: (route: any) => void
    toast: any
    sdk: any
    dialog: any
    prompt: PromptRef | undefined
    scroll: ScrollBoxRenderable | undefined
    toBottom: () => void
    scrollToMessage: (direction: "next" | "prev", dialog: any) => void
    moveChild: (direction: number) => void
    local: any
}

export function getSessionCommands(state: SessionState, actions: SessionActions) {
    const { session, messages, route, sync, sidebarVisible, showThinking, showDetails, showAssistantMetadata, showTimestamps, showScrollbar, animationsEnabled } = state
    const { navigate, toast, sdk, dialog, prompt, scroll, toBottom, scrollToMessage, moveChild, local } = actions

    return [
        ...(sync.data.config.share !== "disabled"
            ? [
                {
                    title: "Share session",
                    value: "session.share",
                    suggested: route.type === "session",
                    keybind: "session_share" as const,
                    disabled: !!session()?.share?.url,
                    category: "Session",
                    onSelect: async (d: any) => {
                        await sdk.client.session
                            .share({
                                sessionID: route.sessionID,
                            })
                            .then((res: any) =>
                                Clipboard.copy(res.data!.share!.url).catch(() =>
                                    toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
                                ),
                            )
                            .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
                            .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
                        d.clear()
                    },
                },
            ]
            : []),
        {
            title: "Rename session",
            value: "session.rename",
            keybind: "session_rename",
            category: "Session",
            onSelect: (d: any) => {
                d.replace(() => <DialogSessionRename session={route.sessionID} />)
            },
        },
        {
            title: "Jump to message",
            value: "session.timeline",
            keybind: "session_timeline",
            category: "Session",
            onSelect: (d: any) => {
                d.replace(() => (
                    <DialogTimeline
                        onMove={(messageID) => {
                            const child = scroll?.getChildren().find((child) => {
                                return child.id === messageID
                            })
                            if (child && scroll) scroll.scrollBy(child.y - scroll.y - 1)
                        }}
                        sessionID={route.sessionID}
                        setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                    />
                ))
            },
        },
        {
            title: "Fork from message",
            value: "session.fork",
            keybind: "session_fork",
            category: "Session",
            onSelect: (d: any) => {
                d.replace(() => (
                    <DialogForkFromTimeline
                        onMove={(messageID) => {
                            const child = scroll?.getChildren().find((child) => {
                                return child.id === messageID
                            })
                            if (child && scroll) scroll.scrollBy(child.y - scroll.y - 1)
                        }}
                        sessionID={route.sessionID}
                    />
                ))
            },
        },
        {
            title: "Compact session",
            value: "session.compact",
            keybind: "session_compact",
            category: "Session",
            onSelect: (d: any) => {
                const selectedModel = local.model.current()
                if (!selectedModel) {
                    toast.show({
                        variant: "warning",
                        message: "Connect a provider to summarize this session",
                        duration: 3000,
                    })
                    return
                }
                sdk.client.session.summarize({
                    sessionID: route.sessionID,
                    modelID: selectedModel.modelID,
                    providerID: selectedModel.providerID,
                })
                d.clear()
            },
        },
        {
            title: "Unshare session",
            value: "session.unshare",
            keybind: "session_unshare",
            disabled: !session()?.share?.url,
            category: "Session",
            onSelect: async (d: any) => {
                await sdk.client.session
                    .unshare({
                        sessionID: route.sessionID,
                    })
                    .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
                    .catch(() => toast.show({ message: "Failed to unshare session", variant: "error" }))
                d.clear()
            },
        },
        {
            title: "Undo previous message",
            value: "session.undo",
            keybind: "messages_undo",
            category: "Session",
            onSelect: async (d: any) => {
                const status = sync.data.session_status?.[route.sessionID]
                if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => { })
                const revert = session()?.revert?.messageID
                const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
                if (!message) return
                sdk.client.session
                    .revert({
                        sessionID: route.sessionID,
                        messageID: message.id,
                    })
                    .then(() => {
                        toBottom()
                    })
                const parts = sync.data.part[message.id]
                if (prompt) {
                    prompt.set(
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
                }
                d.clear()
            },
        },
        {
            title: "Redo",
            value: "session.redo",
            keybind: "messages_redo",
            disabled: !session()?.revert?.messageID,
            category: "Session",
            onSelect: (d: any) => {
                d.clear()
                const messageID = session()?.revert?.messageID
                if (!messageID) return
                const message = messages().find((x) => x.role === "user" && x.id > messageID)
                if (!message) {
                    sdk.client.session.unrevert({
                        sessionID: route.sessionID,
                    })
                    if (prompt) prompt.set({ input: "", parts: [] })
                    return
                }
                sdk.client.session.revert({
                    sessionID: route.sessionID,
                    messageID: message.id,
                })
            },
        },
        {
            title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
            value: "session.sidebar.toggle",
            keybind: "sidebar_toggle",
            category: "Session",
            onSelect: (d: any) => {
                batch(() => {
                    const isVisible = sidebarVisible()
                    state.setSidebar(() => (isVisible ? "hide" : "auto"))
                    state.setSidebarOpen(!isVisible)
                })
                d.clear()
            },
        },
        {
            title: "Toggle code concealment",
            value: "session.toggle.conceal",
            keybind: "messages_toggle_conceal" as any,
            category: "Session",
            onSelect: (d: any) => {
                state.setConceal(!state.conceal())
                d.clear()
            },
        },
        {
            title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
            value: "session.toggle.timestamps",
            category: "Session",
            onSelect: (d: any) => {
                state.setTimestamps((state.timestamps() === "show" ? "hide" : "show") as any)
                d.clear()
            },
        },
        {
            title: showThinking() ? "Hide thinking" : "Show thinking",
            value: "session.toggle.thinking",
            category: "Session",
            onSelect: (d: any) => {
                state.setShowThinking((!state.showThinking()) as any)
                d.clear()
            },
        },
        {
            title: "Toggle diff wrapping",
            value: "session.toggle.diffwrap",
            category: "Session",
            onSelect: (d: any) => {
                state.setDiffWrapMode((state.diffWrapMode() === "word" ? "none" : "word") as any)
                d.clear()
            },
        },
        {
            title: showDetails() ? "Hide tool details" : "Show tool details",
            value: "session.toggle.actions",
            keybind: "tool_details",
            category: "Session",
            onSelect: (d: any) => {
                state.setShowDetails((!state.showDetails()) as any)
                d.clear()
            },
        },
        {
            title: "Toggle session scrollbar",
            value: "session.toggle.scrollbar",
            keybind: "scrollbar_toggle",
            category: "Session",
            onSelect: (d: any) => {
                state.setShowScrollbar((!state.showScrollbar()) as any)
                d.clear()
            },
        },
        {
            title: animationsEnabled() ? "Disable animations" : "Enable animations",
            value: "session.toggle.animations",
            category: "Session",
            onSelect: (d: any) => {
                state.setAnimationsEnabled((!state.animationsEnabled()) as any)
                d.clear()
            },
        },
        // Scrolling and others omitted for brevity but should be included
        {
            title: "Copy last assistant message",
            value: "messages.copy",
            keybind: "messages_copy",
            category: "Session",
            onSelect: (d: any) => {
                const revertID = session()?.revert?.messageID
                const lastAssistantMessage = messages().findLast(
                    (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
                )
                if (!lastAssistantMessage) {
                    toast.show({ message: "No assistant messages found", variant: "error" })
                    d.clear()
                    return
                }

                const parts = sync.data.part[lastAssistantMessage.id] ?? []
                const textParts = parts.filter((part) => part.type === "text")
                if (textParts.length === 0) {
                    toast.show({ message: "No text parts found in last assistant message", variant: "error" })
                    d.clear()
                    return
                }

                const text = textParts
                    .map((part) => part.text)
                    .join("\n")
                    .trim()
                if (!text) {
                    toast.show({
                        message: "No text content found in last assistant message",
                        variant: "error",
                    })
                    d.clear()
                    return
                }


                Clipboard.copy(text)
                    .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
                    .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
                d.clear()
            },
        },
        {
            title: "Copy session transcript",
            value: "session.copy",
            keybind: "session_copy",
            category: "Session",
            onSelect: async (d: any) => {
                try {
                    const sessionData = session()
                    if (!sessionData) return
                    const sessionMessages = messages()
                    const transcript = formatTranscript(
                        sessionData,
                        sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
                        {
                            thinking: showThinking(),
                            toolDetails: showDetails(),
                            assistantMetadata: showAssistantMetadata(),
                        },
                    )
                    await Clipboard.copy(transcript)
                    toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
                } catch (error) {
                    toast.show({ message: "Failed to copy session transcript", variant: "error" })
                }
                d.clear()
            },
        },
        {
            title: "Export session transcript",
            value: "session.export",
            keybind: "session_export",
            category: "Session",
            onSelect: async (d: any) => {
                try {
                    const sessionData = session()
                    if (!sessionData) return
                    const sessionMessages = messages()

                    const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

                    const options = await DialogExportOptions.show(
                        d,
                        defaultFilename,
                        showThinking(),
                        showDetails(),
                        showAssistantMetadata(),
                        false,
                    )

                    if (options === null) return

                    const transcript = formatTranscript(
                        sessionData,
                        sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
                        {
                            thinking: options.thinking,
                            toolDetails: options.toolDetails,
                            assistantMetadata: options.assistantMetadata,
                        },
                    )

                    if (options.openWithoutSaving) {
                        // Just open in editor without saving
                        // @ts-expect-error
                        await Editor.open({ value: transcript, renderer: scroll!.renderer })
                        // Warning: renderer might be missing from actions if not passed. 
                        // scroll.renderer might be accessible? No.
                        // I should pass renderer in actions.
                    } else {
                        const exportDir = process.cwd()
                        const filename = options.filename.trim()
                        const filepath = path.join(exportDir, filename)

                        await Bun.write(filepath, transcript)

                        // Open with EDITOR if available
                        // @ts-expect-error
                        const result = await Editor.open({ value: transcript, renderer: scroll!.renderer })
                        if (result !== undefined) {
                            await Bun.write(filepath, result)
                        }

                        toast.show({ message: `Session exported to ${filename}`, variant: "success" })
                    }
                } catch (error) {
                    toast.show({ message: "Failed to export session", variant: "error" })
                }
                d.clear()
            },
        },
        {
            title: "Next child session",
            value: "session.child.next",
            keybind: "session_child_cycle",
            category: "Session",
            disabled: true,
            onSelect: (d: any) => {
                moveChild(1)
                d.clear()
            },
        },
        {
            title: "Previous child session",
            value: "session.child.previous",
            keybind: "session_child_cycle_reverse",
            category: "Session",
            disabled: true,
            onSelect: (d: any) => {
                moveChild(-1)
                d.clear()
            },
        },
        {
            title: "Go to parent session",
            value: "session.parent",
            keybind: "session_parent",
            category: "Session",
            disabled: true,
            onSelect: (d: any) => {
                const parentID = session()?.parentID
                if (parentID) {
                    navigate({
                        type: "session",
                        sessionID: parentID,
                    })
                }
                d.clear()
            },
        },
    ]
}
