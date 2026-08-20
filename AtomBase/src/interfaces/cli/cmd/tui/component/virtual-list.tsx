import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import type { ScrollBoxRenderable, BoxRenderable } from "@opentui/core"

interface VirtualListProps<T> {
  data: T[]
  scrollRef: () => ScrollBoxRenderable | undefined
  renderItem: (item: T, index: () => number) => any
  itemKey?: (item: T, index: number) => string
  itemHeight?: number | ((item: T) => number)
  estimatedItemHeight?: number
  buffer?: number
  /** Invalidates measurements when wrapping/layout-affecting state changes. */
  measurementKey?: string | number
}

export namespace VirtualWindow {
  export interface Range {
    start: number
    end: number
    total: number
  }

  export function range(
    prefixHeights: number[],
    scrollTop: number,
    viewportHeight: number,
    total: number,
    overscan: number,
  ): Range {
    if (total === 0) return { start: 0, end: -1, total }
    if (total < 30) return { start: 0, end: total - 1, total }

    const st = Math.max(0, scrollTop)
    const vh = Math.max(1, viewportHeight)
    const buffer = Math.max(0, overscan)
    const totalHeight = prefixHeights[total] ?? 0

    // A stale/clamped ScrollBox offset must never produce an empty viewport.
    if (totalHeight <= 0 || st >= totalHeight) {
      const count = Math.max(1, buffer)
      return { start: Math.max(0, total - count), end: total - 1, total }
    }

    // Find the first item whose bottom edge is below the viewport top.
    let low = 0
    let high = total
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((prefixHeights[middle + 1] ?? totalHeight) <= st) low = middle + 1
      else high = middle
    }
    const firstVisible = Math.min(low, total - 1)

    // Find the first item starting at/after the viewport bottom.
    const bottom = st + vh
    low = firstVisible
    high = total
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((prefixHeights[middle] ?? totalHeight) < bottom) low = middle + 1
      else high = middle
    }

    return {
      start: Math.max(0, firstVisible - buffer),
      end: Math.min(total - 1, Math.max(firstVisible, low - 1) + buffer),
      total,
    }
  }

  /** Keep measurements for unchanged items; appends must not reset the whole list. */
  export function pruneMeasurements(cache: Map<string, number>, activeKeys: Iterable<string>) {
    const active = new Set(activeKeys)
    for (const key of cache.keys()) {
      if (!active.has(key)) cache.delete(key)
    }
  }
}

/**
 * A Virtual Scrolling / Windowing component specifically built for Terminal UIs.
 * It prevents extreme memory leakage and render lag by unmounting invisible items.
 */
export function VirtualList<T>(props: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(40)
  const [heightsTick, setHeightsTick] = createSignal(0)
  const heightsCache = new Map<string, number>()
  const visibleRefs = new Map<string, BoxRenderable>()
  let activeMeasurementKeys = new Map<string, string>()
  let previousData: T[] | undefined
  let previousMeasurementKey: string | number | undefined
  let measurementFrame = 0

  const stableKey = (item: T, index: number) => props.itemKey?.(item, index) ?? String(index)
  const measuredKey = (item: T, index: number) =>
    `${String(props.measurementKey ?? "default")}\u0000${stableKey(item, index)}`

  const windowed = createMemo(() => props.data.length >= 30)

  // Poll only while windowing is active because TUI lacks traditional DOM scroll events.
  createEffect(() => {
    if (!windowed()) return
    const timer = setInterval(() => {
      const data = props.data
      const scroll = props.scrollRef()
      if (scroll) {
        if (scrollTop() !== scroll.scrollTop) setScrollTop(Math.max(0, scroll.scrollTop))
        const height = scroll.viewport?.height ?? scroll.height
        if (viewportHeight() !== height) setViewportHeight(Math.max(1, height))
      }

      const layoutKey = props.measurementKey
      if (data !== previousData || layoutKey !== previousMeasurementKey) {
        activeMeasurementKeys = new Map(data.map((item, index) => [stableKey(item, index), measuredKey(item, index)]))
        // Remove measurements only for deleted/re-keyed rows. In particular,
        // appending a streaming message must preserve all earlier measurements.
        VirtualWindow.pruneMeasurements(heightsCache, activeMeasurementKeys.values())
        previousData = data
        previousMeasurementKey = layoutKey
      }

      // Scroll position needs responsive sampling for fluid windowing, while
      // layout measurement is intentionally throttled to avoid extra work.
      measurementFrame++
      if (measurementFrame % 2 === 0) {
        let heightsChanged = false
        for (const [stableItemKey, ref] of visibleRefs.entries()) {
          const key = activeMeasurementKeys.get(stableItemKey)
          if (ref && key) {
            const h = ref.height
            if (h > 0 && heightsCache.get(key) !== h) {
              heightsCache.set(key, h)
              heightsChanged = true
            }
          }
        }
        if (heightsChanged) setHeightsTick((t) => t + 1)
      }
    }, 32)
    onCleanup(() => clearInterval(timer))
  })

  const itemHeightProp = props.itemHeight || props.estimatedItemHeight || 6
  const getItemHeight = (item: T) =>
    Math.max(1, typeof itemHeightProp === "function" ? itemHeightProp(item) : itemHeightProp)
  const buffer = props.buffer ?? 15

  const prefixHeights = createMemo(() => {
    heightsTick() // establish reactivity
    const p = [0]
    let sum = 0
    const total = props.data.length
    for (let i = 0; i < total; i++) {
      const item = props.data[i]
      const computedHeight = getItemHeight(item)
      const cachedHeight = heightsCache.get(measuredKey(item, i))
      // Use cached actual height if available, otherwise fallback to computed
      sum += cachedHeight !== undefined ? cachedHeight : computedHeight
      p.push(sum)
    }
    return p
  })

  const range = createMemo(() => {
    const total = props.data.length
    return VirtualWindow.range(prefixHeights(), scrollTop(), viewportHeight(), total, buffer)
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
          const key = () => stableKey(item, idx())
          return (
            <box
              flexDirection="column"
              ref={(el: BoxRenderable) => {
                const currentKey = key()
                visibleRefs.set(currentKey, el)
                onCleanup(() => {
                  // Only delete if this ref still owns the stable item key.
                  if (visibleRefs.get(currentKey) === el) {
                    visibleRefs.delete(currentKey)
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
