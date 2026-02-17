/**
 * Agent Teams - Team Lead
 *
 * The "brain" of Agent Teams. The TeamLead:
 *   1. Takes the user's goal
 *   2. Spawns agent workers (child sessions)
 *   3. Sends prompts to each agent via SDK
 *   4. Monitors progress via EventBus
 *   5. Handles inter-agent communication (help requests)
 *
 * This is the orchestrator for Agent Teams mode.
 */

import { ulid } from "ulid"
import type { AgentIdentity, TeamConfig, TeamSnapshot, ITeamPersistence } from "./types"
import { AgentEventBus } from "./event-bus"
import { TaskBoard } from "./task-board"
import { KnowledgeBase } from "./knowledge-base"

/**
 * Minimal SDK interface — only methods TeamLead needs.
 * Avoids importing the full @atomcli/sdk client which has browser conditions.
 */
export interface TeamSDKClient {
    session: {
        create(input: { parentID?: string; title?: string }): Promise<{ data?: { id: string } }>
        prompt(input: {
            sessionID: string
            parts: { id: string; type: "text"; text: string }[]
            agent?: string
            model?: { providerID: string; modelID: string }
            [key: string]: unknown
        }): Promise<unknown>
    }
}

export interface TeamLeadOptions {
    config: TeamConfig
    persistence: ITeamPersistence
    /** SDK client for creating child sessions and sending prompts */
    sdkClient: TeamSDKClient
    /** Currently selected model for prompts */
    model?: { providerID: string; modelID: string }
    /** Currently selected agent name */
    agentName?: string
    onApprovalNeeded?: (description: string) => Promise<boolean>
}

/** Agent role definitions for task decomposition */
const AGENT_ROLES = [
    {
        type: "planner",
        displayName: "📋 Planner",
        color: "#60a5fa",
        promptPrefix: "Sen bir planlayıcı agent'sın. Görevi analiz et, alt görevlere böl ve plan oluştur.",
    },
    {
        type: "coder",
        displayName: "💻 Coder",
        color: "#34d399",
        promptPrefix: "Sen bir kodlayıcı agent'sın. Verilen görevi uygula, kod yaz ve test et.",
    },
] as const

export class TeamLead {
    readonly id: string
    readonly eventBus: AgentEventBus
    readonly taskBoard: TaskBoard
    readonly knowledgeBase: KnowledgeBase
    readonly persistence: ITeamPersistence
    readonly config: TeamConfig

    private agents = new Map<string, AgentIdentity>()
    /** Maps agentId -> child sessionId */
    private agentSessions = new Map<string, string>()
    private running = false
    private cleanupFns: (() => void)[] = []
    private sdkClient: TeamSDKClient
    private model?: { providerID: string; modelID: string }
    private agentName?: string

    constructor(options: TeamLeadOptions) {
        this.id = ulid()
        this.config = options.config
        this.persistence = options.persistence
        this.sdkClient = options.sdkClient
        this.model = options.model
        this.agentName = options.agentName
        this.eventBus = new AgentEventBus({ maxHistory: 1000 })
        this.taskBoard = new TaskBoard(this.eventBus)
        this.knowledgeBase = new KnowledgeBase(this.eventBus)

        // Wire up persistence: save snapshot on key events
        if (this.config.persist) {
            const unsub = this.eventBus.onAny(async () => {
                await this.saveSnapshot()
            })
            this.cleanupFns.push(unsub)
        }
    }

    /**
     * Register a new agent in the team.
     */
    spawnAgent(type: string, displayName: string, color: string): AgentIdentity {
        const agent: AgentIdentity = {
            id: `${type}-${ulid()}`,
            type,
            displayName,
            color,
            status: "idle",
        }
        this.agents.set(agent.id, agent)
        this.eventBus.emit("agent:spawned", { agent })
        return agent
    }

    /**
     * Update an agent's status.
     */
    updateAgentStatus(agentId: string, status: AgentIdentity["status"], detail?: string): void {
        const agent = this.agents.get(agentId)
        if (agent) {
            agent.status = status
            this.eventBus.emit("agent:status", { agentId, status, detail })
        }
    }

    /**
     * Emit agent stdout (for TUI terminal rendering).
     */
    agentOutput(agentId: string, content: string): void {
        this.eventBus.emit("agent:stdout", {
            agentId,
            content,
            timestamp: Date.now(),
        })
    }

    /**
     * Emit agent thinking (for TUI thought bubble).
     */
    agentThinking(agentId: string, thought: string): void {
        this.eventBus.emit("agent:thinking", {
            agentId,
            thought,
            timestamp: Date.now(),
        })
    }

    /**
     * Emit agent tool action (for TUI action log).
     */
    agentAction(agentId: string, tool: string, args?: Record<string, unknown>): void {
        this.eventBus.emit("agent:action", {
            agentId,
            tool,
            args,
            timestamp: Date.now(),
        })
    }

    /**
     * Get all registered agents.
     */
    getAgents(): AgentIdentity[] {
        return Array.from(this.agents.values())
    }

    /**
     * Get a specific agent by ID.
     */
    getAgent(agentId: string): AgentIdentity | undefined {
        return this.agents.get(agentId)
    }

    /**
     * Get the child session ID for an agent.
     */
    getAgentSessionId(agentId: string): string | undefined {
        return this.agentSessions.get(agentId)
    }

