import { createMemo, Switch, Match, Show, JSX } from "solid-js"
import { A, useParams } from "@solidjs/router"
import { DateTime } from "luxon"
import { Tooltip, TooltipKeybind } from "@atomcli/ui/tooltip"
import { IconButton } from "@atomcli/ui/icon-button"
import { DiffChanges } from "@atomcli/ui/diff-changes"
import { Spinner } from "@atomcli/ui/spinner"
import { useNotification } from "@/context/notification"
import { useGlobalSync } from "@/context/global-sync"
import { useCommand } from "@/context/command"
import { Session } from "@atomcli/sdk/v2/client"
import { LocalProject } from "@/context/layout"

export const SessionItem = (props: {
    session: Session
    slug: string
    project: LocalProject
    mobile?: boolean
    prefetchSession: (session: Session, priority?: "high" | "low") => void
    archiveSession: (session: Session) => void
}): JSX.Element => {
    const notification = useNotification()
    const globalSync = useGlobalSync()
    const command = useCommand()
    const params = useParams()

    const updated = createMemo(() => DateTime.fromMillis(props.session.time.updated))
    const notifications = createMemo(() => notification.session.unseen(props.session.id))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const [sessionStore] = globalSync.child(props.session.directory)

    const hasPermissions = createMemo(() => {
        const permissions = sessionStore.permission?.[props.session.id] ?? []
        if (permissions.length > 0) return true
        const childSessions = sessionStore.session.filter((s) => s.parentID === props.session.id)
        for (const child of childSessions) {
            const childPermissions = sessionStore.permission?.[child.id] ?? []
            if (childPermissions.length > 0) return true
        }
        return false
    })

    const isWorking = createMemo(() => {
        if (props.session.id === params.id) return false
        if (hasPermissions()) return false
        const status = sessionStore.session_status[props.session.id]
        return status?.type === "busy" || status?.type === "retry"
    })

    return (
        <>
            <div
                data-session-id={props.session.id}
                class="group/session relative w-full rounded-md cursor-default transition-colors
               hover:bg-surface-raised-base-hover focus-within:bg-surface-raised-base-hover has-[.active]:bg-surface-raised-base-hover"
            >
                <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.session.title} gutter={10}>
                    <A
                        href={`${props.slug}/session/${props.session.id}`}
                        class="flex flex-col min-w-0 text-left w-full focus:outline-none pl-4 pr-2 py-1"
                        onMouseEnter={() => props.prefetchSession(props.session, "high")}
                        onFocus={() => props.prefetchSession(props.session, "high")}
                    >
                        <div class="flex items-center self-stretch gap-6 justify-between transition-[padding] group-hover/session:pr-7 group-focus-within/session:pr-7 group-active/session:pr-7">
                            <span
                                classList={{
                                    "text-14-regular text-text-strong overflow-hidden text-ellipsis truncate": true,
                                    "animate-pulse": isWorking(),
                                }}
                            >
                                {props.session.title}
                            </span>
                            <div class="shrink-0 group-hover/session:hidden group-active/session:hidden group-focus-within/session:hidden">
                                <Switch>
                                    <Match when={isWorking()}>
                                        <Spinner class="size-2.5 mr-0.5" />
                                    </Match>
                                    <Match when={hasPermissions()}>
                                        <div class="size-1.5 mr-1.5 rounded-full bg-surface-warning-strong" />
                                    </Match>
                                    <Match when={hasError()}>
                                        <div class="size-1.5 mr-1.5 rounded-full bg-text-diff-delete-base" />
                                    </Match>
                                    <Match when={notifications().length > 0}>
                                        <div class="size-1.5 mr-1.5 rounded-full bg-text-interactive-base" />
                                    </Match>
                                    <Match when={true}>
                                        <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                                            {Math.abs(updated().diffNow().as("seconds")) < 60
                                                ? "Now"
                                                : updated()
                                                    .toRelative({
                                                        style: "short",
                                                        unit: ["days", "hours", "minutes"],
                                                    })
                                                    ?.replace(" ago", "")
                                                    ?.replace(/ days?/, "d")
                                                    ?.replace(" min.", "m")
                                                    ?.replace(" hr.", "h")}
                                        </span>
                                    </Match>
                                </Switch>
                            </div>
                        </div>
                        <Show when={props.session.summary?.files}>
                            <div class="flex justify-between items-center self-stretch">
                                <span class="text-12-regular text-text-weak">{`${props.session.summary?.files || "No"} file${props.session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                                <Show when={props.session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                            </div>
                        </Show>
                    </A>
                </Tooltip>
                <div class="hidden group-hover/session:flex group-active/session:flex group-focus-within/session:flex text-text-base gap-1 items-center absolute top-1 right-1">
                    <TooltipKeybind
                        placement={props.mobile ? "bottom" : "right"}
                        title="Archive session"
                        keybind={command.keybind("session.archive")}
                    >
                        <IconButton icon="archive" variant="ghost" onClick={() => props.archiveSession(props.session)} />
                    </TooltipKeybind>
                </div>
            </div>
        </>
    )
}
