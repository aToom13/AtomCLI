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
  bridge_epoch?: string
  type: string
  topic?: string
  payload: Record<string, unknown>
}

export interface PendingPermission {
  req_id: string
  sessionID: string
  permission: string
  patterns: string[]
  always: string[]
  directory?: string
  metadata: Record<string, unknown>
}

export interface DagStep {
  stepId?: string
  workflowId?: string
  name: string
  description: string
  status: string
  directory?: string
  sessionID?: string
  agentType?: string
  dependsOn?: string[]
  todos?: { id: string; content: string; status: string }[]
}

export interface SubAgentSession {
  sessionID: string
  parentSessionID?: string
  parentStepId?: string
  directory?: string
  agentType: string
  name: string
  status: "running" | "done" | "failed"
  startedAt: number
  finishedAt?: number
  activities: SubAgentActivity[]
}

export interface SubAgentActivity {
  kind: "tool" | "transcript" | "command"
  label: string
  status?: "pending" | "running" | "completed" | "error"
  output?: string
  time: number
}

export interface PendingQuestion {
  req_id: string
  sessionID: string
  directory?: string
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

export interface CompanionArtifact {
  id: string
  kind: "file" | "image"
  direction: "pc_to_mobile" | "mobile_to_pc"
  sourceDevice: string
  title: string
  name: string
  mime: string
  size: number
  sha256?: string
  createdAt: number
  expiresAt?: number
  sessionID?: string
  downloadPath: string
}

export interface CompanionPreview {
  id: string
  title: string
  command: string
  port: number
  status: "starting" | "running" | "stopped" | "failed"
  endpoints: string[]
  logTail: string
  createdAt: number
  sourceDevice: string
  directory: string
  sessionID?: string
  exitCode?: number
}

type Sender = (data: string) => void

const _clients = new Map<string, Sender>()
let _seq = 0
const _epoch = crypto.randomUUID()
const _bridgeId = crypto.randomUUID()
const STATE_BUFFER_MAX = 200
const _buffer: BridgeEvent[] = []
const _dagSteps = new Map<string, DagStep>()
const _pendingPermissions = new Map<string, PendingPermission>()
const _subAgentSessions = new Map<string, SubAgentSession>()
const _subAgentActivityBroadcastAt = new Map<string, number>()
const _pendingQuestions = new Map<string, PendingQuestion>()
const _artifacts = new Map<string, CompanionArtifact>()
const _previews = new Map<string, CompanionPreview>()
const TRANSFER_STATE_MAX = 100
const MAX_MESSAGE_ERROR_LENGTH = 500
const MAX_SUB_AGENT_ACTIVITIES = 40
const SUB_AGENT_ACTIVITY_BROADCAST_INTERVAL_MS = 750

function shouldReplaceSubAgentActivity(previous: SubAgentActivity | undefined, current: SubAgentActivity): boolean {
  if (!previous || previous.kind !== current.kind) return false
  if (current.kind === "transcript") return true
  return previous.status === "pending" || previous.status === "running"
}

function emitSubAgentActivity(sessionID: string, activity: SubAgentActivity): void {
  const event: BridgeEvent = {
    seq_id: nextSeq(),
    type: "sub_agent_activity",
    payload: { sessionID, ...activity },
  }
  bufferEvent(event)
  broadcast(event)
  _subAgentActivityBroadcastAt.set(`${sessionID}:${activity.kind}`, Date.now())
}

function redactMessageError(value: string): string {
  let result = value.replace(/[\r\n\t]+/g, " ").trim()
  result = result.replace(/\bbearer\s+[^\s,;]+/gi, "Bearer <redacted>")
  result = result.replace(
    /\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    (_match, key: string) => `${key}=<redacted>`,
  )
  result = result.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw)
      url.username = ""
      url.password = ""
      url.search = ""
      url.hash = ""
      return url.toString()
    } catch {
      return "<redacted-url>"
    }
  })
  return result.slice(0, MAX_MESSAGE_ERROR_LENGTH)
}

