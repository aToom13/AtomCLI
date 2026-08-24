import stripAnsi from "strip-ansi"
import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { SshTool } from "@/integrations/tool/ssh"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"

export function Ssh(props: ToolProps<typeof SshTool>) {
  const { theme } = useTheme()
  const [expanded, setExpanded] = createSignal(false)
  const output = createMemo(() => stripAnsi((props.metadata.output ?? props.output ?? "").trimEnd()))
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })
  const complete = createMemo(() => props.part.state.status === "completed")
  const profile = createMemo(() => props.input.host ?? props.input.username ?? "remote")
  const summary = createMemo(() => {
    if (props.input.action === "profile_list") return "List SSH profiles"
    if (props.input.action === "profile_add") return `Save SSH profile ${profile()}`
    if (props.input.action === "profile_remove") return `Remove SSH profile ${profile()}`
    if (props.input.path) return `SSH ${props.input.action} ${profile()}:${props.input.path}`
    return `SSH ${props.input.action ?? "operation"} ${profile()}`
  })

  return (
    <Show
      when={props.input.action === "exec"}
      fallback={
        <InlineTool icon="⇄" pending={summary()} complete={complete() ? summary() : undefined} part={props.part}>
          {summary()}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# SSH ${props.metadata.target ?? profile()} · ${props.input.description ?? "Remote command"}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((previous) => !previous) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>$ {props.input.command}</text>
          <Show when={output()} fallback={<text fg={theme.textMuted}>Connecting…</text>}>
            <text fg={theme.text}>{limited()}</text>
          </Show>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}
