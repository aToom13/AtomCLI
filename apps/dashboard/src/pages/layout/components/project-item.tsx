import { createMemo, Match, Switch, Show, For, JSX } from "solid-js"
import { A, useParams } from "@solidjs/router"
import { createSortable } from "@thisbeyond/solid-dnd"
import { Button } from "@atomcli/ui/button"
import { Collapsible } from "@atomcli/ui/collapsible"
import { DropdownMenu } from "@atomcli/ui/dropdown-menu"
import { IconButton } from "@atomcli/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@atomcli/ui/tooltip"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { useCommand } from "@/context/command"
import { useDialog } from "@atomcli/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { LocalProject } from "@/context/layout"
import { getFilename } from "@atomcli/util/path"
import { base64Encode, base64Decode } from "@atomcli/util/encode"
import { Session } from "@atomcli/sdk/v2/client"
import { sortSessions } from "../utils"
import { ProjectAvatar, ProjectVisual } from "./project-components"
import { SessionItem } from "./session-item"

export const ProjectItem = (props: {
    project: LocalProject
    mobile?: boolean
    sidebarOpened: boolean
    isExpanded: boolean // Project specific expansion
    onToggleExpand: (open: boolean) => void
    prefetchSession: (session: Session, priority?: "high" | "low") => void
    archiveSession: (session: Session) => void
    closeProject: (dir: string) => void
    navigateToProject: (dir: string) => void
}): JSX.Element => {
    const sortable = createSortable(props.project.worktree)
    const dialog = useDialog()
    const command = useCommand()
    const globalSync = useGlobalSync()
    const params = useParams()

    const showExpanded = createMemo(() => props.mobile || props.sidebarOpened)
    const defaultWorktree = createMemo(() => base64Encode(props.project.worktree))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const [store, setProjectStore] = globalSync.child(props.project.worktree)

    const stores = createMemo(() =>
        [props.project.worktree, ...(props.project.sandboxes ?? [])].map((dir) => globalSync.child(dir)[0]),
    )
    const sessions = createMemo(() =>
        stores()
            .flatMap((store) => store.session.filter((session) => session.directory === store.path.directory))
            .toSorted(sortSessions),
    )
    const rootSessions = createMemo(() => sessions().filter((s) => !s.parentID))
    const hasMoreSessions = createMemo(() => store.session.length >= store.limit)

    const loadMoreSessions = async () => {
        setProjectStore("limit", (limit) => limit + 5)
        await globalSync.project.loadSessions(props.project.worktree)
    }

    const isActive = createMemo(() => {
        const current = params.dir ? base64Decode(params.dir) : ""
        return props.project.worktree === current || props.project.sandboxes?.includes(current)
    })

    return (
        // @ts-ignore
        <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
            <Switch>
                <Match when={showExpanded()}>
                    <Collapsible variant="ghost" open={props.isExpanded} class="gap-2 shrink-0" onOpenChange={props.onToggleExpand}>
                        <Button
                            as={"div"}
                            variant="ghost"
                            classList={{
                                "group/session flex items-center justify-between gap-3 w-full px-1.5 self-stretch h-auto border-none rounded-lg": true,
                                "bg-surface-raised-base-hover": isActive() && !props.isExpanded,
                            }}
                        >
                            <Collapsible.Trigger class="group/trigger flex items-center gap-3 p-0 text-left min-w-0 grow border-none">
                                <ProjectAvatar
                                    project={props.project}
                                    class="group-hover/session:hidden"
                                    expandable
                                    notify={!props.isExpanded}
                                />
                                <span class="truncate text-14-medium text-text-strong">{name()}</span>
                            </Collapsible.Trigger>
                            <div class="flex invisible gap-1 items-center group-hover/session:visible has-[[data-expanded]]:visible">
                                <DropdownMenu>
                                    <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
                                    <DropdownMenu.Portal>
                                        <DropdownMenu.Content>
                                            <DropdownMenu.Item
                                                onSelect={() => dialog.show(() => <DialogEditProject project={props.project} />)}
                                            >
                                                <DropdownMenu.ItemLabel>Edit project</DropdownMenu.ItemLabel>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item onSelect={() => props.closeProject(props.project.worktree)}>
                                                <DropdownMenu.ItemLabel>Close project</DropdownMenu.ItemLabel>
                                            </DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu>
                                <TooltipKeybind placement="top" title="New session" keybind={command.keybind("session.new")}>
                                    <IconButton as={A} href={`${defaultWorktree()}/session`} icon="plus-small" variant="ghost" />
                                </TooltipKeybind>
                            </div>
                        </Button>
                        <Collapsible.Content>
                            <nav class="hidden @[4rem]:flex w-full flex-col gap-1.5">
                                <For each={rootSessions()}>
                                    {(session) => (
                                        <SessionItem
                                            session={session}
                                            slug={base64Encode(session.directory)}
                                            project={props.project}
                                            mobile={props.mobile}
                                            prefetchSession={props.prefetchSession}
                                            archiveSession={props.archiveSession}
                                        />
                                    )}
                                </For>
                                <Show when={rootSessions().length === 0}>
                                    <div
                                        class="group/session relative w-full pl-4 pr-2 py-1 rounded-md cursor-default transition-colors
                             hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
                                    >
                                        <div class="flex items-center self-stretch w-full">
                                            <div class="flex-1 min-w-0">
                                                <Tooltip placement={props.mobile ? "bottom" : "right"} value="New session">
                                                    <A
                                                        href={`${defaultWorktree()}/session`}
                                                        class="flex flex-col gap-1 min-w-0 text-left w-full focus:outline-none"
                                                    >
                                                        <div class="flex items-center self-stretch gap-6 justify-between">
                                                            <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                                                                New session
                                                            </span>
                                                        </div>
                                                    </A>
                                                </Tooltip>
                                            </div>
                                        </div>
                                    </div>
                                </Show>
                                <Show when={hasMoreSessions()}>
                                    <div class="relative w-full py-1">
                                        <Button
                                            variant="ghost"
                                            class="flex w-full text-left justify-start text-12-medium opacity-50 px-3.5"
                                            size="large"
                                            onClick={loadMoreSessions}
                                        >
                                            Load more
                                        </Button>
                                    </div>
                                </Show>
                            </nav>
                        </Collapsible.Content>
                    </Collapsible>
                </Match>
                <Match when={true}>
                    <Tooltip placement="right" value={getFilename(props.project.worktree)}>
                        <ProjectVisual project={props.project} navigateToProject={props.navigateToProject} />
                    </Tooltip>
                </Match>
            </Switch>
        </div>
    )
}
