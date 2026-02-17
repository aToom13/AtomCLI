/**
 * Agent Teams - Persistence
 *
 * Saves and loads team state snapshots to/from disk.
 * This enables "resume" functionality: if AtomCLI crashes or is closed,
 * the team can pick up where it left off.
 *
 * Storage: JSON files under `.atom/runs/<teamId>/`
 */

import fs from "fs/promises"
import path from "path"
import type { TeamSnapshot, TeamConfig, AgentIdentity, Task, KnowledgeItem, ITeamPersistence } from "./types"

const DEFAULT_PERSIST_DIR = ".atom/runs"

export class FileTeamPersistence implements ITeamPersistence {
    private dir: string
    private teamId: string

    constructor(teamId: string, config: TeamConfig) {
        this.teamId = teamId
        this.dir = path.join(config.persistDir ?? DEFAULT_PERSIST_DIR, teamId)
    }

    /**
     * Ensure the persistence directory exists.
     */
    private async ensureDir(): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true })
    }

    /**
     * Save the current team state as a snapshot.
     */
    async save(snapshot: TeamSnapshot): Promise<void> {
        await this.ensureDir()
        const filepath = path.join(this.dir, "snapshot.json")
        await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2), "utf-8")
    }

    /**
     * Load the latest snapshot, if it exists.
     * Returns null if no snapshot found (first run).
     */
    async load(): Promise<TeamSnapshot | null> {
        const filepath = path.join(this.dir, "snapshot.json")
        try {
            const content = await fs.readFile(filepath, "utf-8")
            return JSON.parse(content) as TeamSnapshot
        } catch {
            return null
        }
    }

    /**
     * Append an event to the event log (for debugging / audit trail).
     */
    async appendEvent(event: { event: string; data: unknown; timestamp: number }): Promise<void> {
        await this.ensureDir()
        const filepath = path.join(this.dir, "events.jsonl")
        const line = JSON.stringify(event) + "\n"
        await fs.appendFile(filepath, line, "utf-8")
    }

    /**
     * Delete all persistence data for this team.
     */
    async clear(): Promise<void> {
        try {
            await fs.rm(this.dir, { recursive: true, force: true })
        } catch {
            // Ignore if directory doesn't exist
        }
    }

    /**
     * Check if a previous snapshot exists (for resume detection).
     */
    async exists(): Promise<boolean> {
        const filepath = path.join(this.dir, "snapshot.json")
        try {
            await fs.access(filepath)
            return true
        } catch {
            return false
        }
    }
}
