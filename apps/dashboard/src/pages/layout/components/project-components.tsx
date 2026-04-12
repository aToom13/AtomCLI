import { createMemo, Show, JSX } from "solid-js"
import { Avatar } from "@atomcli/ui/avatar"
import { Icon } from "@atomcli/ui/icon"
import { getAvatarColors, LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { getFilename } from "@atomcli/util/path"
import { Switch, Match } from "solid-js"
import { Button } from "@atomcli/ui/button"
import { base64Decode } from "@atomcli/util/encode"
import { useParams } from "@solidjs/router"

export const ProjectAvatar = (props: {
    project: LocalProject
    class?: string
    expandable?: boolean
    notify?: boolean
}): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const mask = "radial-gradient(circle 5px at calc(100% - 2px) 2px, transparent 5px, black 5.5px)"
    const atomcli = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

    return (
        <div class="relative size-5 shrink-0 rounded-sm">
            <Avatar
                fallback={name()}
                src={props.project.id === atomcli ? "https://atomcli.ai/favicon.svg" : props.project.icon?.url}
                {...getAvatarColors(props.project.icon?.color)}
                class={`size-full ${props.class ?? ""}`}
                style={
                    notifications().length > 0 && props.notify ? { "-webkit-mask-image": mask, "mask-image": mask } : undefined
                }
            />
            <Show when={props.expandable}>
                <Icon
                    name="chevron-right"
                    size="normal"
                    class="hidden size-full items-center justify-center text-text-subtle group-hover/session:flex group-data-[expanded]/trigger:rotate-90 transition-transform duration-50"
                />
            </Show>
            <Show when={notifications().length > 0 && props.notify}>
                <div
                    classList={{
                        "absolute -top-0.5 -right-0.5 size-1.5 rounded-full": true,
                        "bg-icon-critical-base": hasError(),
                        "bg-text-interactive-base": !hasError(),
                    }}
                />
            </Show>
        </div>
    )
}

export const ProjectVisual = (props: { project: LocalProject; class?: string; navigateToProject: (dir: string) => void }): JSX.Element => {
    const layout = useLayout()
    const params = useParams()
    const name = createMemo(() => props.project.name || getFilename(props.project.worktree))
    const current = createMemo(() => base64Decode(params.dir ?? ""))
    return (
        <Switch>
            <Match when={layout.sidebar.opened()}>
                <Button
                    as={"div"}
                    variant="ghost"
                    data-active
                    class="flex items-center justify-between gap-3 w-full px-1 self-stretch h-8 border-none rounded-lg"
                >
                    <div class="flex items-center gap-3 p-0 text-left min-w-0 grow">
                        <ProjectAvatar project={props.project} />
                        <span class="truncate text-14-medium text-text-strong">{name()}</span>
                    </div>
                </Button>
            </Match>
            <Match when={true}>
                <Button
                    variant="ghost"
                    size="large"
                    class="flex items-center justify-center p-0 aspect-square border-none rounded-lg"
                    data-selected={props.project.worktree === current()}
                    onClick={() => props.navigateToProject(props.project.worktree)}
                >
                    <ProjectAvatar project={props.project} notify />
                </Button>
            </Match>
        </Switch>
    )
}

export const ProjectDragOverlay = (props: { activeDraggable: string | undefined, navigateToProject: (dir: string) => void }): JSX.Element => {
    const layout = useLayout()
    const project = createMemo(() => layout.projects.list().find((p) => p.worktree === props.activeDraggable))
    return (
        <Show when={project()}>
            {(p) => (
                <div class="bg-background-base rounded-md">
                    <ProjectVisual project={p()} navigateToProject={props.navigateToProject} />
                </div>
            )}
        </Show>
    )
}
