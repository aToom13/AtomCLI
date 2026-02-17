import type { ITeamPersistence, TeamSnapshot } from "./types"

export class BrowserTeamPersistence implements ITeamPersistence {
    async save(snapshot: TeamSnapshot): Promise<void> {
        // No-op for now in browser/TUI
    }

    async load(): Promise<TeamSnapshot | null> {
        return null
    }

    async appendEvent(event: { event: string; data: unknown; timestamp: number }): Promise<void> {
        // No-op
    }

    async exists(): Promise<boolean> {
        return false
    }

    async clear(): Promise<void> {
        // No-op
    }
}
