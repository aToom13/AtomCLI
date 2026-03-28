import { EventEmitter } from "events"
import { Log } from "@atomcli/util"
import { NtfyService } from "./ntfy"

/**
 * Mobile Bridge Service
 *
 * Bridges internal events to connected mobile WebSocket clients.
 */

const log = Log.create({ service: "mobile-bridge" })

export interface BridgeEvent {
    seq_id: number
    type: string
    topic?: string
    payload: Record<string, unknown>
}

export interface PendingPermission {
    req_id: string
    sessionID: string
    permission: string
    patterns: string[]
    metadata: Record<string, unknown>
}

export interface DagStep {
    name: string
    description: string
    status: string
    sessionID?: string
    agentType?: string
    dependsOn?: string[]
    todos?: { id: string; content: string; status: string }[]
}

export interface SubAgentSession {
    sessionID: string
    parentSessionID?: string
    agentType: string
    name: string
    status: 'running' | 'done' | 'failed'
    startedAt: number
    finishedAt?: number
}

export interface PendingQuestion {
    req_id: string
    sessionID: string
    questions: {
        question: string
        header: string
        type: string
        placeholder?: string
        options?: { label: string; description: string }[]
        multiple?: boolean
    }[]
    tool?: { messageID: string; callID: string }
}

type Sender = (data: string) => void

const _clients = new Map<string, Sender>()
let _seq = 0
const STATE_BUFFER_MAX = 200
const _buffer: BridgeEvent[] = []
const _dagSteps = new Map<string, DagStep>()
const _pendingPermissions = new Map<string, PendingPermission>()
const _subAgentSessions = new Map<string, SubAgentSession>()
const _pendingQuestions = new Map<string, PendingQuestion>()
const LOG_THROTTLE_MS = 500
const _lastLogForwarded = new Map<string, number>()

function nextSeq(): number {
    return ++_seq
}

function bufferEvent(event: BridgeEvent): void {
    _buffer.push(event)
    if (_buffer.length > STATE_BUFFER_MAX) _buffer.shift()
}

function broadcast(event: BridgeEvent): void {
    const msg = JSON.stringify(event)
    for (const [, send] of Array.from(_clients)) {
        try { send(msg) } catch { /* ignore */ }
    }
}

function broadcastThrottledLog(payload: Record<string, unknown>): void {
    const now = Date.now()
    const msg = JSON.stringify({ type: "log", payload })
    for (const [clientId, send] of Array.from(_clients)) {
        const last = _lastLogForwarded.get(clientId) ?? 0
        if (now - last < LOG_THROTTLE_MS) continue
        _lastLogForwarded.set(clientId, now)
        try { send(msg) } catch { /* ignore */ }
    }
}

export namespace MobileBridge {
    export function registerClient(clientId: string, send: Sender): void {
        _clients.set(clientId, send)
        _lastLogForwarded.set(clientId, 0)
    }

    export function unregisterClient(clientId: string): void {
        _clients.delete(clientId)
        _lastLogForwarded.delete(clientId)
    }

    export function replayMissed(clientId: string, lastSeqId: number): void {
        const send = _clients.get(clientId)
        if (!send) return
        for (const event of _buffer.filter((e) => e.seq_id > lastSeqId)) {
            try { send(JSON.stringify(event)) } catch { /* ignore */ }
        }
    }

    export function sendSnapshot(clientId: string): void {
        const send = _clients.get(clientId)
        if (!send) return
        try {
            send(JSON.stringify({
                type: "snapshot",
                payload: {
                    dag: Array.from(_dagSteps.values()),
                    pending_permissions: Array.from(_pendingPermissions.values()),
                    sub_agents: Array.from(_subAgentSessions.values()),
                    pending_questions: Array.from(_pendingQuestions.values()),
                    current_seq_id: _seq,
                },
            }))
        } catch { /* ignore */ }
    }

    let _initialized = false

