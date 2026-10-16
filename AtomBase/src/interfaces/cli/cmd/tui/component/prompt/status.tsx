import { createMemo, createSignal, onCleanup, onMount, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useDialog } from "@tui/ui/dialog"
import { useKV } from "../../context/kv"
import { DialogAlert } from "../../ui/dialog-alert"
import { createColors, createFrames } from "../../ui/spinner.ts"

export function PromptStatus(props: {
  status: () => { type: string }
  verticalMode: () => string
  promptWidth: () => number
  interrupt: () => number
  mode: () => "normal" | "shell"
}) {
  const status = props.status
  const verticalMode = props.verticalMode
  const promptWidth = props.promptWidth
  const keybind = useKeybind()
  const local = useLocal()
  const { theme } = useTheme()
  const dialog = useDialog()
  const kv = useKV()
  const spinnerDef = createMemo(() => {
    const color = local.agent.color(local.agent.current().name)
    return {
      frames: createFrames({ color, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
      color: createColors({ color, style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
    }
  })
  return (
    <>
      <Show when={status().type !== "idle" || verticalMode() === "normal"}>
        <box flexDirection="row" justifyContent="space-between">
          <Show when={status().type !== "idle"} fallback={<text />}>
            <box
              flexDirection="row"
              gap={1}
              flexGrow={1}
              justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
            >
              <box flexShrink={0} flexDirection="row" gap={1}>
                <box marginLeft={1}>
                  <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                    <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                  </Show>
                </box>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  {(() => {
                    const retry = createMemo(
                      (): { type: "retry"; attempt: number; message: string; next: number } | undefined => {
                        const s = status()
                        if (s.type !== "retry") return
                        return s as any
                      },
                    )
                    const message = createMemo(() => {
                      const r = retry()
                      if (!r) return
                      if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                        return "gemini is way too hot right now"
                      if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                      return r.message
                    })
                    const isTruncated = createMemo(() => {
                      const r = retry()
                      if (!r) return false
                      return r.message.length > 120
                    })
                    const [seconds, setSeconds] = createSignal(0)
                    onMount(() => {
                      const timer = setInterval(() => {
                        const next = retry()?.next
                        if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                      }, 1000)

                      onCleanup(() => {
                        clearInterval(timer)
                      })
                    })
                    const handleMessageClick = () => {
                      const r = retry()
                      if (!r) return
                      if (isTruncated()) {
                        DialogAlert.show(dialog, "Retry Error", r.message)
                      }
                    }

                    const retryText = () => {
                      const r = retry()
                      if (!r) return ""
                      const baseMessage = message()
                      const truncatedHint = isTruncated() ? " (click to expand)" : ""
                      const retryInfo = ` [retrying ${seconds() > 0 ? `in ${seconds()}s ` : ""}attempt #${r.attempt}]`
                      return baseMessage + truncatedHint + retryInfo
                    }

                    return (
                      <Show when={retry()}>
                        <box onMouseUp={handleMessageClick}>
                          <text fg={theme.error}>{retryText()}</text>
                        </box>
                      </Show>
                    )
                  })()}
                </box>
              </box>
              <text fg={props.interrupt() > 0 ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: props.interrupt() > 0 ? theme.primary : theme.textMuted }}>
                  {props.interrupt() > 0 ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Show>
          <Show when={status().type !== "retry" && promptWidth() >= 64 && verticalMode() === "normal"}>
            <box gap={2} flexDirection="row">
              <Switch>
                <Match when={props.mode() === "normal"}>
                  <text fg={theme.text}>
                    {keybind.print("agent_cycle")} <span style={{ fg: theme.textMuted }}>switch agent</span>
                  </text>
                  <text fg={theme.text}>
                    {keybind.print("command_list")} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={props.mode() === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </Show>
    </>
  )
}
