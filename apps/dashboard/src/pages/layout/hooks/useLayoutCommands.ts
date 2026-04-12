import { createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useCommand, CommandOption } from "@/context/command"
import { useLayout } from "@/context/layout"
import { useTheme, ColorScheme } from "@atomcli/ui/theme"
import { showToast } from "@atomcli/ui/toast"
import { Session } from "@atomcli/sdk/v2/client"

// Interface for dependencies
// We can use ReturnType or explicit interface
interface LayoutCommandsProps {
    actions: {
        chooseProject: () => Promise<void>
        connectProvider: () => void
        openServer: () => void
        archiveSession: (session: Session) => void
    }
    navigation: {
        navigateSessionByOffset: (offset: number) => void
    }
    currentSessions: () => Session[]
}

export function useLayoutCommands(props: LayoutCommandsProps) {
    const command = useCommand()
    const layout = useLayout()
    const theme = useTheme()
    const params = useParams()

    const availableThemeEntries = createMemo(() => Object.entries(theme.themes()))
    const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
    const colorSchemeLabel: Record<ColorScheme, string> = {
        system: "System",
        light: "Light",
        dark: "Dark",
    }

    function cycleTheme(direction = 1) {
        const ids = availableThemeEntries().map(([id]) => id)
        if (ids.length === 0) return
        const currentIndex = ids.indexOf(theme.themeId())
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
        const nextThemeId = ids[nextIndex]
        theme.setTheme(nextThemeId)
        const nextTheme = theme.themes()[nextThemeId]
        showToast({
            title: "Theme switched",
            description: nextTheme?.name ?? nextThemeId,
        })
    }

    function cycleColorScheme(direction = 1) {
        const current = theme.colorScheme()
        const currentIndex = colorSchemeOrder.indexOf(current)
        const nextIndex =
            currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
        const next = colorSchemeOrder[nextIndex]
        theme.setColorScheme(next)
        showToast({
            title: "Color scheme",
            description: colorSchemeLabel[next],
        })
    }

    command.register(() => {
        const commands: CommandOption[] = [
            {
                id: "sidebar.toggle",
                title: "Toggle sidebar",
                category: "View",
                keybind: "mod+b",
                onSelect: () => layout.sidebar.toggle(),
            },
            {
                id: "project.open",
                title: "Open project",
                category: "Project",
                keybind: "mod+o",
                onSelect: () => props.actions.chooseProject(),
            },
            {
                id: "provider.connect",
                title: "Connect provider",
                category: "Provider",
                onSelect: () => props.actions.connectProvider(),
            },
            {
                id: "server.switch",
                title: "Switch server",
                category: "Server",
                onSelect: () => props.actions.openServer(),
            },
            {
                id: "session.previous",
                title: "Previous session",
                category: "Session",
                keybind: "alt+arrowup",
                onSelect: () => props.navigation.navigateSessionByOffset(-1),
            },
            {
                id: "session.next",
                title: "Next session",
                category: "Session",
                keybind: "alt+arrowdown",
                onSelect: () => props.navigation.navigateSessionByOffset(1),
            },
            {
                id: "session.archive",
                title: "Archive session",
                category: "Session",
                keybind: "mod+shift+backspace",
                disabled: !params.dir || !params.id,
                onSelect: () => {
                    const session = props.currentSessions().find((s) => s.id === params.id)
                    if (session) props.actions.archiveSession(session)
                },
            },
            {
                id: "theme.cycle",
                title: "Cycle theme",
                category: "Theme",
                keybind: "mod+shift+t",
                onSelect: () => cycleTheme(1),
            },
        ]

        for (const [id, definition] of availableThemeEntries()) {
            commands.push({
                id: `theme.set.${id}`,
                title: `Use theme: ${definition.name ?? id}`,
                category: "Theme",
                onSelect: () => theme.commitPreview(),
                onHighlight: () => {
                    theme.previewTheme(id)
                    return () => theme.cancelPreview()
                },
            })
        }

        commands.push({
            id: "theme.scheme.cycle",
            title: "Cycle color scheme",
            category: "Theme",
            keybind: "mod+shift+s",
            onSelect: () => cycleColorScheme(1),
        })

        for (const scheme of colorSchemeOrder) {
            commands.push({
                id: `theme.scheme.${scheme}`,
                title: `Use color scheme: ${colorSchemeLabel[scheme]}`,
                category: "Theme",
                onSelect: () => theme.commitPreview(),
                onHighlight: () => {
                    theme.previewColorScheme(scheme)
                    return () => theme.cancelPreview()
                },
            })
        }

        return commands
    })
}
