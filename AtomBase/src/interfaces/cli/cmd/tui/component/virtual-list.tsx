import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js"
import type { ScrollBoxRenderable, BoxRenderable } from "@opentui/core"

interface VirtualListProps<T> {
    data: T[]
    scrollRef: () => ScrollBoxRenderable | undefined
    renderItem: (item: T, index: () => number) => any
    itemHeight?: number | ((item: T) => number)
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
    const [heightsTick, setHeightsTick] = createSignal(0)
    const heightsCache = new Map<number, number>()
    const visibleRefs = new Map<number, BoxRenderable>()
    let prevDataLength = 0

    // Poll the scroll container periodically because TUI lacks traditional DOM scroll events
    onMount(() => {
        const timer = setInterval(() => {
            const scroll = props.scrollRef()
            if (scroll) {
                if (scrollTop() !== scroll.scrollTop) setScrollTop(Math.max(0, scroll.scrollTop))
                if (viewportHeight() !== scroll.height) setViewportHeight(Math.max(10, scroll.height))
            }

            // Invalidate height cache when data length changes (new messages shift indices)
            const currentLength = props.data.length
            if (currentLength !== prevDataLength) {
                heightsCache.clear()
                prevDataLength = currentLength
            }

            let heightsChanged = false
            for (const [index, ref] of visibleRefs.entries()) {
                if (ref) {
                    const h = ref.height
                    if (h > 0 && heightsCache.get(index) !== h) {
                        heightsCache.set(index, h)
                        heightsChanged = true
                    }
                }
            }
            if (heightsChanged) setHeightsTick(t => t + 1)
        }, 50)
        onCleanup(() => clearInterval(timer))
    })

    const itemHeightProp = props.itemHeight || props.estimatedItemHeight || 6
    const getItemHeight = (item: T) => typeof itemHeightProp === 'function' ? itemHeightProp(item) : itemHeightProp
    const buffer = props.buffer || 15

    const prefixHeights = createMemo(() => {
        heightsTick() // establish reactivity
        const p = [0]
        let sum = 0
        const total = props.data.length
        for (let i = 0; i < total; i++) {
            const item = props.data[i]
            const computedHeight = getItemHeight(item)
            const cachedHeight = heightsCache.get(i)
            // Use cached actual height if available, otherwise fallback to computed
            sum += cachedHeight !== undefined ? cachedHeight : computedHeight
            p.push(sum)
        }
        return p
    })

    const range = createMemo(() => {
        const Math_max = Math.max, Math_min = Math.min
        const st = Math_max(0, scrollTop())
        const vh = Math_max(10, viewportHeight())
        const total = props.data.length

        if (total === 0) {
            return { start: 0, end: -1, total }
        }

        if (total < 30) {
            return { start: 0, end: total - 1, total }
        }

        const p = prefixHeights()
        const totalHeight = p[total] || 0

        // SAFETY: If scrollTop exceeds estimated total height, show the last items
        // This prevents the black screen when height estimates are too low
        if (totalHeight > 0 && st >= totalHeight) {
            const start = Math_max(0, total - buffer)
            return { start, end: total - 1, total }
        }

        let startIndex = 0
        while (startIndex < total && p[startIndex + 1] <= st) {
            startIndex++
        }

        let endIndex = startIndex
        while (endIndex < total && p[endIndex] < st + vh) {
            endIndex++
        }

        // SAFETY: If no items found visible, always show at least the last buffer items
        if (startIndex >= total) {
            startIndex = Math_max(0, total - buffer)
            endIndex = total
        }

        startIndex = Math_max(0, startIndex - buffer)
        endIndex = Math_min(total - 1, endIndex + buffer)

        return { start: startIndex, end: endIndex, total }
    })

    const paddingTop = createMemo(() => prefixHeights()[range().start] || 0)
    const paddingBottom = createMemo(() => {
        const p = prefixHeights()
        const end = Math.min(range().end + 1, props.data.length)
        return Math.max(0, (p[props.data.length] || 0) - (p[end] || 0))
    })

    return (
        <box flexDirection="column" width="100%" flexShrink={0}>
            <Show when={paddingTop() > 0}>
                <box height={paddingTop()} />
            </Show>

            <For each={props.data.slice(range().start, range().end + 1)}>
                {(item, sliceIndex) => {
                    const idx = () => range().start + sliceIndex()
                    return (
                        <box
                            flexDirection="column"
                            ref={(el: BoxRenderable) => {
                                const currentIdx = idx()
                                visibleRefs.set(currentIdx, el)
                                onCleanup(() => {
                                    // Only delete if this ref still owns the index
                                    if (visibleRefs.get(currentIdx) === el) {
                                        visibleRefs.delete(currentIdx)
                                    }
                                })
                            }}
                        >
                            {props.renderItem(item, idx)}
                        </box>
                    )
                }}
            </For>

            <Show when={paddingBottom() > 0}>
                <box height={paddingBottom()} />
            </Show>
        </box>
    )
}
