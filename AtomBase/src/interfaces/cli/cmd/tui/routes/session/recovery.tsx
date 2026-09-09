import { createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { SessionRecovery } from "@tui/context/session-recovery"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"

export function ExecutionRecoveryPrompt(props: { sessionID: string; work: SessionRecovery.UnknownWork }) {
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const options = [
    { label: "Completed and verified", state: "completed" as const },
    { label: "Not applied / cancelled", state: "cancelled" as const },
  ]

  async function decide(state: "completed" | "cancelled") {
    if (busy()) return
    setBusy(true)
    try {
      const result = await sdk.client.session.executions.reconcile({
        sessionID: props.sessionID,
        ...SessionRecovery.reconciliation(props.work, state, crypto.randomUUID()),
      })
      if (result.error || !result.data) {
        await sync.session.refreshExecutions(props.sessionID)
        toast.show({ title: "Recovery changed", message: "Reloaded the current operation state.", variant: "info" })
        return
      }
      await sync.session.refreshExecutions(props.sessionID)
    } catch (error) {
      await sync.session.refreshExecutions(props.sessionID).catch(() => {})
      toast.show({
        title: "Recovery failed",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  useKeyboard((event) => {
    if (busy()) return
    if (!["up", "down", "left", "right", "h", "j", "k", "l", "return", "enter"].includes(event.name)) return
    event.preventDefault()
    event.stopPropagation()
    if (["up", "left", "k", "h"].includes(event.name)) setSelected(0)
    if (["down", "right", "j", "l"].includes(event.name)) setSelected(1)
    if (event.name === "return" || event.name === "enter") void decide(options[selected()].state)
  })

  return (
    <box border={["top"]} borderColor={theme.warning} paddingLeft={1} paddingRight={1} paddingTop={1} gap={1}>
      <text fg={theme.warning}>Execution recovery required</text>
      <text fg={theme.textMuted}>
        {props.work.kind} · operation {props.work.id}
      </text>
      <text fg={theme.text}>
        Confirm the observed outcome. Running agent will continue without retrying this operation.
      </text>
      <box flexDirection="row" gap={2}>
        <For each={options}>
          {(option, index) => (
            <text fg={selected() === index() ? theme.primary : theme.textMuted}>
              {selected() === index() ? "› " : "  "}
              {option.label}
            </text>
          )}
        </For>
      </box>
      <text fg={theme.textMuted}>{busy() ? "Saving decision…" : "←/→ select · enter confirm"}</text>
    </box>
  )
}
