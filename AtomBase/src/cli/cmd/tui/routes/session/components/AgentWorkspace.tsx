/**
 * AgentWorkspace - The right-side panel showing all active agent terminals.
 *
 * Layout logic:
 *   - 1 agent:  Full height single terminal
 *   - 2 agents: Split vertically 50/50
 *   - 3+ agents: Equal split or tabbed (future)
 *
 * This component is rendered alongside the main chat in Split Screen mode.
 */

import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AgentIdentity } from "@/agent-teams/types"
import type { AgentEventBus } from "@/agent-teams/event-bus"
import { AgentTerminal } from "./AgentTerminal"

export function AgentWorkspace(props: {
    agents: AgentIdentity[]
    eventBus: AgentEventBus
    width?: number | `${number}%`
}) {
    const { theme } = useTheme()

    const activeAgents = createMemo(() =>
        props.agents.filter((a) => a.status !== "done"),
    )

    const allAgents = createMemo(() => props.agents)

    return (
        <box
            width={props.width ?? ("50%" as `${number}%`)}
            flexDirection="column"
            borderColor={theme.border}
            border={["left"]}
            backgroundColor={theme.background}
        >
            {/* Workspace Header */}
            <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundMenu}
                flexShrink={0}
                justifyContent="space-between"
            >
                <text attributes={TextAttributes.BOLD} fg={theme.accent}>
                    🤖 Agent Workspace
                </text>
                <text fg={theme.textMuted}>
                    {activeAgents().length}/{allAgents().length} active
                </text>
            </box>

            {/* Agent Terminal Panels (Dynamic Split) */}
            <Show
                when={allAgents().length > 0}
                fallback={
                    <box flexGrow={1} justifyContent="center" alignItems="center">
                        <text fg={theme.textMuted}>Waiting for agents to spawn...</text>
                    </box>
                }
            >
                <box flexDirection="column" flexGrow={1}>
                    <For each={allAgents()}>
                        {(agent) => (
                            <AgentTerminal
                                agent={agent}
                                eventBus={props.eventBus}
                            />
                        )}
                    </For>
                </box>
            </Show>
        </box>
    )
}