function safeMessageError(error: unknown): Record<string, unknown> {
  const source = error && typeof error === "object" ? (error as Record<string, unknown>) : {}
  const data = source.data && typeof source.data === "object" ? (source.data as Record<string, unknown>) : source
  const rawMessage = typeof data.message === "string" ? data.message : "AtomCLI could not generate a response."
  return {
    name: typeof source.name === "string" ? source.name.slice(0, 100) : "UnknownError",
    data: {
      message: redactMessageError(rawMessage),
      ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
      isRetryable: data.isRetryable === true,
    },
  }
}

function nextSeq(): number {
  return ++_seq
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > TRANSFER_STATE_MAX) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function dagKey(step: DagStep): string {
  return `${step.directory ?? ""}\u0000${step.workflowId ?? ""}\u0000${step.sessionID ?? ""}\u0000${step.stepId ?? step.name}`
}

function dagMatches(
  step: DagStep,
  directory: string | undefined,
  sessionID?: string,
  name?: string,
  workflowId?: string,
): boolean {
  if (directory && step.directory !== directory) return false
  if (sessionID && step.sessionID !== sessionID) return false
  if (name && step.name !== name) return false
  if (workflowId && step.workflowId !== workflowId) return false
  return true
}

function dagPayload(properties: Record<string, unknown>, directory: string | undefined) {
  const sessionID = properties.sessionID ?? properties.sessionId
  return {
    ...properties,
    ...(sessionID ? { sessionID } : {}),
    ...(directory ? { directory } : {}),
  }
}

function clearDag(directory: string | undefined, workflowId?: string, sessionID?: string) {
  if (!directory && !workflowId && !sessionID) {
    _dagSteps.clear()
    return
  }
  for (const [key, step] of _dagSteps) {
    if (dagMatches(step, directory, sessionID, undefined, workflowId)) _dagSteps.delete(key)
  }
}

function bufferEvent(event: BridgeEvent): void {
  event.bridge_epoch = _epoch
  _buffer.push(event)
  if (_buffer.length > STATE_BUFFER_MAX) _buffer.shift()
}

function broadcast(event: BridgeEvent): void {
  event.bridge_epoch = _epoch
  const msg = JSON.stringify(event)
  for (const [, send] of Array.from(_clients)) {
    try {
      send(msg)
    } catch {
      /* ignore */
    }
  }
}

export namespace MobileBridge {
  export function sanitizeMessageError(error: unknown): Record<string, unknown> {
    return safeMessageError(error)
  }

  export function bridgeId(): string {
    return _bridgeId
  }

  export function epoch(): string {
    return _epoch
  }

  export function connectedClientCount(): number {
    return _clients.size
  }

  export function registerClient(clientId: string, send: Sender): void {
    _clients.set(clientId, send)
  }

  export function unregisterClient(clientId: string): void {
    _clients.delete(clientId)
  }

  export function replacePendingPermissions(permissions: PendingPermission[]): void {
    _pendingPermissions.clear()
    for (const permission of permissions) _pendingPermissions.set(permission.req_id, permission)
  }

  export function replacePendingQuestions(questions: PendingQuestion[]): void {
    _pendingQuestions.clear()
    for (const question of questions) _pendingQuestions.set(question.req_id, question)
  }

  export function replayMissed(
    clientId: string,
    lastSeqId: number,
    bridgeEpoch?: string,
  ): "replayed" | "epoch_mismatch" | "cursor_ahead" | "buffer_gap" | "client_missing" {
    const send = _clients.get(clientId)
    if (!send) return "client_missing"
    if (bridgeEpoch && bridgeEpoch !== _epoch) return "epoch_mismatch"
    if (lastSeqId > _seq) return "cursor_ahead"
    const oldest = _buffer[0]?.seq_id
    if (lastSeqId < _seq && (oldest === undefined || lastSeqId < oldest - 1)) return "buffer_gap"
    for (const event of _buffer.filter((e) => e.seq_id > lastSeqId)) {
      try {
        send(JSON.stringify(event))
      } catch {
        /* ignore */
      }
    }
    return "replayed"
  }

