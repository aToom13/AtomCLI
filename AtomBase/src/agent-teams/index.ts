/**
 * Agent Teams - Public API
 *
 * Re-exports all Agent Teams modules for convenient imports.
 */

export { AgentEventBus } from "./event-bus"
export { TaskBoard } from "./task-board"
export { BrowserTeamPersistence } from "./persistence-browser"
// export { FileTeamPersistence } from "./persistence" // Node-only, do not export to client bundle
export { KnowledgeBase } from "./knowledge-base"
export { TeamLead, type TeamSDKClient } from "./team-lead"
export { AgentEventBridge } from "./bridge"
export { activateTeamMode, deactivateTeamMode, TeamActivatedEvent, TeamDeactivatedEvent } from "./activate"
export type {
    AgentIdentity,
    AgentStatus,
    Task,
    TaskStatus,
    AgentTeamsEventMap,
    AgentTeamsEvent,
    KnowledgeItem,
    TeamConfig,
    TeamSnapshot,
} from "./types"
