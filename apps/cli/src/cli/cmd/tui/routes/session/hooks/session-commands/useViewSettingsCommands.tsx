import { batch } from "solid-js"
import type { SessionCommandContext } from "./types"

export function useViewSettingsCommands(ctx: SessionCommandContext) {
    return [
        {
            title: ctx.sidebarVisible() ? "Hide sidebar" : "Show sidebar",
            value: "session.sidebar.toggle",
            keybind: "sidebar_toggle",
            category: "Session",
            onSelect: (dialog: any) => {
                batch(() => {
                    const isVisible = ctx.sidebarVisible()
                    ctx.setSidebar(() => (isVisible ? "hide" : "auto"))
                    ctx.setSidebarOpen(!isVisible)
                })
                dialog.clear()
            },
        },
        {
            title: "Toggle code concealment",
            value: "session.toggle.conceal",
            keybind: "messages_toggle_conceal" as any,
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setConceal((prev: boolean) => !prev)
                dialog.clear()
            },
        },
        {
            title: ctx.showTimestamps() ? "Hide timestamps" : "Show timestamps",
            value: "session.toggle.timestamps",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setTimestamps((prev: any) => (prev === "show" ? "hide" : "show"))
                dialog.clear()
            },
        },
        {
            title: ctx.showThinking() ? "Hide thinking" : "Show thinking",
            value: "session.toggle.thinking",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setShowThinking((prev: boolean) => !prev)
                dialog.clear()
            },
        },
        {
            title: "Toggle diff wrapping",
            value: "session.toggle.diffwrap",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setDiffWrapMode((prev: any) => (prev === "word" ? "none" : "word"))
                dialog.clear()
            },
        },
        {
            title: ctx.showDetails() ? "Hide tool details" : "Show tool details",
            value: "session.toggle.actions",
            keybind: "tool_details",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setShowDetails((prev: boolean) => !prev)
                dialog.clear()
            },
        },
        {
            title: "Toggle session scrollbar",
            value: "session.toggle.scrollbar",
            keybind: "scrollbar_toggle",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setShowScrollbar((prev: boolean) => !prev)
                dialog.clear()
            },
        },
        {
            title: ctx.animationsEnabled() ? "Disable animations" : "Enable animations",
            value: "session.toggle.animations",
            category: "Session",
            onSelect: (dialog: any) => {
                ctx.setAnimationsEnabled((prev: boolean) => !prev)
                dialog.clear()
            },
        },
    ]
}
