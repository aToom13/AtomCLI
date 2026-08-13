import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, Index, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/util/keybind"
import { Locale } from "@/util/util/locale"
import { Focusable } from "../context/spatial"

export interface DialogSelectProps<T> {
  title: string
  description?: JSX.Element
  placeholder?: string
  emptyMessage?: string
  options: DialogSelectOption<T>[]
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  keybind?: {
    keybind: Keybind.Info
    title: string
    disabled?: boolean
    onTrigger: (option: DialogSelectOption<T>) => void
  }[]
  current?: T
  details?: (option?: DialogSelectOption<T>) => JSX.Element
}

export interface DialogSelectOption<T = any> {
  title: string
  value: T
  description?: string
  keywords?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
  onSelect?: (ctx: DialogContext, trigger?: "prompt") => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
}

export namespace DialogSelectLayout {
  export function listHeight(contentRows: number, terminalHeight: number) {
    return Math.max(1, Math.min(contentRows, Math.floor(terminalHeight / 2) - 6))
  }

  export function visibleScrollTop(input: {
    scrollTop: number
    viewportTop: number
    viewportHeight: number
    targetTop: number
    targetHeight: number
  }) {
    const viewportBottom = input.viewportTop + input.viewportHeight
    // Culled rows can report zero height until their first visible render.
    // Every select option occupies at least one terminal row.
    const targetBottom = input.targetTop + Math.max(1, input.targetHeight)
    if (input.targetTop < input.viewportTop) {
      return Math.max(0, input.scrollTop - (input.viewportTop - input.targetTop))
    }
    if (targetBottom > viewportBottom) {
      return input.scrollTop + (targetBottom - viewportBottom)
    }
    return input.scrollTop
  }
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  })

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setStore("selected", currentIndex)
          }
        }
      },
    ),
  )

  let input: InputRenderable

  const filtered = createMemo(() => {
    if (props.skipFilter) {
      return props.options.filter((x) => x.disabled !== true)
    }
    const needle = store.filter.toLowerCase()
    const result = pipe(
      props.options,
      filter((x) => x.disabled !== true),
      (x) =>
        !needle
          ? x
          : fuzzysort.go(needle, x, { keys: ["title", "category", "description", "keywords"] }).map((x) => x.obj),
    )
    return result
  })

  const grouped = createMemo(() => {
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
    )
    return result
  })

  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options),
    )
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() =>
    DialogSelectLayout.listHeight(flat().length + grouped().length * 2 - 1, dimensions().height),
  )

  const selected = createMemo(() => flat()[store.selected])

  createEffect(() => {
    const options = flat()
    if (options.length === 0) {
      if (store.selected !== 0) setStore("selected", 0)
      return
    }
    if (store.selected >= options.length) setStore("selected", options.length - 1)
  })

  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      if (filter.length > 0) {
        setStore("selected", 0)
      } else if (current) {
        const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
        if (currentIndex >= 0) {
          setStore("selected", currentIndex)
        }
      }
      scroll?.scrollTo(0)
    }),
  )

  function move(direction: number) {
    if (flat().length === 0) return
    let next = store.selected + direction
    if (next < 0) next = flat().length - 1
    if (next >= flat().length) next = 0
    moveTo(next)
  }

  // Recursively search the renderable tree for an element matching the given id.
  // scroll.getChildren() only returns shallow (direct) children, but the option
  // box with id=JSON.stringify(value) is nested one level deeper inside the
  // Focusable wrapper box. This deep search finds it regardless of nesting.
  function findByIdDeep(
    children: ReturnType<typeof scroll.getChildren>,
    id: string,
  ): ReturnType<typeof scroll.getChildren>[number] | undefined {
    for (const child of children) {
      if (child.id === id) return child
      const nested = (child as any).getChildren?.()
      if (nested?.length) {
        const found = findByIdDeep(nested, id)
        if (found) return found
      }
    }
    return undefined
  }

  function keepSelectedVisible() {
    if (!scroll || scroll.isDestroyed) return
    const target = findByIdDeep(scroll.getChildren(), JSON.stringify(selected()?.value))
    if (!target || target.isDestroyed) return
    const nextScrollTop = DialogSelectLayout.visibleScrollTop({
      scrollTop: scroll.scrollTop,
      viewportTop: scroll.viewport.y,
      viewportHeight: scroll.viewport.height,
      targetTop: target.y,
      targetHeight: Math.max(1, target.height),
    })
    if (nextScrollTop === scroll.scrollTop) return
    scroll.scrollTo(nextScrollTop)
    scroll.requestRender()
  }

  function moveTo(next: number) {
    setStore("selected", next)
    props.onMove?.(selected()!)
  }

  createEffect(
    on(
      () => JSON.stringify(selected()?.value ?? null),
      () => {
        // Row coordinates settle on the next layout pass, especially when
        // crossing a category heading or restoring the current model.
        setTimeout(keepSelectedVisible, 0)
      },
    ),
  )

  const keybind = useKeybind()
  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      move(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      move(1)
    }
    if (evt.name === "pageup") {
      evt.preventDefault()
      move(-10)
    }
    if (evt.name === "pagedown") {
      evt.preventDefault()
      move(10)
    }
    if (evt.name === "return") {
      const option = selected()
      if (option) {
        // evt.preventDefault()
        if (option.onSelect) option.onSelect(dialog)
        props.onSelect?.(option)
      }
    }

    for (const item of props.keybind ?? []) {
      if (item.disabled) continue
      if (Keybind.match(item.keybind, keybind.parse(evt))) {
        const s = selected()
        if (s) {
          evt.preventDefault()
          item.onTrigger(s)
        }
      }
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
  }
  props.ref?.(ref)

  const keybinds = createMemo(() => props.keybind?.filter((x) => !x.disabled) ?? [])

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <Show when={props.description}>
          <box paddingTop={1}>{props.description}</box>
        </Show>
        <box paddingTop={1} paddingBottom={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              input = r
              setTimeout(() => input.focus(), 1)
            }}
            placeholder={props.placeholder ?? "Search"}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>{props.emptyMessage ?? "No results found"}</text>
          </box>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={height()}
        >
          <Index each={grouped()}>
            {(item, index) => {
              const category = createMemo(() => item()[0])
              const options = createMemo(() => item()[1])
              return (
                <>
                  <Show when={category()}>
                    <box paddingTop={index > 0 ? 1 : 0} paddingLeft={3}>
                      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                        {category()}
                      </text>
                    </box>
                  </Show>
                  <Index each={options()}>
                    {(option) => {
                      const active = createMemo(() => isDeepEqual(option().value, selected()?.value))
                      const current = createMemo(() => isDeepEqual(option().value, props.current))
                      return (
                        <Focusable
                          id={`dialog-select-${JSON.stringify(option().value)}`}
                          onPress={() => {
                            option().onSelect?.(dialog)
                            props.onSelect?.(option())
                          }}
                        >
                          {(focused: () => boolean) => (
                            <box
                              id={JSON.stringify(option().value)}
                              flexDirection="row"
                              onMouseUp={() => {
                                option().onSelect?.(dialog)
                                props.onSelect?.(option())
                              }}
                              onMouseOver={() => {
                                const index = flat().findIndex((x) => isDeepEqual(x.value, option().value))
                                if (index === -1) return
                                moveTo(index)
                              }}
                              backgroundColor={
                                active() || focused() ? (option().bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)
                              }
                              paddingLeft={current() || option().gutter ? 1 : 3}
                              paddingRight={3}
                              gap={1}
                            >
                              <Option
                                title={option().title}
                                footer={option().footer}
                                description={option().description !== category() ? option().description : undefined}
                                active={active() || focused()}
                                current={current()}
                                gutter={option().gutter}
                              />
                            </box>
                          )}
                        </Focusable>
                      )
                    }}
                  </Index>
                </>
              )
            }}
          </Index>
        </scrollbox>
      </Show>
      <Show when={props.details}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          {props.details?.(selected())}
        </box>
      </Show>
      <Show when={keybinds().length} fallback={<box flexShrink={0} />}>
        <box paddingRight={2} paddingLeft={4} flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0} paddingTop={1}>
          <For each={keybinds()}>
            {(item) => (
              <text>
                <span style={{ fg: theme.text }}>
                  <b>{item.title}</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{Keybind.toString(item.keybind)}</span>
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? fg : props.current ? theme.primary : theme.text} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 61)}
        <Show when={props.description}>
          <span style={{ fg: props.active ? fg : theme.textMuted }}> {props.description}</span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? fg : theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
