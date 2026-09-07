import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { For, createSignal, onMount, type JSX } from "solid-js"
import { Locale } from "@/util/util/locale"
import { Button } from "./button"
import { useKeyboard } from "@opentui/solid"
import { useSpatial } from "../context/spatial"

export namespace DialogConfirmSelection {
  export type Value = "cancel" | "confirm"

  export function move(current: Value, key: string): Value {
    if (["left", "up", "h", "k"].includes(key)) return "cancel"
    if (["right", "down", "l", "j"].includes(key)) return "confirm"
    return current
  }
}

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
}

export function DialogConfirmKeyboard(
  props: DialogConfirmProps & {
    onFocus: (value: DialogConfirmSelection.Value) => void
    children: (selected: () => DialogConfirmSelection.Value) => JSX.Element
  },
) {
  const [selected, setSelected] = createSignal<DialogConfirmSelection.Value>("cancel")

  onMount(() => props.onFocus("cancel"))

  useKeyboard((e) => {
    const next = DialogConfirmSelection.move(selected(), e.name)
    if (["left", "right", "up", "down", "h", "j", "k", "l"].includes(e.name)) {
      if (next !== selected()) {
        setSelected(next)
        props.onFocus(next)
      }
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.name === "return" || e.name === "enter") {
      if (selected() === "confirm") props.onConfirm?.()
      else props.onCancel?.()
      e.preventDefault()
      e.stopPropagation()
    }
  })

  return props.children(selected)
}

export function DialogConfirm(props: DialogConfirmProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const spatial = useSpatial()
  const ids = {
    cancel: `dialog-confirm-cancel`,
    confirm: `dialog-confirm-confirm`,
  }

  const choose = (value: DialogConfirmSelection.Value) => {
    if (value === "confirm") props.onConfirm?.()
    else props.onCancel?.()
    dialog.clear()
  }

  return (
    <DialogConfirmKeyboard
      {...props}
      onConfirm={() => choose("confirm")}
      onCancel={() => choose("cancel")}
      onFocus={(value) => spatial.focus(ids[value])}
    >
      {(selected) => (
        <box paddingLeft={2} paddingRight={2} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {props.title}
            </text>
            <text fg={theme.textMuted}>←/→ select · enter confirm · esc cancel</text>
          </box>
          <box paddingBottom={1}>
            <text fg={theme.textMuted}>{props.message}</text>
          </box>
          <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
            <For each={["cancel", "confirm"] as const}>
              {(key) => (
                <Button
                  id={ids[key]}
                  label={Locale.titlecase(key)}
                  variant={selected() === key ? "primary" : "secondary"}
                  onPress={() => choose(key)}
                />
              )}
            </For>
          </box>
        </box>
      )}
    </DialogConfirmKeyboard>
  )
}

DialogConfirm.show = (dialog: DialogContext, title: string, message: string) => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        />
      ),
      () => resolve(false),
    )
  })
}
