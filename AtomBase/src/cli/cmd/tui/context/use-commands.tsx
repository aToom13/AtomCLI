import { useDialog } from "@tui/ui/dialog"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useToast } from "../ui/toast"
import { useExit } from "../context/exit"
import { useTheme } from "@tui/context/theme"
import { useKV } from "../context/kv"
import { usePromptRef } from "../context/prompt"
import { useFileTree } from "../context/file-tree"
import { useRenderer } from "@opentui/solid"
import { useConnected, DialogModel } from "@tui/component/dialog-model"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "../ui/dialog-help"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import open from "open"
import { writeHeapSnapshot } from "v8"
import { createSignal } from "solid-js"

/**
 * Registers all command palette entries for the TUI.
 * Extracted from App() in app.tsx to reduce component size.
 */
export function useCommands() {
    const dialog = useDialog()
    const command = useCommandDialog()
    const local = useLocal()
    const route = useRoute()
    const sync = useSync()
    const toast = useToast()
    const exit = useExit()
    const { mode, setMode } = useTheme()
    const kv = useKV()
    const promptRef = usePromptRef()
    const fileTreeCtx = useFileTree()
    const renderer = useRenderer()
    const connected = useConnected()

    const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))

    command.register(() => [
        {
            title: "Switch session",
            value: "session.list",
            keybind: "session_list",
            category: "Session",
            suggested: sync.data.session.length > 0,
            onSelect: () => {
                dialog.replace(() => <DialogSessionList />)
            },
        },
        {
            title: "New session",
            suggested: route.data.type === "session",
            value: "session.new",
            keybind: "session_new",
            category: "Session",
            onSelect: () => {
                const current = promptRef.current
                // Don't require focus - if there's any text, preserve it
                const currentPrompt = current?.current?.input ? current.current : undefined
                route.navigate({
                    type: "home",
                    initialPrompt: currentPrompt,
                })
                dialog.clear()
            },
        },
        {
            title: "Switch model",
            value: "model.list",
            keybind: "model_list",
            suggested: true,
            category: "Agent",
            onSelect: () => {
                dialog.replace(() => <DialogModel />)
            },
        },
        {
            title: "Model cycle",
            disabled: true,
            value: "model.cycle_recent",
            keybind: "model_cycle_recent",
            category: "Agent",
            onSelect: () => {
                local.model.cycle(1)
            },
        },
        {
            title: "Model cycle reverse",
            disabled: true,
            value: "model.cycle_recent_reverse",
            keybind: "model_cycle_recent_reverse",
            category: "Agent",
            onSelect: () => {
                local.model.cycle(-1)
            },
        },
        {
            title: "Favorite cycle",
            value: "model.cycle_favorite",
            keybind: "model_cycle_favorite",
            category: "Agent",
            onSelect: () => {
                local.model.cycleFavorite(1)
            },
        },
        {
            title: "Favorite cycle reverse",
            value: "model.cycle_favorite_reverse",
            keybind: "model_cycle_favorite_reverse",
            category: "Agent",
            onSelect: () => {
                local.model.cycleFavorite(-1)
            },
        },
        {
            title: "Switch agent",
            value: "agent.list",
            keybind: "agent_list",
            category: "Agent",
            onSelect: () => {
                dialog.replace(() => <DialogAgent />)
            },
        },
        {
            title: "Toggle MCPs",
            value: "mcp.list",
            category: "Agent",
            onSelect: () => {
                dialog.replace(() => <DialogMcp />)
            },
        },
        {
            title: "Agent cycle",
            value: "agent.cycle",
            keybind: "agent_cycle",
            category: "Agent",
            disabled: true,
            onSelect: () => {
                local.agent.move(1)
            },
        },
        {
            title: "Variant cycle",
            value: "variant.cycle",
            keybind: "variant_cycle",
            category: "Agent",
            onSelect: () => {
                local.model.variant.cycle()
            },
        },
        {
            title: "Agent cycle reverse",
            value: "agent.cycle.reverse",
            keybind: "agent_cycle_reverse",
            category: "Agent",
            disabled: true,
            onSelect: () => {
                local.agent.move(-1)
            },
        },
        {
            title: "Connect provider",
            value: "provider.connect",
            suggested: !connected(),
            onSelect: () => {
                dialog.replace(() => <DialogProviderList />)
            },
            category: "Provider",
        },
        {
            title: "View status",
            keybind: "status_view",
            value: "atomcli.status",
            onSelect: () => {
                dialog.replace(() => <DialogStatus />)
            },
            category: "System",
        },
        {
            title: "Switch theme",
            value: "theme.switch",
            keybind: "theme_list",
            onSelect: () => {
                dialog.replace(() => <DialogThemeList />)
            },
            category: "System",
        },
        {
            title: "Toggle appearance",
            value: "theme.switch_mode",
            onSelect: (dialog) => {
                setMode(mode() === "dark" ? "light" : "dark")
                dialog.clear()
            },
            category: "System",
        },
        {
            title: "Help",
            value: "help.show",
            onSelect: () => {
                dialog.replace(() => <DialogHelp />)
            },
            category: "System",
        },
        {
            title: "Open docs",
            value: "docs.open",
            onSelect: () => {
                open("https://atomcli.ai/docs").catch(() => { })
                dialog.clear()
            },
            category: "System",
        },
        {
            title: "Exit the app",
            value: "app.exit",
            onSelect: () => exit(),
            category: "System",
        },
        {
            title: "Toggle debug panel",
            category: "System",
            value: "app.debug",
            onSelect: (dialog) => {
                renderer.toggleDebugOverlay()
                dialog.clear()
            },
        },
        {
            title: "Toggle console",
            category: "System",
            value: "app.console",
            onSelect: (dialog) => {
                renderer.console.toggle()
                dialog.clear()
            },
        },
        {
            title: "Write heap snapshot",
            category: "System",
            value: "app.heap_snapshot",
            onSelect: (dialog) => {
                const path = writeHeapSnapshot()
                toast.show({
                    variant: "info",
                    message: `Heap snapshot written to ${path}`,
                    duration: 5000,
                })
                dialog.clear()
            },
        },
        {
            title: "Suspend terminal",
            value: "terminal.suspend",
            keybind: "terminal_suspend",
            category: "System",
            onSelect: () => {
                process.once("SIGCONT", () => {
                    renderer.resume()
                })

                renderer.suspend()
                // pid=0 means send the signal to all processes in the process group
                process.kill(0, "SIGTSTP")
            },
        },
        {
            title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
            value: "terminal.title.toggle",
            keybind: "terminal_title_toggle",
            category: "System",
            onSelect: (dialog) => {
                setTerminalTitleEnabled((prev) => {
                    const next = !prev
                    kv.set("terminal_title_enabled", next)
                    if (!next) renderer.setTerminalTitle("")
                    return next
                })
                dialog.clear()
            },
        },
        {
            title: "List skills",
            value: "skill.list",
            category: "Agent",
            onSelect: (dialog) => {
                const current = promptRef.current
                if (current) {
                    current.set({
                        input: "List all installed skills and their descriptions.",
                        parts: [],
                    })
                    current.submit()
                }
                dialog.clear()
            },
        },
        {
            title: "Toggle file tree",
            value: "filetree.toggle",
            keybind: "filetree_toggle" as any,
            category: "View",
            onSelect: (dialog) => {
                fileTreeCtx.toggleFileTree()
                dialog.clear()
            },
        },
        {
            title: "Toggle code panel",
            value: "codepanel.toggle",
            keybind: "codepanel_toggle" as any,
            category: "View",
            onSelect: (dialog) => {
                fileTreeCtx.toggleCodePanel()
                dialog.clear()
            },
        },
    ])

    return { terminalTitleEnabled }
}
