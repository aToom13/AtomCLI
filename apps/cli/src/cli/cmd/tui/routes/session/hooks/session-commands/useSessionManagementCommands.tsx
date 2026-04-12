import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../../../../ui/toast"
import { useLocal } from "@tui/context/local"
import { useRenderer } from "@opentui/solid"
import { Clipboard } from "../../../../util/clipboard"
import { Editor } from "../../../../util/editor"
import { DialogSessionRename } from "../../../../component/dialog-session-rename"
import { DialogExportOptions } from "../../../../ui/dialog-export-options"
import { formatTranscript } from "../../../../util/transcript"
import path from "path"
import type { SessionCommandContext } from "./types"

export function useSessionManagementCommands(ctx: SessionCommandContext) {
    const route = useRouteData("session") as any
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()
    const local = useLocal()
    const renderer = useRenderer()

    return [
        ...(sync.data.config.share !== "disabled"
            ? [
                {
                    title: "Share session",
                    value: "session.share",
                    suggested: route.type === "session",
                    keybind: "session_share" as const,
                    disabled: !!ctx.session()?.share?.url,
                    category: "Session",
                    onSelect: async (dialog: any) => {
                        await sdk.client.session
                            .share({
                                sessionID: route.sessionID,
                            })
                            .then((res) =>
                                Clipboard.copy(res.data!.share!.url).catch(() =>
                                    toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
                                ),
                            )
                            .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
                            .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
                        dialog.clear()
                    },
                },
            ]
            : []),
        {
            title: "Rename session",
            value: "session.rename",
            keybind: "session_rename",
            category: "Session",
            onSelect: (dialog: any) => {
                dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
            },
        },
        {
            title: "Compact session",
            value: "session.compact",
            keybind: "session_compact",
            category: "Session",
            onSelect: (dialog: any) => {
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
                dialog.clear()
            },
        },
        {
            title: "Unshare session",
            value: "session.unshare",
            keybind: "session_unshare",
            disabled: !ctx.session()?.share?.url,
            category: "Session",
            onSelect: async (dialog: any) => {
                await sdk.client.session
                    .unshare({
                        sessionID: route.sessionID,
                    })
                    .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
                    .catch(() => toast.show({ message: "Failed to unshare session", variant: "error" }))
                dialog.clear()
            },
        },
        {
            title: "Copy session transcript",
            value: "session.copy",
            keybind: "session_copy",
            category: "Session",
            onSelect: async (dialog: any) => {
                try {
                    const sessionData = ctx.session()
                    if (!sessionData) return
                    const sessionMessages = ctx.messages()
                    const transcript = formatTranscript(
                        sessionData,
                        sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
                        {
                            thinking: ctx.showThinking(),
                            toolDetails: ctx.showDetails(),
                            assistantMetadata: ctx.showAssistantMetadata(),
                        },
                    )
                    await Clipboard.copy(transcript)
                    toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
                } catch (error) {
                    toast.show({ message: "Failed to copy session transcript", variant: "error" })
                }
                dialog.clear()
            },
        },
        {
            title: "Export session transcript",
            value: "session.export",
            keybind: "session_export",
            category: "Session",
            onSelect: async (dialog: any) => {
                try {
                    const sessionData = ctx.session()
                    if (!sessionData) return
                    const sessionMessages = ctx.messages()
                    const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`
                    const options = await DialogExportOptions.show(
                        dialog,
                        defaultFilename,
                        ctx.showThinking(),
                        ctx.showDetails(),
                        ctx.showAssistantMetadata(),
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
                        await Editor.open({ value: transcript, renderer })
                    } else {
                        const exportDir = process.cwd()
                        const filename = options.filename.trim()
                        const filepath = path.join(exportDir, filename)
                        await Bun.write(filepath, transcript)
                        const result = await Editor.open({ value: transcript, renderer })
                        if (result !== undefined) {
                            await Bun.write(filepath, result)
                        }
                        toast.show({ message: `Session exported to ${filename}`, variant: "success" })
                    }
                } catch (error) {
                    toast.show({ message: "Failed to export session", variant: "error" })
                }
                dialog.clear()
            },
        },
        {
            title: "Next child session",
            value: "session.child.next",
            keybind: "session_child_cycle",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                ctx.moveChild(1)
                dialog.clear()
            },
        },
        {
            title: "Previous child session",
            value: "session.child.previous",
            keybind: "session_child_cycle_reverse",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                ctx.moveChild(-1)
                dialog.clear()
            },
        },
        {
            title: "Go to parent session",
            value: "session.parent",
            keybind: "session_parent",
            category: "Session",
            disabled: true,
            onSelect: (dialog: any) => {
                const parentID = ctx.session()?.parentID
                if (parentID) {
                    ctx.navigate({
                        type: "session",
                        sessionID: parentID,
                    })
                }
                dialog.clear()
            },
        },
    ]
}
