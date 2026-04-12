import { Component, For, Show, Switch, Match } from "solid-js"
import { AtOption, SlashCommand } from "./types"
import { FileIcon } from "@atomcli/ui/file-icon"
import { Icon } from "@atomcli/ui/icon"
import { getDirectory, getFilename } from "@atomcli/util/path"
import { useCommand } from "@/context/command"

interface PromptPopoverProps {
    popover: "at" | "slash" | null
    setPopoverRef: (el: HTMLDivElement) => void
    atList: AtOption[]
    atActive: string | undefined
    atKey: (item: AtOption) => string
    handleAtSelect: (item: AtOption) => void
    setAtActive: (key: string) => void
    slashList: SlashCommand[]
    slashActive: string | undefined
    handleSlashSelect: (cmd: SlashCommand) => void
    setSlashActive: (id: string) => void
}

export const PromptPopover: Component<PromptPopoverProps> = (props) => {
    const command = useCommand()

    return (
        <Show when={props.popover}>
            <div
                ref={(el) => props.setPopoverRef(el)}
                class="absolute inset-x-0 -top-3 -translate-y-full origin-bottom-left max-h-80 min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 rounded-md
                 border border-border-base bg-surface-raised-stronger-non-alpha shadow-md"
                onMouseDown={(e) => e.preventDefault()}
            >
                <Switch>
                    <Match when={props.popover === "at"}>
                        <Show
                            when={props.atList.length > 0}
                            fallback={<div class="text-text-weak px-2 py-1">No matching results</div>}
                        >
                            <For each={props.atList.slice(0, 10)}>
                                {(item) => (
                                    <button
                                        classList={{
                                            "w-full flex items-center gap-x-2 rounded-md px-2 py-0.5": true,
                                            "bg-surface-raised-base-hover": props.atActive === props.atKey(item),
                                        }}
                                        onClick={() => props.handleAtSelect(item)}
                                        onMouseEnter={() => props.setAtActive(props.atKey(item))}
                                    >
                                        <Show
                                            when={item.type === "agent"}
                                            fallback={
                                                <>
                                                    <FileIcon
                                                        node={{ path: (item as { type: "file"; path: string }).path, type: "file" }}
                                                        class="shrink-0 size-4"
                                                    />
                                                    <div class="flex items-center text-14-regular min-w-0">
                                                        <span class="text-text-weak whitespace-nowrap truncate min-w-0">
                                                            {getDirectory((item as { type: "file"; path: string }).path)}
                                                        </span>
                                                        <Show when={!(item as { type: "file"; path: string }).path.endsWith("/")}>
                                                            <span class="text-text-strong whitespace-nowrap">
                                                                {getFilename((item as { type: "file"; path: string }).path)}
                                                            </span>
                                                        </Show>
                                                    </div>
                                                </>
                                            }
                                        >
                                            <Icon name="brain" size="small" class="text-icon-info-active shrink-0" />
                                            <span class="text-14-regular text-text-strong whitespace-nowrap">
                                                @{(item as { type: "agent"; name: string }).name}
                                            </span>
                                        </Show>
                                    </button>
                                )}
                            </For>
                        </Show>
                    </Match>
                    <Match when={props.popover === "slash"}>
                        <Show
                            when={props.slashList.length > 0}
                            fallback={<div class="text-text-weak px-2 py-1">No matching commands</div>}
                        >
                            <For each={props.slashList}>
                                {(cmd) => (
                                    <button
                                        data-slash-id={cmd.id}
                                        classList={{
                                            "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                                            "bg-surface-raised-base-hover": props.slashActive === cmd.id,
                                        }}
                                        onClick={() => props.handleSlashSelect(cmd)}
                                        onMouseEnter={() => props.setSlashActive(cmd.id)}
                                    >
                                        <div class="flex items-center gap-2 min-w-0">
                                            <span class="text-14-regular text-text-strong whitespace-nowrap">/{cmd.trigger}</span>
                                            <Show when={cmd.description}>
                                                <span class="text-14-regular text-text-weak truncate">{cmd.description}</span>
                                            </Show>
                                        </div>
                                        <div class="flex items-center gap-2 shrink-0">
                                            <Show when={cmd.type === "custom"}>
                                                <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                                                    custom
                                                </span>
                                            </Show>
                                            <Show when={command.keybind(cmd.id)}>
                                                <span class="text-12-regular text-text-subtle">{command.keybind(cmd.id)}</span>
                                            </Show>
                                        </div>
                                    </button>
                                )}
                            </For>
                        </Show>
                    </Match>
                </Switch>
            </div>
        </Show>
    )
}
