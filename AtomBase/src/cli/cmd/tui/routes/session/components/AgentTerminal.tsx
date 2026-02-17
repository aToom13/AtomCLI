/**
 * AgentTerminal - A single agent's live terminal output panel.
 *
 * Renders a scrollable terminal view showing the agent's:
 *   - Current status (badge with color)
 *   - Streaming stdout output
 *   - Tool calls / actions
 *   - Thinking / reasoning
 */

import { createSignal, createEffect, For, onCleanup, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { AgentIdentity, AgentTeamsEvent } from "@/agent-teams/types"
import type { AgentEventBus } from "@/agent-teams/event-bus"
import { TextAttributes } from "@opentui/core"

interface OutputLine {
    type: "stdout" | "thinking" | "action" | "result" | "status"
    content: string
    timestamp: number
}

const STATUS_ICONS: Record<string, string> = {
    idle: "⏸",
    thinking: "💭",
    working: "🔴",
    waiting: "🟡",
    done: "🟢",
    error: "🔴",
}

export function AgentTerminal(props: {
    agent: AgentIdentity
    eventBus: AgentEventBus
    height?: number | `${number}%`
}) {
    const { theme } = useTheme()
    const [lines, setLines] = createSignal<OutputLine[]>([])
    const [status, setStatus] = createSignal(props.agent.status)

    const statusIcon = createMemo(() => STATUS_ICONS[status()] ?? "⏸")

    // Subscribe to events for this agent
    createEffect(() => {
        const unsubscribers: (() => void)[] = []

        // Agent stdout
        unsubscribers.push(
            props.eventBus.on("agent:stdout", (data) => {
                if (data.agentId !== props.agent.id) return
                setLines((prev) => [
                    ...prev,
                    { type: "stdout", content: data.content, timestamp: data.timestamp },
                ])
            }),
        )

        // Agent thinking
        unsubscribers.push(
            props.eventBus.on("agent:thinking", (data) => {
                if (data.agentId !== props.agent.id) return
                setLines((prev) => [
                    ...prev,
                    { type: "thinking", content: `💭 ${data.thought}`, timestamp: data.timestamp },
                ])
            }),
        )

        // Agent action (tool call)
        unsubscribers.push(
            props.eventBus.on("agent:action", (data) => {
                if (data.agentId !== props.agent.id) return
                setLines((prev) => [
                    ...prev,
                    { type: "action", content: `⚡ ${data.tool}(...)`, timestamp: data.timestamp },
                ])
            }),
        )

        // Agent action result
        unsubscribers.push(
            props.eventBus.on("agent:action:result", (data) => {
                if (data.agentId !== props.agent.id) return
                const preview = data.result.length > 80 ? data.result.slice(0, 77) + "..." : data.result
                setLines((prev) => [
                    ...prev,
                    { type: "result", content: `  ✓ ${preview}`, timestamp: data.timestamp },
                ])
            }),
        )

        // Agent status changes
        unsubscribers.push(
            props.eventBus.on("agent:status", (data) => {
                if (data.agentId !== props.agent.id) return
                setStatus(data.status)
                if (data.detail) {
                    setLines((prev) => [
                        ...prev,
                        { type: "status", content: `[${data.status}] ${data.detail}`, timestamp: Date.now() },
                    ])
                }
            }),
        )

        onCleanup(() => {
            for (const unsub of unsubscribers) {
                unsub()
            }
        })
    })

    // Replay history on mount
    createEffect(() => {
        const history = props.eventBus.getAgentHistory(props.agent.id, 50)
        const replay: OutputLine[] = history
            .filter((e) => e.event.startsWith("agent:"))
            .map((e) => {
                const data = e.data as any
                switch (e.event) {
                    case "agent:stdout":
                        return { type: "stdout" as const, content: data.content, timestamp: e.timestamp }
                    case "agent:thinking":
                        return { type: "thinking" as const, content: `💭 ${data.thought}`, timestamp: e.timestamp }
                    case "agent:action":
                        return { type: "action" as const, content: `⚡ ${data.tool}(...)`, timestamp: e.timestamp }
                    default:
                        return null
                }
            })
            .filter(Boolean) as OutputLine[]

        if (replay.length > 0) {
            setLines(replay)
        }
    })

    const getLineColor = (type: OutputLine["type"]): string => {
        switch (type) {
            case "thinking":
                return theme.textMuted as unknown as string
            case "action":
                return theme.accent as unknown as string
            case "result":
                return theme.success as unknown as string
            case "status":
                return theme.warning as unknown as string
            default:
                return theme.text as unknown as string
        }
    }

    return (
        <box
            flexDirection="column"
            borderColor={props.agent.color ?? theme.border}
            border={["top"]}
            height={props.height}
            flexGrow={1}
        >
            {/* Header: Agent Badge */}
            <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
                flexShrink={0}
            >
                <text attributes={TextAttributes.BOLD} fg={props.agent.color ?? theme.accent}>
                    {statusIcon()} {props.agent.displayName}
                </text>
                <text fg={theme.textMuted}>
                    ({status()})
                </text>
            </box>

            {/* Terminal Output */}
            <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
                <For each={lines()}>
                    {(line) => (
                        <text fg={getLineColor(line.type)}>
                            {line.content}
                        </text>
                    )}
                </For>
                <Show when={lines().length === 0}>
                    <text fg={theme.textMuted} paddingLeft={1}>
                        Waiting for output...
                    </text>
                </Show>
            </scrollbox>
        </box>
    )
}