    /**
     * Initialize the bridge. Uses an event emitter which does NOT
     * require Instance context — safe to call at server startup.
     */
    export function initialize(bus: EventEmitter): void {
        if (_initialized) return
        _initialized = true

        log.info("initializing mobile bridge")

        bus.on("event", ({ payload }: any) => {
            if (!payload || typeof payload !== "object") return
            const { type, properties: p } = payload as { type: string; properties: Record<string, unknown> }
            if (!type || !p) return

            switch (type) {
                // --- DAG chain events ---
                case "tui.chain.add_step": {
                    const step: DagStep = {
                        name: p.name as string,
                        description: p.description as string,
                        status: "pending",
                        sessionID: (p.sessionID ?? p.sessionId) as string | undefined,
                        agentType: p.agentType as string | undefined,
                        dependsOn: p.dependsOn as string[] | undefined,
                        todos: p.todos as DagStep["todos"],
                    }
                    _dagSteps.set(step.name, step)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: step as unknown as Record<string, unknown> }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.update_step": {
                    // Update by name if provided, otherwise update last running step
                    const name = p.name as string | undefined
                    const status = p.status as string
                    if (name) {
                        const step = _dagSteps.get(name)
                        if (step) step.status = status
                    } else {
                        const steps = Array.from(_dagSteps.values())
                        const last = steps.findLast((s) => s.status === "running" || s.status.endsWith("ing"))
                        if (last) last.status = status
                    }
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.complete_step": {
                    const sessionID = p.sessionID as string | undefined
                    for (const s of Array.from(_dagSteps.values())) {
                        if (!sessionID || s.sessionID === sessionID) {
                            if (s.status !== "complete" && s.status !== "failed") s.status = "complete"
                        }
                    }
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.fail_step": {
                    const sessionID = p.sessionID as string | undefined
                    for (const s of Array.from(_dagSteps.values())) {
                        if (!sessionID || s.sessionID === sessionID) {
                            if (s.status !== "complete" && s.status !== "failed") s.status = "failed"
                        }
                    }
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.set_todos": {
                    const sessionID = p.sessionID as string | undefined
                    const todos = p.todos as DagStep["todos"]
                    for (const s of Array.from(_dagSteps.values())) {
                        if (!sessionID || s.sessionID === sessionID) {
                            s.todos = todos
                        }
                    }
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.todo_done": {
                    const sessionID = p.sessionID as string | undefined
                    const todoIndex = p.todoIndex as number
                    for (const s of Array.from(_dagSteps.values())) {
                        if (!sessionID || s.sessionID === sessionID) {
                            if (s.todos && todoIndex >= 0 && todoIndex < s.todos.length) {
                                const todo = s.todos[todoIndex]
                                if (todo) todo.status = "complete"
                            }
                        }
                    }
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.parallel.update": {
                    const stepIndex = p.stepIndex as number
                    const status = p.status as string
                    const steps = Array.from(_dagSteps.values())
                    const s = steps[stepIndex]
                    if (s) s.status = status
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.start": {
                    // Clear DAG when a new chain starts
                    _dagSteps.clear()
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "tui.chain.clear": {
                    _dagSteps.clear()
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "event", topic: type, payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                // --- Permission events ---
                case "permission.asked": {
                    const perm: PendingPermission = {
                        req_id: p.id as string,
                        sessionID: p.sessionID as string,
                        permission: p.permission as string,
                        patterns: p.patterns as string[],
                        metadata: p.metadata as Record<string, unknown>,
                    }
                    _pendingPermissions.set(perm.req_id, perm)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "permission_request", payload: perm as unknown as Record<string, unknown> }
                    bufferEvent(event)
                    broadcast(event)
                    // Fire ntfy.sh webhook (best-effort, no-op if not configured)
                    NtfyService.notifyPermission({
                        permission: perm.permission,
                        patterns: perm.patterns,
                        sessionID: perm.sessionID,
                        reqId: perm.req_id,
                    }).catch(() => { /* never throw */ })
                    break
                }

                case "permission.replied": {
                    _pendingPermissions.delete(p.requestID as string)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "permission_resolved", payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                // --- Sub-agent events (structured, buffered) ---
                // NOTE: TuiEvent.SubAgentActive publishes `sessionId` (camelCase)
                // but we normalize to `sessionID` (uppercase D) for mobile clients.
                case "tui.subagent.active": {
                    const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
                    const parentSessionID = (p.parentSessionId ?? p.parentSessionID) as string | undefined
                    const agentType = (p.agentType ?? p.agent ?? 'unknown') as string
                    const name = (p.name ?? p.description ?? agentType) as string
                    if (sessionID) {
                        const subAgent: SubAgentSession = {
                            sessionID,
                            parentSessionID,
                            agentType,
                            name,
                            status: 'running',
                            startedAt: Date.now(),
                        }
                        _subAgentSessions.set(sessionID, subAgent)
                        const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_started", payload: subAgent as unknown as Record<string, unknown> }
                        bufferEvent(event)
                        broadcast(event)
                    }
                    break
                }

                case "tui.subagent.done": {
                    const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
                    if (sessionID) {
                        const existing = _subAgentSessions.get(sessionID)
                        if (existing) {
                            existing.status = 'done'
                            existing.finishedAt = Date.now()
                        }
                        const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_done", payload: { sessionID, ...p } }
                        bufferEvent(event)
                        broadcast(event)
                    }
                    break
                }

                case "tui.subagent.reactivate": {
                    const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
                    if (sessionID) {
                        const existing = _subAgentSessions.get(sessionID)
                        if (existing) {
                            existing.status = 'running'
                        }
                        const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_started", payload: { sessionID, ...p } }
                        bufferEvent(event)
                        broadcast(event)
                    }
                    break
                }

                case "tui.subagent.remove": {
                    const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
                    if (sessionID) {
                        _subAgentSessions.delete(sessionID)
                        const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_removed", payload: { sessionID } }
                        bufferEvent(event)
                        broadcast(event)
                    }
                    break
                }

                // --- Message / Part events (relay agent replies in real time) ---
                case "message.part.updated": {
                    // p is { part, delta }
                    const part = p.part as Record<string, unknown>
                    if (!part) break
                    // Only forward text, reasoning, and tool-state events to keep data small
                    const type_ = part.type as string
                    if (type_ === "text" || type_ === "reasoning" || type_ === "tool") {
                        const event: BridgeEvent = {
                            seq_id: nextSeq(),
                            type: "message_part",
                            payload: {
                                part,
                                delta: p.delta as string | undefined,
                            },
                        }
                        bufferEvent(event)
                        broadcast(event)
                    }
                    break
                }

                case "message.updated": {
                    const info = p.info as Record<string, unknown>
                    if (!info) break
                    const event: BridgeEvent = {
                        seq_id: nextSeq(),
                        type: "message_updated",
                        payload: { info },
                    }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                // --- Question events (ask tool) ---
                case "question.asked": {
                    const question: PendingQuestion = {
                        req_id: p.id as string,
                        sessionID: p.sessionID as string,
                        questions: p.questions as PendingQuestion['questions'],
                        tool: p.tool as PendingQuestion['tool'],
                    }
                    _pendingQuestions.set(question.req_id, question)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "question_request", payload: question as unknown as Record<string, unknown> }
                    bufferEvent(event)
                    broadcast(event)
                    // Fire ntfy.sh webhook (best-effort)
                    NtfyService.notifyPermission({
                        permission: 'question',
                        patterns: question.questions.map(q => q.header),
                        sessionID: question.sessionID,
                        reqId: question.req_id,
                    }).catch(() => { /* never throw */ })
                    break
                }

                case "question.replied": {
                    _pendingQuestions.delete(p.requestID as string)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "question_resolved", payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                case "question.rejected": {
                    _pendingQuestions.delete(p.requestID as string)
                    const event: BridgeEvent = { seq_id: nextSeq(), type: "question_resolved", payload: p }
                    bufferEvent(event)
                    broadcast(event)
                    break
                }

                default:
                    // Ignore unknown events
                    break
            }
        })
    }
}
