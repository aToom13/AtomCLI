import { For, Show, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSubAgents, type ActiveSubAgent } from "@tui/context/subagent"
import { useSDK } from "@tui/context/sdk"
import { Focusable } from "@tui/context/spatial"
import { Identifier } from "@/core/id/id"

/**
 * SubAgentPanel — Dynamic right-side panel
 *
 * Auto-shows when sub-agents are active via TaskTool.
 * Shows a live card for each agent with status, current tool, and output preview.
 *
 * Agent lifecycle:
 *   running  → Agent is actively working on a task
 *   waiting  → Agent finished its task, awaiting new orders from orchestrator
 *   done     → Agent is fully closed (only for legacy compat)
 *
 * Agents stay visible in "waiting" state until orchestrator explicitly removes them.
 * Includes a "Back to Orchestrator" button for quick navigation.
 */

interface Props {
  agents: ActiveSubAgent[]
  onToggle?: () => void
}

export function SubAgentPanel(props: Props) {
  const { navigate } = useRoute()
  const { theme } = useTheme()
  const subAgentCtx = useSubAgents()

  const runningCount = createMemo(() => props.agents.filter((a) => a.status === "running").length)
  const waitingCount = createMemo(() => props.agents.filter((a) => a.status === "waiting").length)

  return (
    <box flexDirection="column" width={45} flexShrink={0} border={["left"]} borderColor={theme.borderActive}>
      {/* Header with toggle and back button — always visible */}
      <box paddingLeft={1} paddingRight={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        {/* Toggle button (F9) — always visible */}
        <Focusable id="agent-panel-toggle" onPress={() => props.onToggle?.()}>
          {(focused: () => boolean) => (
            <box
              onMouseUp={() => props.onToggle?.()}
              paddingRight={1}
              backgroundColor={focused() ? theme.primary : undefined}
            >
              <text fg={theme.textMuted}>⊞</text>
            </box>
          )}
        </Focusable>

        <text fg={theme.accent}>◉ Agents ({props.agents.length})</text>
        {/* Back to orchestrator button */}
        <Show when={subAgentCtx.parentSessionId()}>
          <Focusable
            id={Identifier.ascending("part")}
            onPress={() => {
              const parentId = subAgentCtx.parentSessionId()
              if (parentId) navigate({ type: "session", sessionID: parentId })
            }}
          >
            {(focused: () => boolean) => (
              <box
                onMouseUp={() => {
                  const parentId = subAgentCtx.parentSessionId()
                  if (parentId) navigate({ type: "session", sessionID: parentId })
                }}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={focused() ? theme.primary : undefined}
              >
                <text fg={theme.accent}>← Ana Agent</text>
              </box>
            )}
          </Focusable>
        </Show>
      </box>

      <Show when={props.agents.length > 0}>
        {/* Status summary with F9 hint */}
        <box paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text fg={theme.textMuted}>
            ⟳ {runningCount()} çalışıyor ⏸ {waitingCount()} bekliyor
          </text>
        </box>

        {/* Agent cards — scrollable when many agents are active */}
        <scrollbox flexGrow={1} scrollY={true} scrollX={false} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <For each={props.agents}>{(agent) => <AgentCard agent={agent} />}</For>
        </scrollbox>
      </Show>

      {/* Empty state when no agents are active */}
      <Show when={props.agents.length === 0}>
        <box paddingLeft={1} paddingRight={1} flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.textMuted}>No active agents</text>
        </box>
      </Show>
    </box>
  )
}

