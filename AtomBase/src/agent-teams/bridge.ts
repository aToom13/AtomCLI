/**
 * Agent Teams - Event Bridge
 *
 * Bridges the existing AtomCLI Bus/Session event system with the
 * Agent Teams EventBus. This is a NON-INVASIVE integration:
 * instead of modifying prompt.ts or processor.ts directly,
 * we subscribe to the existing Bus events and forward them
 * to the AgentEventBus.
 *
 * This means Agent Teams gets real-time updates without
 * touching any core session logic.
 *
 * Usage:
 *   const bridge = new AgentEventBridge(teamLead)
 *   bridge.subscribe(agentId, sessionId)
 *   // ... later
 *   bridge.destroy()
 */

import { Bus } from "@/bus"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import type { TeamLead } from "./team-lead"

export class AgentEventBridge {
    private teamLead: TeamLead
    private unsubscribers: (() => void)[] = []
    private agentSessionMap = new Map<string, string>() // sessionID -> agentId

    constructor(teamLead: TeamLead) {
        this.teamLead = teamLead
    }

    /**
     * Start forwarding events from a session to an agent's terminal.
     * Each sub-agent runs in its own session, so we map sessionID -> agentId.
     */
    subscribe(agentId: string, sessionId: string): void {
        this.agentSessionMap.set(sessionId, agentId)

        // Listen for part updates (text-delta, tool-call, etc.)
        // The existing Bus publishes MessageV2.Event.PartUpdated for every part change.
        const unsubPart = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            const { part, delta } = event.properties
            if (part.sessionID !== sessionId) return
            const agent = this.agentSessionMap.get(sessionId)
            if (!agent) return

            this.forwardPartEvent(agent, { part, delta })
        })
        this.unsubscribers.push(unsubPart)

        // Listen for message updates (which include status changes)
        const unsubMsg = Bus.subscribe(MessageV2.Event.Updated, (event) => {
            const { info } = event.properties
            if (info.sessionID !== sessionId) return
            const agent = this.agentSessionMap.get(sessionId)
            if (!agent) return

            // If the message has completed
            if (info.role === "assistant" && info.time?.completed) {
                this.teamLead.updateAgentStatus(agent, "done", "Task completed")
            }
        })
        this.unsubscribers.push(unsubMsg)

        // Listen for session errors
        const unsubError = Bus.subscribe(Session.Event.Error, (event) => {
            const { sessionID, error } = event.properties
            if (sessionID !== sessionId) return
            const agent = this.agentSessionMap.get(sessionId)
            if (!agent) return

            this.teamLead.updateAgentStatus(agent, "error", error?.name ?? "Unknown error")
            this.teamLead.eventBus.emit("agent:error", {
                agentId: agent,
                error: error?.data ? JSON.stringify(error.data) : "Unknown error",
            })
        })
        this.unsubscribers.push(unsubError)
    }

    /**
     * Forward a part update event to the Agent Teams EventBus.
     */
    private forwardPartEvent(agentId: string, event: any): void {
        const part = event.part ?? event

        switch (part.type) {
            case "text":
                // Text delta → agent:stdout
                if (event.delta) {
                    this.teamLead.agentOutput(agentId, event.delta)
                }
                break

            case "reasoning":
                // Reasoning delta → agent:thinking
                if (event.delta) {
                    this.teamLead.agentThinking(agentId, event.delta)
                }
                break

            case "tool":
                // Tool state changes
                if (part.state?.status === "running") {
                    this.teamLead.updateAgentStatus(agentId, "working", `Running ${part.tool}`)
                    this.teamLead.agentAction(agentId, part.tool, part.state.input)
                } else if (part.state?.status === "completed") {
                    const preview = typeof part.state.output === "string"
                        ? part.state.output.slice(0, 100)
                        : JSON.stringify(part.state.output).slice(0, 100)
                    this.teamLead.eventBus.emit("agent:action:result", {
                        agentId,
                        tool: part.tool,
                        result: preview,
                        timestamp: Date.now(),
                    })
                } else if (part.state?.status === "error") {
                    this.teamLead.eventBus.emit("agent:action:result", {
                        agentId,
                        tool: part.tool,
                        result: `❌ ${part.state.error ?? "Error"}`,
                        timestamp: Date.now(),
                    })
                }
                break

            case "step-start":
                this.teamLead.updateAgentStatus(agentId, "thinking", "Processing...")
                break

            case "step-finish":
                this.teamLead.updateAgentStatus(agentId, "idle", "Step finished")
                break
        }
    }

    /**
     * Stop forwarding events and clean up.
     */
    destroy(): void {
        for (const unsub of this.unsubscribers) {
            unsub()
        }
        this.unsubscribers = []
        this.agentSessionMap.clear()
    }
}