  export function sendSnapshot(clientId: string): void {
    const send = _clients.get(clientId)
    if (!send) return
    try {
      send(
        JSON.stringify({
          type: "snapshot",
          bridge_epoch: _epoch,
          payload: {
            bridge_epoch: _epoch,
            snapshot_id: crypto.randomUUID(),
            generated_at: Date.now(),
            cursor: { bridge_epoch: _epoch, seq_id: _seq },
            dag: Array.from(_dagSteps.values()),
            pending_permissions: Array.from(_pendingPermissions.values()),
            sub_agents: Array.from(_subAgentSessions.values()),
            pending_questions: Array.from(_pendingQuestions.values()),
            artifacts: Array.from(_artifacts.values()),
            previews: Array.from(_previews.values()),
            current_seq_id: _seq,
          },
        }),
      )
    } catch {
      /* ignore */
    }
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

    bus.on("event", ({ payload, directory }: any) => {
      if (!payload || typeof payload !== "object") return
      const { type, properties: p } = payload as { type: string; properties: Record<string, unknown> }
      if (!type || !p) return

      switch (type) {
        case "companion.artifact.shared": {
          const artifact = p as unknown as CompanionArtifact
          boundedSet(_artifacts, artifact.id, artifact)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "artifact_shared",
            payload: artifact as unknown as Record<string, unknown>,
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "companion.artifact.deleted": {
          const id = p.id as string
          _artifacts.delete(id)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "artifact_deleted",
            payload: { id },
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "companion.preview.updated": {
          const preview = p as unknown as CompanionPreview
          boundedSet(_previews, preview.id, preview)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "preview_updated",
            payload: preview as unknown as Record<string, unknown>,
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        // --- DAG chain events ---
        case "tui.chain.add_step": {
          const step: DagStep = {
            stepId: p.stepId as string | undefined,
            workflowId: p.workflowId as string | undefined,
            name: p.name as string,
            description: p.description as string,
            status: "pending",
            directory: directory as string | undefined,
            sessionID: (p.sessionID ?? p.sessionId) as string | undefined,
            agentType: p.agentType as string | undefined,
            dependsOn: p.dependsOn as string[] | undefined,
            todos: p.todos as DagStep["todos"],
          }
          boundedSet(_dagSteps, dagKey(step), step)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: step as unknown as Record<string, unknown>,
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.update_step": {
          // Update by name if provided, otherwise update last running step
          const name = p.name as string | undefined
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const workflowId = p.workflowId as string | undefined
          const status = p.status as string
          if (name) {
            const step = Array.from(_dagSteps.values()).findLast((candidate) =>
              dagMatches(candidate, directory as string | undefined, sessionID, name, workflowId),
            )
            if (step) step.status = status
          } else {
            const steps = Array.from(_dagSteps.values()).filter((step) =>
              dagMatches(step, directory as string | undefined, sessionID, undefined, workflowId),
            )
            const last = steps.findLast((s) => s.status === "running" || s.status.endsWith("ing"))
            if (last) last.status = status
          }
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.complete_step": {
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const workflowId = p.workflowId as string | undefined
          for (const s of Array.from(_dagSteps.values())) {
            if (dagMatches(s, directory as string | undefined, sessionID, undefined, workflowId)) {
              if (s.status !== "complete" && s.status !== "failed") s.status = "complete"
            }
          }
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.fail_step": {
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const workflowId = p.workflowId as string | undefined
          for (const s of Array.from(_dagSteps.values())) {
            if (dagMatches(s, directory as string | undefined, sessionID, undefined, workflowId)) {
              if (s.status !== "complete" && s.status !== "failed") s.status = "failed"
            }
          }
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.set_todos": {
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const workflowId = p.workflowId as string | undefined
          const todos = p.todos as DagStep["todos"]
          for (const s of Array.from(_dagSteps.values())) {
            if (dagMatches(s, directory as string | undefined, sessionID, undefined, workflowId)) {
              s.todos = todos
            }
          }
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.todo_done": {
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const workflowId = p.workflowId as string | undefined
          const todoIndex = p.todoIndex as number
          for (const s of Array.from(_dagSteps.values())) {
            if (dagMatches(s, directory as string | undefined, sessionID, undefined, workflowId)) {
              if (s.todos && todoIndex >= 0 && todoIndex < s.todos.length) {
                const todo = s.todos[todoIndex]
                if (todo) todo.status = "complete"
              }
            }
          }
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.parallel.update": {
          const stepIndex = p.stepIndex as number
          const status = p.status as string
          const workflowId = p.workflowId as string | undefined
          const sessionID = (p.sessionID ?? p.sessionId) as string | undefined
          const steps = Array.from(_dagSteps.values()).filter((step) =>
            dagMatches(step, directory as string | undefined, sessionID, undefined, workflowId),
          )
          const s = steps[stepIndex]
          if (s) s.status = status
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.start": {
          // A chain belongs to one project. Starting it must not erase activity
          // cards from another project served by the same Companion process.
          clearDag(
            directory as string | undefined,
            p.workflowId as string | undefined,
            (p.sessionID ?? p.sessionId) as string | undefined,
          )
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "tui.chain.clear": {
          clearDag(
            directory as string | undefined,
            p.workflowId as string | undefined,
            (p.sessionID ?? p.sessionId) as string | undefined,
          )
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "event",
            topic: type,
            payload: dagPayload(p, directory as string | undefined),
          }
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
            always: (p.always as string[]) ?? [],
            directory: directory as string | undefined,
            metadata: p.metadata as Record<string, unknown>,
          }
          _pendingPermissions.set(perm.req_id, perm)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "permission_request",
            payload: perm as unknown as Record<string, unknown>,
          }
          bufferEvent(event)
          broadcast(event)
          // Fire ntfy.sh webhook (best-effort, no-op if not configured)
          NtfyService.notifyPermission({
            permission: perm.permission,
            patterns: perm.patterns,
            sessionID: perm.sessionID,
            reqId: perm.req_id,
          }).catch(() => {
            /* never throw */
          })
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
          const parentStepId = p.parentStepId as string | undefined
          const agentType = (p.agentType ?? p.agent ?? "unknown") as string
          const name = (p.name ?? p.description ?? agentType) as string
          if (sessionID) {
            const subAgent: SubAgentSession = {
              sessionID,
              parentSessionID,
              parentStepId,
              directory: directory as string | undefined,
              agentType,
              name,
              status: "running",
              startedAt: Date.now(),
              activities: [],
            }
            boundedSet(_subAgentSessions, sessionID, subAgent)
            const event: BridgeEvent = {
              seq_id: nextSeq(),
              type: "sub_agent_started",
              payload: subAgent as unknown as Record<string, unknown>,
            }
            bufferEvent(event)
            broadcast(event)
          }
          break
        }

        case "tui.subagent.activity": {
          const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
          const existing = sessionID ? _subAgentSessions.get(sessionID) : undefined
          if (sessionID && existing) {
            const activity: SubAgentActivity = {
              kind: p.kind as SubAgentActivity["kind"],
              label: p.label as string,
              status: p.status as SubAgentActivity["status"],
              output: p.output as string | undefined,
              time: (p.time as number | undefined) ?? Date.now(),
            }
            const previous = existing.activities.at(-1)
            existing.activities = shouldReplaceSubAgentActivity(previous, activity)
              ? [...existing.activities.slice(0, -1), activity]
              : [...existing.activities, activity].slice(-MAX_SUB_AGENT_ACTIVITIES)
            const broadcastKey = `${sessionID}:${activity.kind}`
            const lastBroadcastAt = _subAgentActivityBroadcastAt.get(broadcastKey) ?? 0
            const terminal = activity.status === "completed" || activity.status === "error"
            if (terminal || Date.now() - lastBroadcastAt >= SUB_AGENT_ACTIVITY_BROADCAST_INTERVAL_MS) {
              emitSubAgentActivity(sessionID, activity)
            }
          }
          break
        }

        case "tui.subagent.done": {
          const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
          if (sessionID) {
            const existing = _subAgentSessions.get(sessionID)
            if (existing) {
              const latest = existing.activities.at(-1)
              if (latest?.kind === "transcript") emitSubAgentActivity(sessionID, latest)
              existing.status = "done"
              existing.finishedAt = Date.now()
            }
            const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_done", payload: { sessionID, ...p } }
            bufferEvent(event)
            broadcast(event)
          }
          break
        }

        case "tui.subagent.failed": {
          const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
          if (sessionID) {
            const existing = _subAgentSessions.get(sessionID)
            if (existing) {
              existing.status = "failed"
              existing.finishedAt = Date.now()
            }
            const event: BridgeEvent = {
              seq_id: nextSeq(),
              type: "sub_agent_failed",
              payload: { sessionID, ...p },
            }
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
              existing.status = "running"
              existing.finishedAt = undefined
              existing.activities ??= []
              existing.parentSessionID =
                ((p.parentSessionId ?? p.parentSessionID) as string | undefined) ?? existing.parentSessionID
              existing.parentStepId = (p.parentStepId as string | undefined) ?? existing.parentStepId
            }
            const event: BridgeEvent = {
              seq_id: nextSeq(),
              type: "sub_agent_started",
              payload: (existing ?? { sessionID, ...p }) as Record<string, unknown>,
            }
            bufferEvent(event)
            broadcast(event)
          }
          break
        }

        case "tui.subagent.remove": {
          const sessionID = (p.sessionId ?? p.sessionID) as string | undefined
          if (sessionID) {
            _subAgentSessions.delete(sessionID)
            for (const kind of ["tool", "command", "transcript"]) {
              _subAgentActivityBroadcastAt.delete(`${sessionID}:${kind}`)
            }
            const event: BridgeEvent = { seq_id: nextSeq(), type: "sub_agent_removed", payload: { sessionID } }
            bufferEvent(event)
            broadcast(event)
          }
          break
        }

        // --- Message / Part events (relay agent replies in real time) ---
        case "message.part.updated": {
          // Full message history remains authoritative on disk and is fetched
          // when a phone reconnects. Avoid allocating, serializing and
          // buffering every streaming token while nobody is listening.
          if (_clients.size === 0) break
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
          const safeInfo = info.error ? { ...info, error: sanitizeMessageError(info.error) } : info
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "message_updated",
            payload: { info: safeInfo },
          }
          bufferEvent(event)
          broadcast(event)
          break
        }

        case "session.status": {
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "session_status",
            payload: p,
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
            directory: directory as string | undefined,
            questions: p.questions as PendingQuestion["questions"],
            tool: p.tool as PendingQuestion["tool"],
          }
          _pendingQuestions.set(question.req_id, question)
          const event: BridgeEvent = {
            seq_id: nextSeq(),
            type: "question_request",
            payload: question as unknown as Record<string, unknown>,
          }
          bufferEvent(event)
          broadcast(event)
          // Fire ntfy.sh webhook (best-effort)
          NtfyService.notifyPermission({
            permission: "question",
            patterns: question.questions.map((q) => q.header),
            sessionID: question.sessionID,
            reqId: question.req_id,
          }).catch(() => {
            /* never throw */
          })
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
