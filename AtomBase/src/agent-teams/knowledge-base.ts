/**
 * Agent Teams - Knowledge Base
 *
 * A shared, in-memory knowledge store that agents can read/write to.
 * Enables inter-agent data sharing without direct communication.
 *
 * Features:
 *   - Tag-based context selection
 *   - Event emission on writes
 *   - Snapshot support for persistence
 */

import type { KnowledgeItem } from "./types"
import type { AgentEventBus } from "./event-bus"

export class KnowledgeBase {
    private items = new Map<string, KnowledgeItem>()
    private eventBus: AgentEventBus

    constructor(eventBus: AgentEventBus) {
        this.eventBus = eventBus
    }

    /**
     * Store a knowledge item. Overwrites if key exists.
     */
    set(key: string, value: string, author: string, tags: string[] = []): void {
        const item: KnowledgeItem = {
            key,
            value,
            author,
            tags,
            timestamp: Date.now(),
        }
        this.items.set(key, item)
        this.eventBus.emit("knowledge:shared", { agentId: author, key, value })
    }

    /**
     * Retrieve a knowledge item by key.
     */
    get(key: string): KnowledgeItem | undefined {
        return this.items.get(key)
    }

    /**
     * Search knowledge by tags.
     * Returns items that match ANY of the given tags.
     */
    findByTags(tags: string[]): KnowledgeItem[] {
        const tagSet = new Set(tags)
        return Array.from(this.items.values()).filter((item) =>
            item.tags.some((t) => tagSet.has(t)),
        )
    }

    /**
     * Search knowledge by text content (simple substring match).
     */
    search(query: string): KnowledgeItem[] {
        const lower = query.toLowerCase()
        return Array.from(this.items.values()).filter(
            (item) =>
                item.key.toLowerCase().includes(lower) ||
                item.value.toLowerCase().includes(lower),
        )
    }

    /**
     * Get all items.
     */
    getAll(): KnowledgeItem[] {
        return Array.from(this.items.values())
    }

    /**
     * Load from snapshot (for resume).
     */
    loadFromSnapshot(items: KnowledgeItem[]): void {
        this.items.clear()
        for (const item of items) {
            this.items.set(item.key, item)
        }
    }

    /**
     * Clear all knowledge.
     */
    clear(): void {
        this.items.clear()
    }
}
