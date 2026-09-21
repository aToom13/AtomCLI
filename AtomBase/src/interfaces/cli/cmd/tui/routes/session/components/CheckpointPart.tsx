import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"

export function CheckpointPart(props: { part: any }) {
  const { theme } = useTheme()
  const section = (title: string, items: string[]) => (
    <Show when={items.length}>
      <text fg={theme.textMuted}>{title}</text>
      <For each={items}>{(item) => <text>- {item}</text>}</For>
    </Show>
  )
  return (
    <box marginTop={1} paddingLeft={2} paddingRight={2} flexDirection="column">
      <text fg={theme.primary}>◆ Checkpoint #{props.part.sequence}</text>
      <Show when={props.part.runtime}>
        {(runtime) => (
          <>
            <text fg={theme.textMuted}>Execution: {runtime().executionID}</text>
            <text fg={theme.textMuted}>
              Trigger: {runtime().reason} · Slice: {runtime().allowance.used}/{runtime().allowance.limit} · Total tools:{" "}
              {runtime().allowance.toolCalls}
            </text>
            <text fg={theme.textMuted}>Dispatch: {runtime().model}</text>
          </>
        )}
      </Show>
      <text>{props.part.progressSummary}</text>
      {section("Completed", props.part.completedWork)}
      {section("Remaining", props.part.remainingWork)}
      {section("Failures", props.part.failures)}
      {section("Blockers", props.part.blockers)}
      <text fg={theme.textMuted}>Route: {props.part.routeAssessment}</text>
      <Show when={props.part.requestedCalls}>
        <text fg={theme.textMuted}>
          Allowance: requested {props.part.requestedCalls}, granted {props.part.grantedCalls ?? 0}
        </text>
      </Show>
    </box>
  )
}