    /**
     * Get all agent-session mappings (for bridge wiring).
     */
    getAgentSessionMap(): Map<string, string> {
        return new Map(this.agentSessions)
    }

    /**
     * Start the team execution loop.
     * 
     * Flow:
     *   1. Sends an orchestrator prompt to the MAIN session → appears on left side
     *   2. Spawns sub-agents (child sessions) → appear on right side
     * 
     * The orchestrator thinks, plans, and coordinates. Users see its output
     * streaming in real-time on the left panel.
     */
    async start(): Promise<void> {
        this.running = true
        this.eventBus.emit("team:created", {
            teamId: this.id,
            goal: this.config.goal,
        })

        // ── Step 1: Send orchestrator prompt to MAIN session ──────────
        // This makes the left-side agent think and plan in real-time
        const orchestratorPrompt = [
            `# 🤖 Team Lead — Görev Yönetimi`,
            ``,
            `Sen bir Team Lead orchestrator agent'sın. Aşağıdaki görevi alıp organize etmen gerekiyor.`,
            ``,
            `## Görev`,
            `${this.config.goal}`,
            ``,
            `## Yapman Gerekenler`,
            `1. **Analiz**: Görevi detaylıca analiz et`,
            `2. **Plan**: Alt görevlere ayır`,
            `3. **Dağılım**: Her alt görev için uygun agent tipini belirle (planner, coder, tester vb.)`,
            `4. **Model Seçimi**: Alt ajanların hangi modeli kullanacağını belirle`,
            `5. **Uygulama**: Planı uygula, gerekli dosyaları oluştur veya düzenle`,
            ``,
            `Çalışmaya başla.`,
        ].join("\n")

        try {
            await this.sdkClient.session.prompt({
                sessionID: this.config.sessionId,
                parts: [
                    {
                        id: `part-${ulid()}`,
                        type: "text" as const,
                        text: orchestratorPrompt,
                    },
                ],
                ...(this.agentName ? { agent: this.agentName } : {}),
                ...(this.model ? { model: this.model } : {}),
            })
        } catch (err) {
            console.error("[TeamLead] Error sending orchestrator prompt:", err)
        }

        // ── Step 2: Spawn sub-agents (child sessions) ─────────────────
        // These appear on the right-side Agent Workspace
        for (const role of AGENT_ROLES) {
            try {
                // 1. Register the agent locally
                const agent = this.spawnAgent(role.type, role.displayName, role.color)
                this.updateAgentStatus(agent.id, "thinking", "Oturum oluşturuluyor...")

                // 2. Create a child session on the server
                const result = await this.sdkClient.session.create({
                    title: `${role.displayName} — ${this.config.goal.slice(0, 40)}`,
                })

                if (!result.data?.id) {
                    this.updateAgentStatus(agent.id, "error", "Session oluşturulamadı")
                    continue
                }

                const childSessionId = result.data.id
                this.agentSessions.set(agent.id, childSessionId)

                // 3. Send prompt to the child session
                const prompt = `${role.promptPrefix}\n\nGörev: ${this.config.goal}`
                this.updateAgentStatus(agent.id, "working", "Prompt gönderiliyor...")

                await this.sdkClient.session.prompt({
                    sessionID: childSessionId,
                    parts: [
                        {
                            id: `part-${ulid()}`,
                            type: "text" as const,
                            text: prompt,
                        },
                    ],
                    ...(this.agentName ? { agent: this.agentName } : {}),
                    ...(this.model ? { model: this.model } : {}),
                })

                this.updateAgentStatus(agent.id, "working", "Çalışıyor...")
            } catch (err) {
                console.error(`[TeamLead] Error spawning ${role.type}:`, err)
            }
        }
    }

    /**
     * Stop the team gracefully.
     */
    async stop(summary?: string): Promise<void> {
        this.running = false
        for (const agent of this.agents.values()) {
            agent.status = "done"
        }
        this.eventBus.emit("team:completed", {
            teamId: this.id,
            summary: summary ?? "Team stopped.",
        })
        await this.saveSnapshot()
    }

    /**
     * Check if the team is actively running.
     */
    isRunning(): boolean {
        return this.running
    }

    /**
     * Try to resume from a previous snapshot.
     */
    async tryResume(): Promise<boolean> {
        const snapshot = await this.persistence.load()
        if (!snapshot) return false

        // Restore agents
        for (const agent of snapshot.agents) {
            this.agents.set(agent.id, agent)
        }

        // Restore task board
        this.taskBoard.loadFromSnapshot(snapshot.tasks)

        // Restore knowledge base
        this.knowledgeBase.loadFromSnapshot(snapshot.knowledge)

        return true
    }

    /**
     * Save current state as a snapshot.
     */
    private async saveSnapshot(): Promise<void> {
        const snapshot: TeamSnapshot = {
            config: this.config,
            agents: this.getAgents(),
            tasks: this.taskBoard.getAllTasks(),
            knowledge: this.knowledgeBase.getAll(),
            timestamp: Date.now(),
        }
        await this.persistence.save(snapshot)
    }

    /**
     * Clean up all resources.
     */
    destroy(): void {
        for (const fn of this.cleanupFns) {
            fn()
        }
        this.cleanupFns = []
        this.eventBus.destroy()
        this.agents.clear()
        this.agentSessions.clear()
    }
}
