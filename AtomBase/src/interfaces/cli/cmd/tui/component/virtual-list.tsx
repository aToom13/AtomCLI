import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"

interface VirtualListProps<T> {
    data: T[]
    scrollRef: () => ScrollBoxRenderable | undefined
    renderItem: (item: T, index: () => number) => any
    estimatedItemHeight?: number
    buffer?: number
}

/**
 * A Virtual Scrolling / Windowing component specifically built for Terminal UIs.
 * It prevents extreme memory leakage and render lag by unmounting invisible items.
 */
export function VirtualList<T>(props: VirtualListProps<T>) {
    const [scrollTop, setScrollTop] = createSignal(0)
    const [viewportHeight, setViewportHeight] = createSignal(40)

    // Poll the scroll container periodically because TUI lacks traditional DOM scroll events
    onMount(() => {
        const timer = setInterval(() => {
            const scroll = props.scrollRef()
            if (scroll) {
                if (scrollTop() !== scroll.y) setScrollTop(Math.max(0, scroll.y))
                if (viewportHeight() !== scroll.height) setViewportHeight(Math.max(10, scroll.height))
            }
        }, 50)
        onCleanup(() => clearInterval(timer))
    })

    const estimatedHeight = props.estimatedItemHeight || 6
    const buffer = props.buffer || 15

    const range = createMemo(() => {
        const st = scrollTop()
        const vh = viewportHeight()
        const total = props.data.length

        // If there aren't many items, just render all of them to save CPU cycles mapping heights
        if (total < 30) {
            return { start: 0, end: total - 1, total }
        }

        let startIndex = Math.floor(st / estimatedHeight) - buffer
        let endIndex = Math.ceil((st + vh) / estimatedHeight) + buffer

        if (startIndex < 0) startIndex = 0
        if (endIndex > total - 1) endIndex = total - 1

        return { start: startIndex, end: endIndex, total }
    })

    const paddingTop = createMemo(() => range().start * estimatedHeight)
    const paddingBottom = createMemo(() => Math.max(0, range().total - range().end - 1) * estimatedHeight)

    return (
        <box flexDirection="column" width="100%">
            <Show when={paddingTop() > 0}>
                <box height={paddingTop()} />
            </Show>

            <For each={props.data.slice(range().start, range().end + 1)}>
                {(item, index) => props.renderItem(item, () => range().start + index())}
            </For>

            <Show when={paddingBottom() > 0}>
                <box height={paddingBottom()} />
            </Show>
        </box>
    )
}
