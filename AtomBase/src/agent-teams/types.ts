/**
 * Agent Teams - Type Definitions
 *
 * All shared interfaces for the Agent Teams module.
 * These types define the contract between EventBus, TaskBoard,
 * Persistence, and TUI components.
 */

// ─── Agent Identity ───────────────────────────────────────────────

export interface AgentIdentity {
    /** Unique agent instance ID (e.g. "coder-01xabc") */
    id: string
    /** Agent type name (e.g. "coder", "tester", "researcher") */
    type: string
    /** Display name shown in TUI (e.g. "@coder") */
    displayName: string
    /** Color for TUI terminal border/badge */
    color: string
    /** Current lifecycle status */
    status: AgentStatus
}

export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "done" | "error"

// ─── Task Board ───────────────────────────────────────────────────

export interface Task {
    /** Unique task ID */
    id: string
    /** Human-readable title */
    title: string
    /** Detailed description / prompt for the agent */
    description: string
    /** Current task status */
    status: TaskStatus
    /** Which agent type should handle this (optional, for routing) */
    assignee?: string
    /** Which agent instance claimed this task */
    claimedBy?: string
    /** IDs of tasks that must complete before this one */
    dependencies: string[]
    /** Priority (lower = higher priority) */
    priority: number
    /** Timestamps */
    time: {
        created: number
        claimed?: number
        started?: number
        completed?: number
    }
    /** Result/output of the task once completed */
    result?: string
    /** Error message if task failed */
    error?: string
}

export type TaskStatus = "pending" | "claimed" | "in_progress" | "review" | "done" | "failed" | "skipped"

// ─── Event Bus ────────────────────────────────────────────────────

export interface AgentTeamsEventMap {
    // Team lifecycle
    "team:created": { teamId: string; goal: string }
    "team:completed": { teamId: string; summary: string }
    "team:error": { teamId: string; error: string }

    // Agent lifecycle
    "agent:spawned": { agent: AgentIdentity }
    "agent:status": { agentId: string; status: AgentStatus; detail?: string }
    "agent:completed": { agentId: string; summary: string }
    "agent:error": { agentId: string; error: string }

    // Agent output (for live terminal rendering)
    "agent:stdout": { agentId: string; content: string; timestamp: number }
    "agent:thinking": { agentId: string; thought: string; timestamp: number }
    "agent:action": { agentId: string; tool: string; args?: Record<string, unknown>; timestamp: number }
    "agent:action:result": { agentId: string; tool: string; result: string; timestamp: number }

    // Task board
    "task:created": { task: Task }
    "task:claimed": { taskId: string; agentId: string }
    "task:updated": { taskId: string; status: TaskStatus; detail?: string }
    "task:completed": { taskId: string; result?: string }
    "task:failed": { taskId: string; error: string }

    // Knowledge / Inter-agent communication
    "knowledge:shared": { agentId: string; key: string; value: string }
    "help:requested": { fromAgent: string; toAgent?: string; question: string }
    "help:responded": { fromAgent: string; toAgent: string; answer: string }

    // User interaction
    "approval:needed": { agentId: string; taskId: string; description: string }
    "approval:granted": { taskId: string }
    "approval:denied": { taskId: string; reason?: string }
}

export type AgentTeamsEvent = keyof AgentTeamsEventMap

export interface ITeamPersistence {
    save(snapshot: TeamSnapshot): Promise<void>
    load(): Promise<TeamSnapshot | null>
    appendEvent(event: { event: string; data: unknown; timestamp: number }): Promise<void>
    exists(): Promise<boolean>
    clear(): Promise<void>
}

// ─── Knowledge Base ───────────────────────────────────────────────

export interface KnowledgeItem {
    /** Unique key */
    key: string
    /** The data/content */
    value: string
    /** Which agent wrote this */
    author: string
    /** Tags for context selection */
    tags: string[]
    /** Timestamp */
    timestamp: number
}

// ─── Team Configuration ───────────────────────────────────────────

export interface TeamConfig {
    /** The user's top-level goal */
    goal: string
    /** Session ID this team belongs to */
    sessionId: string
    /** Maximum number of concurrent agents */
    maxConcurrentAgents: number
    /** Whether to persist state to disk */
    persist: boolean
    /** Directory for persistence files */
    persistDir?: string
}

// ─── Persistence ──────────────────────────────────────────────────

export interface TeamSnapshot {
    /** Team config */
    config: TeamConfig
    /** All agents in this team */
    agents: AgentIdentity[]
    /** Current task board state */
    tasks: Task[]
    /** Knowledge base entries */
    knowledge: KnowledgeItem[]
    /** Timestamp of this snapshot */
    timestamp: number
}
