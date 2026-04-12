import { createEffect, on, onCleanup } from "solid-js"
import { SessionReview } from "@atomcli/ui/session-review"
import type { FileDiff } from "@atomcli/sdk/v2/client"
import { useLayout } from "@/context/layout"

export type DiffStyle = "unified" | "split"

export interface SessionReviewTabProps {
    diffs: () => FileDiff[]
    view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    onViewFile?: (file: string) => void
    classes?: {
        root?: string
        header?: string
        container?: string
    }
}

export function SessionReviewTab(props: SessionReviewTabProps) {
    let scroll: HTMLDivElement | undefined
    let frame: number | undefined
    let pending: { x: number; y: number } | undefined

    const restoreScroll = (retries = 0) => {
        const el = scroll
        if (!el) return

        const s = props.view().scroll("review")
        if (!s) return

        // Wait for content to be scrollable - content may not have rendered yet
        if (el.scrollHeight <= el.clientHeight && retries < 10) {
            requestAnimationFrame(() => restoreScroll(retries + 1))
            return
        }

        if (el.scrollTop !== s.y) el.scrollTop = s.y
        if (el.scrollLeft !== s.x) el.scrollLeft = s.x
    }

    const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
        pending = {
            x: event.currentTarget.scrollLeft,
            y: event.currentTarget.scrollTop,
        }
        if (frame !== undefined) return

        frame = requestAnimationFrame(() => {
            frame = undefined

            const next = pending
            pending = undefined
            if (!next) return

            props.view().setScroll("review", next)
        })
    }

    createEffect(
        on(
            () => props.diffs().length,
            () => {
                requestAnimationFrame(restoreScroll)
            },
            { defer: true },
        ),
    )

    onCleanup(() => {
        if (frame === undefined) return
        cancelAnimationFrame(frame)
    })

    return (
        <SessionReview
            scrollRef={(el) => {
                scroll = el
                restoreScroll()
            }}
            onScroll={handleScroll}
            open={props.view().review.open()}
            onOpenChange={props.view().review.setOpen}
            classes={{
                root: props.classes?.root ?? "pb-40",
                header: props.classes?.header ?? "px-6",
                container: props.classes?.container ?? "px-6",
            }}
            diffs={props.diffs()}
            diffStyle={props.diffStyle}
            onDiffStyleChange={props.onDiffStyleChange}
            onViewFile={props.onViewFile}
        />
    )
}