function AgentCard(props: { agent: ActiveSubAgent }) {
  const sync = useSync()
  const { navigate } = useRoute()
  const { theme } = useTheme()
  const sdk = useSDK()
  const subAgentCtx = useSubAgents()

  const isDone = () => props.agent.status === "done"
  const isWaiting = () => props.agent.status === "waiting"
  const isRunning = () => props.agent.status === "running"

  const messages = createMemo(() => sync.data.message[props.agent.sessionId] ?? [])
  const lastAssistantMsg = createMemo(() => messages().findLast((m) => m.role === "assistant"))
  const parts = createMemo(() => (lastAssistantMsg() ? (sync.data.part[lastAssistantMsg()!.id] ?? []) : []))
  const lastToolPart = createMemo(
    () => parts().findLast((p: any) => p.type === "tool" && p.state?.status === "running") as any,
  )
  const lastTextPart = createMemo(() => parts().findLast((p: any) => p.type === "text") as any)

  const statusIcon = () => {
    if (isDone()) return "✓"
    if (isWaiting()) return "⏸"
    return "⟳"
  }
  const statusColor = () => {
    if (isDone()) return theme.textMuted
    if (isWaiting()) return theme.warning
    return theme.success
  }
  const borderColor = () => {
    if (isDone()) return theme.border
    if (isWaiting()) return theme.warning
    return theme.success
  }

  return (
    <box
      flexDirection="column"
      border={["top", "left", "right", "bottom"]}
      borderColor={borderColor()}
      padding={1}
      marginBottom={1}
    >
      {/* Clickable area for opening session */}
      <Focusable
        id={`agent-open-${props.agent.sessionId}`}
        onPress={() => navigate({ type: "session", sessionID: props.agent.sessionId })}
      >
        {(focused: () => boolean) => (
          <box
            flexDirection="column"
            onMouseUp={() => navigate({ type: "session", sessionID: props.agent.sessionId })}
            backgroundColor={focused() ? theme.primary : undefined}
          >
            {/* Agent header */}
            <box flexDirection="row" gap={1}>
              <text fg={statusColor()}>{statusIcon()}</text>
              <text fg={theme.accent}>@{props.agent.agentType}</text>
              <text fg={theme.textMuted}>{props.agent.description.slice(0, 18)}</text>
            </box>

            {/* Current tool (only when running) */}
            <Show when={isRunning() && lastToolPart()}>
              <text fg={theme.textMuted} paddingLeft={2}>
                └ 🔧 {lastToolPart()?.name ?? lastToolPart()?.tool ?? "working…"}
              </text>
            </Show>

            {/* Waiting message */}
            <Show when={isWaiting()}>
              <text fg={theme.warning} paddingLeft={2}>
                └ görev bekliyor…
              </text>
            </Show>

            {/* Done message */}
            <Show when={isDone()}>
              <text fg={theme.success} paddingLeft={2}>
                └ tamamlandı
              </text>
            </Show>

            {/* Last text preview (for running agents without a tool) */}
            <Show when={isRunning() && !lastToolPart() && lastTextPart()?.text}>
              <text fg={theme.textMuted} paddingLeft={2}>
                └{" "}
                {String(lastTextPart()?.text ?? "")
                  .split("\n")
                  .find((l) => l.trim())
                  ?.slice(0, 30) ?? ""}
                …
              </text>
            </Show>
          </box>
        )}
      </Focusable>

      {/* Navigation hint and actions */}
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingTop={1}>
        <box onMouseUp={() => navigate({ type: "session", sessionID: props.agent.sessionId })}>
          <text fg={theme.textMuted}>→ open session</text>
        </box>

        <Focusable
          id={`agent-kill-${props.agent.sessionId}`}
          onPress={async () => {
            if (props.agent.status === "running" || props.agent.status === "waiting") {
              await sdk.client.session.abort({ sessionID: props.agent.sessionId }).catch(() => {})
            }
            subAgentCtx.removeAgent(props.agent.sessionId)
          }}
        >
          {(focused: () => boolean) => (
            <box
              onMouseUp={async () => {
                if (props.agent.status === "running" || props.agent.status === "waiting") {
                  await sdk.client.session.abort({ sessionID: props.agent.sessionId }).catch(() => {})
                }
                subAgentCtx.removeAgent(props.agent.sessionId)
              }}
              backgroundColor={focused() ? theme.primary : undefined}
            >
              <text fg={theme.error}>✖ kill</text>
            </box>
          )}
        </Focusable>
      </box>
    </box>
  )
}
