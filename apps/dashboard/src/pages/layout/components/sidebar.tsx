import { createSignal, Show, For, Switch, Match, JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { A } from "@solidjs/router"
import { DragDropProvider, DragDropSensors, DragOverlay, closestCenter } from "@thisbeyond/solid-dnd"
import { SortableProvider } from "@thisbeyond/solid-dnd"
import { Button } from "@atomcli/ui/button"
import { Icon } from "@atomcli/ui/icon"
import { Tooltip, TooltipKeybind } from "@atomcli/ui/tooltip"
import { Mark } from "@atomcli/ui/logo"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useProviders } from "@/hooks/use-providers"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { ProjectItem } from "./project-item"
import { ProjectDragOverlay } from "./project-components"
import { Session } from "@atomcli/sdk/v2/client"

type LayoutActions = {
    connectProvider: () => void
    openServer: () => void
    chooseProject: () => Promise<void>
    archiveSession: (session: Session) => void
    navigateToProject: (dir: string) => void
    closeProject: (dir: string) => void
}

export const Sidebar = (props: {
    mobile?: boolean
    actions: LayoutActions
    prefetchSession: (session: Session, priority?: "high" | "low") => void
    containerRef?: (el: HTMLDivElement) => void
}): JSX.Element => {
    const layout = useLayout()
    const command = useCommand()
    const providers = useProviders()
    const [activeDraggable, setActiveDraggable] = createSignal<string | undefined>(undefined)
    const [localExpanded, setLocalExpanded] = createStore<Record<string, boolean>>({})

    const expanded = () => props.mobile || layout.sidebar.opened()

    const isProjectExpanded = (worktree: string, projectExpanded: boolean) => {
        return props.mobile ? (localExpanded[worktree] ?? true) : projectExpanded
    }

    const handleToggleExpand = (worktree: string, open: boolean) => {
        if (props.mobile) {
            setLocalExpanded(worktree, open)
        } else {
            if (open) layout.projects.expand(worktree)
            else layout.projects.collapse(worktree)
        }
    }

    function getDraggableId(event: unknown): string | undefined {
        if (typeof event !== "object" || event === null) return undefined
        if (!("draggable" in event)) return undefined
        const draggable = (event as { draggable?: { id?: unknown } }).draggable
        if (!draggable) return undefined
        return typeof draggable.id === "string" ? draggable.id : undefined
    }

    function handleDragStart(event: unknown) {
        const id = getDraggableId(event)
        if (!id) return
        setActiveDraggable(id)
    }

    function handleDragOver(event: any) {
        const { draggable, droppable } = event
        if (draggable && droppable) {
            const projects = layout.projects.list()
            const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
            const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
            if (fromIndex !== toIndex && toIndex !== -1) {
                layout.projects.move(draggable.id.toString(), toIndex)
            }
        }
    }

    function handleDragEnd() {
        setActiveDraggable(undefined)
    }

    return (
        <div class="flex flex-col self-stretch h-full items-center justify-between overflow-hidden min-h-0">
            <div class="flex flex-col items-start self-stretch gap-4 min-h-0">
                <Show when={!props.mobile}>
                    <div
                        classList={{
                            "border-b border-border-weak-base w-full h-12 ml-px flex items-center pl-1.75 shrink-0": true,
                            "justify-start": expanded(),
                        }}
                    >
                        <A href="/" class="shrink-0 h-8 flex items-center justify-start px-2 w-full" data-tauri-drag-region>
                            <Mark class="shrink-0" />
                        </A>
                    </div>
                </Show>
                <div class="flex flex-col items-start self-stretch gap-4 px-2 overflow-hidden min-h-0">
                    <Show when={!props.mobile}>
                        <TooltipKeybind
                            class="shrink-0"
                            placement="right"
                            title="Toggle sidebar"
                            keybind={command.keybind("sidebar.toggle")}
                            inactive={expanded()}
                        >
                            <Button
                                variant="ghost"
                                size="large"
                                class="group/sidebar-toggle shrink-0 w-full text-left justify-start rounded-lg px-2"
                                onClick={layout.sidebar.toggle}
                            >
                                <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                                    <Icon
                                        name={layout.sidebar.opened() ? "layout-left" : "layout-right"}
                                        size="small"
                                        class="group-hover/sidebar-toggle:hidden"
                                    />
                                    <Icon
                                        name={layout.sidebar.opened() ? "layout-left-partial" : "layout-right-partial"}
                                        size="small"
                                        class="hidden group-hover/sidebar-toggle:inline-block"
                                    />
                                    <Icon
                                        name={layout.sidebar.opened() ? "layout-left-full" : "layout-right-full"}
                                        size="small"
                                        class="hidden group-active/sidebar-toggle:inline-block"
                                    />
                                </div>
                                <Show when={layout.sidebar.opened()}>
                                    <div class="hidden group-hover/sidebar-toggle:block group-active/sidebar-toggle:block text-text-base">
                                        Toggle sidebar
                                    </div>
                                </Show>
                            </Button>
                        </TooltipKeybind>
                    </Show>
                    <DragDropProvider
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        collisionDetector={closestCenter}
                    >
                        <DragDropSensors />
                        <ConstrainDragXAxis />
                        <div
                            ref={props.containerRef}
                            class="w-full min-w-8 flex flex-col gap-2 min-h-0 overflow-y-auto no-scrollbar"
                        >
                            <SortableProvider ids={layout.projects.list().map((p) => p.worktree)}>
                                <For each={layout.projects.list()}>
                                    {(project) => (
                                        <ProjectItem
                                            project={project}
                                            mobile={props.mobile}
                                            sidebarOpened={!!layout.sidebar.opened()}
                                            isExpanded={isProjectExpanded(project.worktree, project.expanded)}
                                            onToggleExpand={(open) => handleToggleExpand(project.worktree, open)}
                                            prefetchSession={props.prefetchSession}
                                            archiveSession={props.actions.archiveSession}
                                            closeProject={props.actions.closeProject}
                                            navigateToProject={props.actions.navigateToProject}
                                        />
                                    )}
                                </For>
                            </SortableProvider>
                        </div>
                        <DragOverlay>
                            <ProjectDragOverlay activeDraggable={activeDraggable()} navigateToProject={props.actions.navigateToProject} />
                        </DragOverlay>
                    </DragDropProvider>
                </div>
            </div>
            <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
                <Switch>
                    <Match when={providers.all().length > 0 && !providers.paid().length && expanded()}>
                        <div class="rounded-md bg-background-stronger shadow-xs-border-base">
                            <div class="p-3 flex flex-col gap-2">
                                <div class="text-12-medium text-text-strong">Getting started</div>
                                <div class="text-text-base">AtomCLI includes free models so you can start immediately.</div>
                                <div class="text-text-base">Connect any provider to use models, inc. Claude, GPT, Gemini etc.</div>
                            </div>
                            <Tooltip placement="right" value="Connect provider" inactive={expanded()}>
                                <Button
                                    class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-lg rounded-t-none shadow-none border-t border-border-weak-base pl-2.25 pb-px"
                                    size="large"
                                    icon="plus"
                                    onClick={props.actions.connectProvider}
                                >
                                    Connect provider
                                </Button>
                            </Tooltip>
                        </div>
                    </Match>
                    <Match when={providers.all().length > 0}>
                        <Tooltip placement="right" value="Connect provider" inactive={expanded()}>
                            <Button
                                class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                                variant="ghost"
                                size="large"
                                icon="plus"
                                onClick={props.actions.connectProvider}
                            >
                                <Show when={expanded()}>Connect provider</Show>
                            </Button>
                        </Tooltip>
                    </Match>
                </Switch>
                <Tooltip
                    placement="right"
                    value={
                        <div class="flex items-center gap-2">
                            <span>Open project</span>
                            <Show when={!props.mobile}>
                                <span class="text-icon-base text-12-medium">{command.keybind("project.open")}</span>
                            </Show>
                        </div>
                    }
                    inactive={expanded()}
                >
                    <Button
                        class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                        variant="ghost"
                        size="large"
                        icon="folder-add-left"
                        onClick={props.actions.chooseProject}
                    >
                        <Show when={expanded()}>Open project</Show>
                    </Button>
                </Tooltip>
                <Tooltip placement="right" value="Share feedback" inactive={expanded()}>
                    <Button
                        as={"a"}
                        href="https://atomcli.ai/desktop-feedback"
                        target="_blank"
                        class="flex w-full text-left justify-start text-text-base stroke-[1.5px] rounded-lg px-2"
                        variant="ghost"
                        size="large"
                        icon="bubble-5"
                    >
                        <Show when={expanded()}>Share feedback</Show>
                    </Button>
                </Tooltip>
            </div>
        </div>
    )
}
