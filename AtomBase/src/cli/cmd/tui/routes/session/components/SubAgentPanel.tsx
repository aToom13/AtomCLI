import { For, Show, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSubAgents, type ActiveSubAgent } from "@tui/context/subagent"
import { useSDK } from "@tui/context/sdk"

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
}

export function SubAgentPanel(props: Props) {
    const { navigate } = useRoute()
    const { theme } = useTheme()
    const subAgentCtx = useSubAgents()

    const runningCount = createMemo(() => props.agents.filter((a) => a.status === "running").length)
    const waitingCount = createMemo(() => props.agents.filter((a) => a.status === "waiting").length)
    const doneCount = createMemo(() => props.agents.filter((a) => a.status === "done").length)

    return (
        <Show when={props.agents.length > 0}>
            <box
                flexDirection="column"
                width={45}
                flexShrink={0}
                border={["left"]}
                borderColor={theme.borderActive}
            >
                {/* Header with back button */}
                <box
                    paddingLeft={1}
                    paddingRight={1}
                    flexShrink={0}
                    flexDirection="row"
                    justifyContent="space-between"
                >
                    <text fg={theme.accent}>
                        ◉ Active Agents ({props.agents.length})
                    </text>
                    {/* Back to orchestrator button */}
                    <Show when={subAgentCtx.parentSessionId()}>
                        <box
                            onMouseUp={() => {
                                const parentId = subAgentCtx.parentSessionId()
                                if (parentId) navigate({ type: "session", sessionID: parentId })
                            }}
                            paddingLeft={1}
                            paddingRight={1}
                        >
                            <text fg={theme.accent}>← Ana Agent</text>
                        </box>
                    </Show>
                </box>

                {/* Status summary */}
                <box paddingLeft={1} paddingRight={1} flexShrink={0}>
                    <text fg={theme.textMuted}>
                        ⟳ {runningCount()} çalışıyor  ⏸ {waitingCount()} bekliyor
                        <Show when={doneCount() > 0}>
                            {" "} ✓ {doneCount()} bitti
                        </Show>
                    </text>
                </box>

                {/* Agent cards */}
                <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}>
                    <For each={props.agents}>
                        {(agent) => <AgentCard agent={agent} />}
                    </For>
                </box>
            </box>
        </Show>
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
    const lastAssistantMsg = createMemo(() =>
        messages().findLast((m) => m.role === "assistant")
    )
    const parts = createMemo(() =>
        lastAssistantMsg() ? (sync.data.part[lastAssistantMsg()!.id] ?? []) : []
    )
    const lastToolPart = createMemo(() =>
        parts().findLast((p: any) => p.type === "tool" && p.state?.status === "running") as any
    )
    const lastTextPart = createMemo(() =>
        parts().findLast((p: any) => p.type === "text") as any
    )

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
            <box
                flexDirection="column"
                onMouseUp={() => navigate({ type: "session", sessionID: props.agent.sessionId })}
            >
                {/* Agent header */}
                <box flexDirection="row" gap={1}>
                    <text fg={statusColor()}>
                        {statusIcon()}
                    </text>
                    <text fg={theme.accent}>
                        @{props.agent.agentType}
                    </text>
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

            {/* Navigation hint and actions */}
            <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingTop={1}>
                <box onMouseUp={() => navigate({ type: "session", sessionID: props.agent.sessionId })}>
                    <text fg={theme.textMuted}>→ open session</text>
                </box>

                <box
                    onMouseUp={async () => {
                        if (props.agent.status === "running" || props.agent.status === "waiting") {
                            await sdk.client.session.abort({ sessionID: props.agent.sessionId }).catch(() => { })
                        }
                        subAgentCtx.removeAgent(props.agent.sessionId)
                    }}
                >
                    <text fg={theme.error}>✖ kill</text>
                </box>
            </box>
        </box>
    )
}
