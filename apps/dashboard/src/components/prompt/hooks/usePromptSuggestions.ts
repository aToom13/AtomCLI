import { createMemo, createSignal } from "solid-js"
import { useFilteredList } from "@atomcli/ui/hooks"
import { useSync } from "@/context/sync"
import { useFile } from "@/context/file"
import { useCommand } from "@/context/command"

export type AtOption = { type: "agent"; name: string; display: string } | { type: "file"; path: string; display: string }

export interface SlashCommand {
    id: string
    trigger: string
    title: string
    description?: string
    keybind?: string
    type: "builtin" | "custom"
}

export function usePromptSuggestions(props: {
    onAtSelect: (option: AtOption | undefined) => void
    onSlashSelect: (cmd: SlashCommand | undefined) => void
}) {
    const sync = useSync()
    const files = useFile()
    const command = useCommand()

    // -- At Mentions --

    const agentList = createMemo(() =>
        sync.data.agent
            .filter((agent) => !agent.hidden && agent.mode !== "primary")
            .map((agent): AtOption => ({ type: "agent", name: agent.name, display: agent.name })),
    )

    const atKey = (x: AtOption | undefined) => {
        if (!x) return ""
        return x.type === "agent" ? `agent:${x.name}` : `file:${x.path}`
    }

    const at = useFilteredList<AtOption>({
        items: async (query) => {
            const agents = agentList()
            const paths = await files.searchFilesAndDirectories(query)
            const fileOptions: AtOption[] = paths.map((path) => ({ type: "file", path, display: path }))
            return [...agents, ...fileOptions]
        },
        key: atKey,
        filterKeys: ["display"],
        onSelect: props.onAtSelect,
    })

    // -- Slash Commands --

    const slashCommands = createMemo<SlashCommand[]>(() => {
        const builtin = command.options
            .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
            .map((opt) => ({
                id: opt.id,
                trigger: opt.slash!,
                title: opt.title,
                description: opt.description,
                keybind: opt.keybind,
                type: "builtin" as const,
            }))

        const custom = sync.data.command.map((cmd) => ({
            id: `custom.${cmd.name}`,
            trigger: cmd.name,
            title: cmd.name,
            description: cmd.description,
            type: "custom" as const,
        }))

        return [...custom, ...builtin]
    })

    const slash = useFilteredList<SlashCommand>({
        items: slashCommands,
        key: (x) => x?.id,
        filterKeys: ["trigger", "title", "description"],
        onSelect: props.onSlashSelect,
    })

    return {
        at,
        slash,
        atKey,
    }
}
