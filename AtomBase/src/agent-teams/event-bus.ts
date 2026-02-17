/**
 * Agent Teams - Event Bus
 *
 * A typed EventEmitter that all Agent Teams components communicate through.
 * The TUI subscribes to these events to render live agent output.
 *
 * Design:
 *   - Singleton per team session
 *   - Typed event map (AgentTeamsEventMap)
 *   - Supports wildcards for "catch-all" listeners (e.g., TUI logger)
 *   - Event history for late subscribers (replay last N events)
 */

import type { AgentTeamsEventMap, AgentTeamsEvent } from "./types"

type Listener<T> = (data: T) => void

interface EventEntry {
    event: AgentTeamsEvent
    data: unknown
    timestamp: number
}

export class AgentEventBus {
    private listeners = new Map<string, Set<Listener<any>>>()
    private history: EventEntry[] = []
    private maxHistory: number

    constructor(options?: { maxHistory?: number }) {
        this.maxHistory = options?.maxHistory ?? 500
    }

    /**
     * Subscribe to a specific event type.
     * Returns an unsubscribe function.
     */
    on<K extends AgentTeamsEvent>(event: K, listener: Listener<AgentTeamsEventMap[K]>): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set())
        }
        this.listeners.get(event)!.add(listener)

        return () => {
            this.listeners.get(event)?.delete(listener)
        }
    }

    /**
     * Subscribe to ALL events (wildcard).
     * Useful for TUI event log panels or persistence.
     */
    onAny(listener: Listener<{ event: AgentTeamsEvent; data: unknown }>): () => void {
        if (!this.listeners.has("*")) {
            this.listeners.set("*", new Set())
        }
        this.listeners.get("*")!.add(listener)

        return () => {
            this.listeners.get("*")?.delete(listener)
        }
    }

    /**
     * Emit a typed event.
     */
    emit<K extends AgentTeamsEvent>(event: K, data: AgentTeamsEventMap[K]): void {
        const entry: EventEntry = { event, data, timestamp: Date.now() }

        // Store in history
        this.history.push(entry)
        if (this.history.length > this.maxHistory) {
            this.history.shift()
        }

        // Notify specific listeners
        const specific = this.listeners.get(event)
        if (specific) {
            for (const listener of specific) {
                try {
                    listener(data)
                } catch (err) {
                    console.error(`[AgentEventBus] Error in listener for "${event}":`, err)
                }
            }
        }

        // Notify wildcard listeners
        const wildcards = this.listeners.get("*")
        if (wildcards) {
            for (const listener of wildcards) {
                try {
                    listener({ event, data })
                } catch (err) {
                    console.error(`[AgentEventBus] Error in wildcard listener:`, err)
                }
            }
        }
    }

    /**
     * Get recent event history, optionally filtered by event type.
     * Useful for late-joining TUI panels to catch up.
     */
    getHistory(filter?: AgentTeamsEvent, limit?: number): EventEntry[] {
        let result = filter ? this.history.filter((e) => e.event === filter) : [...this.history]
        if (limit) {
            result = result.slice(-limit)
        }
        return result
    }

    /**
     * Get history for a specific agent.
     */
    getAgentHistory(agentId: string, limit?: number): EventEntry[] {
        const agentEvents = this.history.filter((e) => {
            const d = e.data as Record<string, unknown>
            return d && d.agentId === agentId
        })
        return limit ? agentEvents.slice(-limit) : agentEvents
    }

    /**
     * Clear all listeners and history.
     */
    destroy(): void {
        this.listeners.clear()
        this.history = []
    }
}
