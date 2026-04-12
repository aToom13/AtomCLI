import { Component, Show, Switch, Match } from "solid-js"
import { Icon } from "@atomcli/ui/icon"
import { Button } from "@atomcli/ui/button"
import { IconButton } from "@atomcli/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@atomcli/ui/tooltip"
import { Select } from "@atomcli/ui/select"
import { useCommand } from "@/context/command"
import { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@atomcli/ui/context/dialog"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { SessionContextUsage } from "@/components/session-context-usage"
import { Prompt } from "@/context/prompt"

interface PromptActionsProps {
    mode: "normal" | "shell"
    working: boolean
    promptDirty: boolean
    fileInputRef: HTMLInputElement | undefined
    onStop: () => void
    onSend: (e: MouseEvent | KeyboardEvent) => void // Assuming button click
    // Contexts could be used directly or passed. Using hooks inside is fine for global contexts.
    paramsId: string | undefined // from useParams
}

export const PromptActions: Component<PromptActionsProps> = (props) => {
    const command = useCommand()
    const local = useLocal()
    const providers = useProviders()
    const permission = usePermission()
    const sdk = useSDK()
    const dialog = useDialog()

    return (
        <div class="relative p-3 flex items-center justify-between">
            <div class="flex items-center justify-start gap-0.5">
                <Switch>
                    <Match when={props.mode === "shell"}>
                        <div class="flex items-center gap-2 px-2 h-6">
                            <Icon name="console" size="small" class="text-icon-primary" />
                            <span class="text-12-regular text-text-primary">Shell</span>
                            <span class="text-12-regular text-text-weak">esc to exit</span>
                        </div>
                    </Match>
                    <Match when={props.mode === "normal"}>
                        <TooltipKeybind placement="top" title="Cycle agent" keybind={command.keybind("agent.cycle")}>
                            <Select
                                options={local.agent.list().map((agent) => agent.name)}
                                current={local.agent.current()?.name ?? ""}
                                onSelect={local.agent.set}
                                class="capitalize"
                                variant="ghost"
                            />
                        </TooltipKeybind>
                        <Show
                            when={providers.paid().length > 0}
                            fallback={
                                <TooltipKeybind placement="top" title="Choose model" keybind={command.keybind("model.choose")}>
                                    <Button as="div" variant="ghost" onClick={() => dialog.show(() => <DialogSelectModelUnpaid />)}>
                                        {local.model.current()?.name ?? "Select model"}
                                        <Icon name="chevron-down" size="small" />
                                    </Button>
                                </TooltipKeybind>
                            }
                        >
                            <ModelSelectorPopover>
                                <TooltipKeybind placement="top" title="Choose model" keybind={command.keybind("model.choose")}>
                                    <Button as="div" variant="ghost">
                                        {local.model.current()?.name ?? "Select model"}
                                        <Icon name="chevron-down" size="small" />
                                    </Button>
                                </TooltipKeybind>
                            </ModelSelectorPopover>
                        </Show>
                        <Show when={local.model.variant.list().length > 0}>
                            <TooltipKeybind
                                placement="top"
                                title="Thinking effort"
                                keybind={command.keybind("model.variant.cycle")}
                            >
                                <Button
                                    variant="ghost"
                                    class="text-text-base _hidden group-hover/prompt-input:inline-block"
                                    onClick={() => local.model.variant.cycle()}
                                >
                                    <span class="capitalize text-12-regular">{local.model.variant.current() ?? "Default"}</span>
                                </Button>
                            </TooltipKeybind>
                        </Show>
                        <Show when={permission.permissionsEnabled() && props.paramsId}>
                            <TooltipKeybind
                                placement="top"
                                title="Auto-accept edits"
                                keybind={command.keybind("permissions.autoaccept")}
                            >
                                <Button
                                    variant="ghost"
                                    onClick={() => permission.toggleAutoAccept(props.paramsId!, sdk.directory)}
                                    classList={{
                                        "_hidden group-hover/prompt-input:flex size-6 items-center justify-center": true,
                                        "text-text-base": !permission.isAutoAccepting(props.paramsId!, sdk.directory),
                                        "hover:bg-surface-success-base": permission.isAutoAccepting(props.paramsId!, sdk.directory),
                                    }}
                                >
                                    <Icon
                                        name="chevron-double-right"
                                        size="small"
                                        classList={{ "text-icon-success-base": permission.isAutoAccepting(props.paramsId!, sdk.directory) }}
                                    />
                                </Button>
                            </TooltipKeybind>
                        </Show>
                    </Match>
                </Switch>
            </div>
            <div class="flex items-center gap-3 absolute right-2 bottom-2">
                {/* File input is managed by parent or passed ref? Parent holds ref. */}
                {/* We just trigger the ref click */}
                <div class="flex items-center gap-2">
                    <SessionContextUsage />
                    <Show when={props.mode === "normal"}>
                        <Tooltip placement="top" value="Attach file">
                            <Button type="button" variant="ghost" class="size-6" onClick={() => props.fileInputRef?.click()}>
                                <Icon name="photo" class="size-4.5" />
                            </Button>
                        </Tooltip>
                    </Show>
                </div>
                <Tooltip
                    placement="top"
                    inactive={!props.promptDirty && !props.working}
                    value={
                        <Switch>
                            <Match when={props.working}>
                                <div class="flex items-center gap-2">
                                    <span>Stop</span>
                                    <span class="text-icon-base text-12-medium text-[10px]!">ESC</span>
                                </div>
                            </Match>
                            <Match when={true}>
                                <div class="flex items-center gap-2">
                                    <span>Send</span>
                                    <Icon name="enter" size="small" class="text-icon-base" />
                                </div>
                            </Match>
                        </Switch>
                    }
                >
                    <IconButton
                        type="submit" // Rely on form submission? Or explicit click?
                        // The original code was inside a form with onSubmit={handleSubmit}
                        // If this is inside the form, type="submit" works.
                        disabled={!props.promptDirty && !props.working}
                        icon={props.working ? "stop" : "arrow-up"}
                        variant="primary"
                        class="h-6 w-4.5"
                        onClick={(e) => {
                            if (props.working) {
                                props.onStop()
                                e.preventDefault()
                            }
                            // If not working, let type="submit" handle it via form
                        }}
                    />
                </Tooltip>
            </div>
        </div>
    )
}
