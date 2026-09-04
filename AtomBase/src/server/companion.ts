import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { describeRoute, resolver, validator } from "hono-openapi"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import {
  CompanionAuth,
  CompanionAudit,
  CompanionIdentity,
  CompanionProtocol as CompanionWireProtocol,
  MobileBridge,
  PermissionMutex,
} from "@atomcli/companion"
import { PermissionNext } from "@/util/permission/next"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { GlobalBus } from "@/core/bus/global"
import { Bus } from "@/core/bus"
import { Log } from "@/util/util/log"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { InstanceBootstrap } from "@/services/project/bootstrap"
import { Project } from "@/services/project/project"
import { Filesystem } from "@/util/util/filesystem"
import { Agent } from "@/integrations/agent/agent"
import { Config } from "@/core/config/config"
import { Question } from "@/interfaces/question"
import { SessionTermination } from "@/core/session/termination"
import { SessionStatus } from "@/core/session/status"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { SessionSummary } from "@/core/session/summary"
import { MemoryLifecycle } from "@/core/memory/services/lifecycle"
import { CompanionTransfer } from "@/services/companion/transfer"
import { CompanionProtocol } from "./companion-protocol"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"

const log = Log.create({ service: "companion-ws" })
const MAX_ACTIVE_DEVICES = 100
const ACTION_RESULT_TTL_MS = 15 * 60_000
const ACTION_RESULT_MAX = 1_000
const ACTIVE_DEVICE_CONNECTIONS = new Map<string, { clientId: string; close: (reason: string) => void }>()
const ACTION_RESULTS = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>()
const ACTIVE_ACTIONS = new Map<string, number>()
const MOBILE_SYSTEM_CONTEXT =
  "This user message was sent from the AtomCLI Android Companion. Use a fast, risk-proportionate execution profile: for low-risk prototypes and routine changes, prefer direct work or at most one implementation sub-agent, run one focused verification, do not spawn reviewer/checker agents manually, and return the useful result immediately. Independent review remains required for security-, authorization-, migration-, release-, or data-integrity-sensitive work. Treat this as a fresh user turn; do not resume unfinished plans or verification from an earlier request unless this message explicitly asks you to."
const AUDITED_ACTIONS = new Set([
  "permission_resolve",
  "question_reply",
  "question_reject",
  "abort_session",
  "pause_session",
  "delete_session",
  "artifact_delete",
  "preview_stop",
  "unpair",
])

function diagnosticError(error: unknown) {
  if (!(error instanceof Error)) return { kind: typeof error }
  const code = (error as Error & { code?: unknown }).code
  return {
    name: error.name.slice(0, 64),
    ...(typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code) ? { code } : {}),
  }
}

function actionResult(
  ws: any,
  action: string,
  msg: { client_request_id?: string; device_id?: string; device_name?: string },
  result: { status: "ok" | "conflict" | "error"; id?: string; error?: string; [key: string]: unknown },
  cache = true,
) {
  const payload = {
    type: "action_result",
    action,
    client_request_id: msg.client_request_id,
    ...result,
  }
  if (AUDITED_ACTIONS.has(action)) {
    const identity = msg as { device_id?: string; device_name?: string }
    const claimedIdentity = identity.device_id ?? identity.device_name ?? "unknown-device"
    const registeredDevice = CompanionAuth.getDevice(claimedIdentity)
    CompanionAudit.record({
      action,
      outcome: result.status,
      deviceId: registeredDevice?.deviceId ?? claimedIdentity,
      errorCode: result.error,
    })
  }
  if (cache) sendIdempotent(ws, msg, payload)
  else ws.send(JSON.stringify(payload))
}

function actionKey(msg: { client_request_id?: string; device_id?: string; device_name?: string }) {
  if (!msg.client_request_id) return undefined
  const device = msg.device_id ?? msg.device_name
  return device ? `${device}:${msg.client_request_id}` : undefined
}

function cachedAction(msg: { client_request_id?: string; device_id?: string; device_name?: string }) {
  const key = actionKey(msg)
  if (!key) return undefined
  const cached = ACTION_RESULTS.get(key)
  if (!cached) return undefined
  if (cached.expiresAt > Date.now()) return cached.payload
  ACTION_RESULTS.delete(key)
  return undefined
}

function beginAction(msg: { client_request_id?: string; device_id?: string; device_name?: string }) {
  const key = actionKey(msg)
  if (!key) return "new" as const
  const startedAt = ACTIVE_ACTIONS.get(key)
  if (startedAt && Date.now() - startedAt < 30_000) return "active" as const
  ACTIVE_ACTIONS.set(key, Date.now())
  return "new" as const
}

function sendIdempotent(
  ws: any,
  msg: { client_request_id?: string; device_id?: string; device_name?: string },
  payload: Record<string, unknown>,
) {
  const key = actionKey(msg)
  if (key) {
    ACTIVE_ACTIONS.delete(key)
    ACTION_RESULTS.delete(key)
    ACTION_RESULTS.set(key, { expiresAt: Date.now() + ACTION_RESULT_TTL_MS, payload })
    while (ACTION_RESULTS.size > ACTION_RESULT_MAX) {
      const oldest = ACTION_RESULTS.keys().next().value
      if (!oldest) break
      ACTION_RESULTS.delete(oldest)
    }
  }
  ws.send(JSON.stringify(payload))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function knownDirectories(current: string) {
  const projects = await Project.list().catch(() => [])
  const directories = new Set<string>()
  for (const candidate of [current, ...projects.flatMap((project) => [project.worktree, ...project.sandboxes])]) {
    if (!candidate) continue
    try {
      const resolved = await fs.realpath(candidate)
      if ((await fs.stat(resolved)).isDirectory()) directories.add(resolved)
    } catch {
      // Stale project history must not break every Companion session list.
    }
  }
  return Array.from(directories)
}

async function resolveCompanionDirectory(candidate: string | undefined, fallback: string) {
  const requested = candidate ? path.resolve(candidate) : fallback
  const home = await fs.realpath(os.homedir())
  const resolved = await fs.realpath(requested)
  const current = await fs.realpath(fallback)
  const projectRoots = await knownDirectories(current)
  if (
    !Filesystem.contains(home, resolved) &&
    !projectRoots.some((projectRoot) => Filesystem.contains(projectRoot, resolved))
  ) {
    throw new Error("Directory must be inside the user's home folder or a known AtomCLI workspace")
  }
  const stat = await fs.stat(resolved)
  if (!stat.isDirectory()) throw new Error("Selected path is not a directory")
  return resolved
}

async function inDirectory<R>(candidate: string | undefined, fallback: string, fn: () => R) {
  const selected = await resolveCompanionDirectory(candidate, fallback)
  return Instance.provide({ directory: selected, init: InstanceBootstrap, fn })
}

async function companionEndpoints(port: number) {
  const { CompanionDiscovery } = await import("@atomcli/companion")
  const endpoints = CompanionDiscovery.detectEndpoints(port).map((item) => item.url)
  const magicDNS = await CompanionDiscovery.getTailscaleMagicDNS()
  if (magicDNS) endpoints.push(`ws://${magicDNS}:${port}/companion/ws`)
  return Array.from(new Set(endpoints))
}

async function sendSessionList(ws: any, currentDirectory = Instance.directory) {
  try {
    const sessions = new Map<
      string,
      { id: string; title: string; updated: number; directory: string; status: string }
    >()
    for (const directory of await knownDirectories(currentDirectory)) {
      await Instance.provide({
        directory,
        fn: async () => {
          for await (const s of Session.list()) {
            sessions.set(s.id, {
              id: s.id,
              title: s.title,
              updated: s.time.updated,
              directory: s.directory,
              status: SessionStatus.get(s.id).type,
            })
          }
        },
      })
    }
    const sorted = Array.from(sessions.values()).sort((a, b) => b.updated - a.updated)
    ws.send(JSON.stringify({ type: "session_list", sessions: sorted, current_directory: currentDirectory }))
  } catch (err) {
    log.error("failed to send session list", { error: diagnosticError(err) })
  }
}

async function sendModelList(ws: any) {
  try {
    const connected = await Provider.list()
    const models = []
    for (const [providerId, provider] of Object.entries(connected)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        models.push({
          id: `${providerId}/${modelId}`,
          name: model.name,
          providerId,
          providerName: provider.name,
          family: model.family,
          status: model.status,
          free: model.cost.input === 0 && model.cost.output === 0,
          cost: { input: model.cost.input, output: model.cost.output },
          limit: { context: model.limit.context, output: model.limit.output },
          reasoning: model.capabilities.reasoning,
          capabilities: {
            tools: model.capabilities.toolcall,
            images: model.capabilities.input.image,
            pdf: model.capabilities.input.pdf,
            audio: model.capabilities.input.audio,
            video: model.capabilities.input.video,
          },
          variants: Object.keys(model.variants ?? {}),
        })
      }
    }
    models.sort((a, b) => {
      if (a.providerId === "atomcli" && b.providerId !== "atomcli") return -1
      if (b.providerId === "atomcli" && a.providerId !== "atomcli") return 1
      if (a.providerName !== b.providerName) return a.providerName.localeCompare(b.providerName)
      if (a.free !== b.free) return a.free ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    // Resolve the server-configured default model so mobile can pre-select it
    let default_model: string | undefined
    try {
      const cfg = await Config.get()
      default_model = cfg.model ?? undefined
    } catch {
      /* non-fatal */
    }

    ws.send(JSON.stringify({ type: "models_list", models, default_model }))
  } catch (err) {
    log.error("failed to send model list", { error: diagnosticError(err) })
  }
}

async function sendAgentList(ws: any) {
  try {
    const agents = await Agent.list()
    const agentInfos = agents.map((a) => ({
      name: a.name,
      description: a.description,
      mode: a.mode,
      hidden: a.hidden,
    }))
    ws.send(JSON.stringify({ type: "agents_list", agents: agentInfos }))
  } catch (err) {
    log.error("failed to send agent list", { error: diagnosticError(err) })
  }
}

async function sendBridgeSnapshot(clientId: string) {
  const permissions = []
  const questions = []
  for (const directory of await knownDirectories(Instance.directory)) {
    await Instance.provide({
      directory,
      fn: async () => {
        permissions.push(
          ...(await PermissionNext.list()).map((permission) => ({
            req_id: permission.id,
            sessionID: permission.sessionID,
            permission: permission.permission,
            patterns: permission.patterns,
            always: permission.always,
            directory,
            metadata: permission.metadata,
          })),
        )
        questions.push(
          ...(await Question.list()).map((question) => ({
            req_id: question.id,
            sessionID: question.sessionID,
            directory,
            questions: question.questions,
            tool: question.tool,
          })),
        )
      },
    })
  }
  MobileBridge.replacePendingPermissions(permissions)
  MobileBridge.replacePendingQuestions(questions)
  MobileBridge.sendSnapshot(clientId)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const CompanionRoute = new Hono()
  .get(
    "/companion/ws",
    upgradeWebSocket((c) => {
      const clientId = `companion_${crypto.randomUUID().slice(0, 8)}`
      const directory = Instance.directory
      const challenge = crypto.randomUUID()
      const challengeExpiresAt = Date.now() + CompanionProtocol.CHALLENGE_TTL_MS
      const machine = CompanionIdentity.machine()
      const identity: CompanionWireProtocol.PeerIdentity = {
        machine_id: machine.machineId,
        process_id: CompanionIdentity.processId(),
        bridge_id: MobileBridge.bridgeId(),
      }
      const authenticatedIdentity: CompanionWireProtocol.PeerIdentity = {
        ...identity,
        machine_name: machine.machineName,
        project_directory: directory,
      }
      const requestPort = Number(new URL(c.req.url).port) || 4096
      let connection: CompanionProtocol.ConnectionState | undefined
      let registered = false
      log.info("client connecting", { clientId })

      // Ensure the Mobile Bridge has been initialized
      MobileBridge.initialize(GlobalBus)

      return {
        onOpen(_evt, ws) {
          log.info("client connected; awaiting authentication", { clientId })
          ws.send(
            JSON.stringify({
              type: "auth_challenge",
              protocol: CompanionWireProtocol.CURRENT_VERSION,
              protocol_version: CompanionWireProtocol.CURRENT_VERSION,
              protocol_min: CompanionWireProtocol.MIN_VERSION,
              capabilities: CompanionWireProtocol.CAPABILITIES,
              identity,
              challenge,
              expires_at: challengeExpiresAt,
            }),
          )
        },

        async onMessage(evt, ws) {
          await Instance.provide({
            directory,
            fn: async () => {
              let parsed: unknown
              try {
                parsed = JSON.parse(String(evt.data))
              } catch {
                ws.send(JSON.stringify({ error: "invalid_json" }))
                return
              }

              const result = CompanionWireProtocol.InboundMessage.safeParse(parsed)
              if (!result.success) {
                log.error("inbound message validation failed", {
                  issues: result.error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
                  messageType:
                    typeof parsed === "object" && parsed !== null && "type" in parsed
                      ? String((parsed as { type?: unknown }).type).slice(0, 64)
                      : "unknown",
                })
                ws.send(JSON.stringify({ error: "unknown_message_type", detail: result.error.message }))
                return
              }

              const msg = result.data

              if (msg.type === "authenticate") {
                if (connection) {
                  ws.send(JSON.stringify({ error: "already_authenticated" }))
                  return
                }
                const error = CompanionProtocol.verifyAuthentication(msg, challenge, challengeExpiresAt)
                if (error) {
                  ws.send(JSON.stringify({ error }))
                  return
                }
                const protocolVersion = CompanionWireProtocol.negotiateVersion(msg.protocol_version)
                if (!protocolVersion) {
                  ws.send(
                    JSON.stringify({
                      error: "unsupported_protocol",
                      protocol_min: CompanionWireProtocol.MIN_VERSION,
                      protocol_max: CompanionWireProtocol.CURRENT_VERSION,
                    }),
                  )
                  return
                }
                const capabilities = CompanionWireProtocol.negotiateCapabilities(msg.capabilities)
                const deviceId = msg.device_id ?? msg.device_name
                if (msg.device_id && !CompanionAuth.bindDeviceId(msg.device_name, msg.device_id)) {
                  ws.send(JSON.stringify({ error: "device_identity_conflict" }))
                  return
                }
                const previous = ACTIVE_DEVICE_CONNECTIONS.get(deviceId)
                if (previous && previous.clientId !== clientId) {
                  log.info("replacing existing device connection", {
                    device: msg.device_name,
                    previousClientId: previous.clientId,
                    clientId,
                  })
                  MobileBridge.unregisterClient(previous.clientId)
                  previous.close("connection_replaced")
                }
                if (!ACTIVE_DEVICE_CONNECTIONS.has(deviceId) && ACTIVE_DEVICE_CONNECTIONS.size >= MAX_ACTIVE_DEVICES) {
                  const oldest = ACTIVE_DEVICE_CONNECTIONS.entries().next().value
                  if (oldest) {
                    ACTIVE_DEVICE_CONNECTIONS.delete(oldest[0])
                    MobileBridge.unregisterClient(oldest[1].clientId)
                    oldest[1].close("connection_capacity")
                  }
                }
                connection = {
                  deviceName: msg.device_name,
                  deviceId,
                  connectionId: crypto.randomUUID(),
                  lastCounter: 0,
                }
                ACTIVE_DEVICE_CONNECTIONS.set(deviceId, {
                  clientId,
                  close(reason) {
                    try {
                      ws.send(JSON.stringify({ type: "connection_replaced", reason }))
                    } finally {
                      const raw = ws.raw as { terminate?: () => void } | undefined
                      if (raw?.terminate) raw.terminate()
                      else ws.close(4001, reason)
                    }
                  },
                })
                MobileBridge.registerClient(clientId, (data) => {
                  try {
                    ws.send(data)
                  } catch (err) {
                    log.error("send failed", { clientId, error: diagnosticError(err) })
                  }
                })
                registered = true
                ws.send(
                  JSON.stringify({
                    type: "auth_ok",
                    protocol_version: protocolVersion,
                    capabilities,
                    identity: authenticatedIdentity,
                    bridge_epoch: MobileBridge.epoch(),
                    connection_id: connection.connectionId,
                    endpoints: await companionEndpoints(requestPort),
                  }),
                )
                await sendBridgeSnapshot(clientId)
                await Promise.allSettled([sendSessionList(ws), sendModelList(ws), sendAgentList(ws)])
                return
              }

              if (!connection) {
                ws.send(JSON.stringify({ error: "authentication_required" }))
                return
              }

              if ("signature" in msg) {
                const error = CompanionProtocol.verifyMutation(
                  parsed as CompanionProtocol.SignedMutation & Record<string, unknown>,
                  connection,
                )
                if (error) {
                  actionResult(ws, msg.type, msg, { status: "error", error }, false)
                  return
                }
                connection.lastCounter = msg.counter
                const cached = cachedAction(msg)
                if (cached) {
                  ws.send(JSON.stringify(cached))
                  return
                }
                if (beginAction(msg) === "active") {
                  ws.send(
                    JSON.stringify({
                      type: "action_result",
                      action: msg.type,
                      client_request_id: msg.client_request_id,
                      status: "conflict",
                      error: "request_in_progress",
                    }),
                  )
                  return
                }
              }

              switch (msg.type) {
                case "ping": {
                  ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }))
                  break
                }

                case "sync": {
                  log.info("sync requested", { clientId, last_seq_id: msg.last_seq_id })
                  // Replay any buffered events the client missed since last_seq_id
                  const replay = MobileBridge.replayMissed(
                    clientId,
                    msg.cursor?.seq_id ?? msg.last_seq_id,
                    msg.cursor?.bridge_epoch ?? msg.bridge_epoch,
                  )
                  if (replay !== "replayed") {
                    ws.send(
                      JSON.stringify({
                        type: "resync_required",
                        reason: replay,
                        bridge_epoch: MobileBridge.epoch(),
                        snapshot_follows: true,
                      }),
                    )
                  }
                  // Re-send snapshot so pending_questions/permissions are visible
                  // immediately after reconnect (onOpen may not have completed yet).
                  // Do NOT re-send model/agent lists here — they're sent in onOpen.
                  await sendBridgeSnapshot(clientId)
                  await sendSessionList(ws)
                  break
                }

                case "request_snapshot": {
                  log.info("snapshot requested", { clientId })
                  await sendBridgeSnapshot(clientId)
                  await sendSessionList(ws)
                  await sendModelList(ws)
                  await sendAgentList(ws)
                  break
                }

                case "permission_resolve": {
                  // Acquire mutex — prevent TUI race condition
                  const acquired = PermissionMutex.acquire(msg.id, "companion")
                  if (!acquired) {
                    actionResult(ws, msg.type, msg, {
                      status: "conflict",
                      id: msg.id,
                      error: "Already handled on another client",
                    })
                    return
                  }

                  try {
                    const reply: PermissionNext.Reply =
                      msg.resolution === "allow_always"
                        ? "always"
                        : msg.resolution === "allow" ||
                            msg.resolution === "allow_once" ||
                            msg.resolution === "autonomous"
                          ? "once"
                          : "reject"
                    const message = msg.resolution === "intervene" ? (msg.intervention_params ?? undefined) : undefined
                    await inDirectory(msg.directory, directory, async () => {
                      if (msg.resolution === "autonomous") {
                        const pending = (await PermissionNext.list()).find((permission) => permission.id === msg.id)
                        if (!pending) throw new Error("Permission request is no longer pending")
                        await Session.update(pending.sessionID, (session) => {
                          session.permission = [
                            ...(session.permission ?? []),
                            { permission: "*", pattern: "*", action: "allow" },
                          ]
                        })
                      }
                      const handled = await PermissionNext.reply({ requestID: msg.id, reply, message })
                      if (!handled) throw new Error("Permission request is no longer pending")
                    })
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.id })
                  } catch (err) {
                    PermissionMutex.release(msg.id)
                    log.error("failed to resolve permission", { id: msg.id, error: diagnosticError(err) })
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.id,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  }
                  break
                }

                case "command": {
                  log.info("command received", { action: msg.action })
                  actionResult(ws, msg.type, msg, {
                    status: "error",
                    error: "unsupported_command",
                    requested_action: msg.action,
                  })
                  break
                }

                case "chat_message": {
                  log.info("chat message received", {
                    session_id: msg.session_id,
                    textLength: msg.text.length,
                    attachmentCount: msg.attachments?.length ?? 0,
                  })

                  let parsedModel = undefined
                  if (msg.model) {
                    const p = msg.model.indexOf("/")
                    if (p > 0)
                      parsedModel = { providerID: msg.model.substring(0, p), modelID: msg.model.substring(p + 1) }
                  }

                  await inDirectory(msg.directory, directory, async () => {
                    SessionExecutionProfile.set(msg.session_id, "companion-fast")
                    const attachmentParts = await CompanionTransfer.promptParts({
                      artifactIDs: msg.attachments ?? [],
                      sessionID: msg.session_id,
                      model: msg.model,
                    })
                    SessionPrompt.prompt({
                      sessionID: msg.session_id,
                      parts: [{ type: "text", text: msg.text }, ...attachmentParts],
                      model: parsedModel,
                      agent: msg.agent,
                      variant: msg.variant,
                      system: MOBILE_SYSTEM_CONTEXT,
                    }).catch((err) => {
                      log.error("failed to inject chat prompt", {
                        session_id: msg.session_id,
                        error: diagnosticError(err),
                      })
                      try {
                        const errMsg = err instanceof Error ? err.message : String(err)
                        const safeError = MobileBridge.sanitizeMessageError(err)
                        const safeData = safeError.data as Record<string, unknown>
                        const isRateLimit =
                          errMsg.includes("429") ||
                          errMsg.includes("Rate limit") ||
                          errMsg.includes("FreeUsageLimitError")
                        const retryAfterMatch =
                          errMsg.match(/retry.after["\s:]+([\d]+)/i) ??
                          JSON.stringify(err).match(/retry-after["\s:]+"?([\d]+)/i)
                        const retryAfterSec = retryAfterMatch ? parseInt(retryAfterMatch[1]) : null
                        const retryMsg = retryAfterSec
                          ? ` Retry in ${Math.floor(retryAfterSec / 3600)}h ${Math.floor((retryAfterSec % 3600) / 60)}m.`
                          : ""
                        ws.send(
                          JSON.stringify({
                            type: "prompt_error",
                            session_id: msg.session_id,
                            is_rate_limit: isRateLimit,
                            status_code: typeof safeData.statusCode === "number" ? safeData.statusCode : undefined,
                            retry_after_seconds: retryAfterSec,
                            message: isRateLimit
                              ? `Rate limit exceeded.${retryMsg} Select another model and retry.`
                              : safeData.message,
                          }),
                        )
                      } catch {
                        /* ws may be closed */
                      }
                    })
                  })

                  actionResult(ws, msg.type, msg, { status: "ok" })
                  break
                }

                case "create_session": {
                  log.info("create_session request received", { device: msg.device_name })

                  try {
                    const selectedDirectory = await resolveCompanionDirectory(msg.directory, directory)
                    const newSession = await inDirectory(selectedDirectory, directory, async () => {
                      const created = await Session.create({})
                      SessionExecutionProfile.set(created.id, "companion-fast")
                      if (msg.text && msg.text.trim().length > 0) {
                        let parsedModel = undefined
                        if (msg.model) {
                          const p = msg.model.indexOf("/")
                          if (p > 0)
                            parsedModel = { providerID: msg.model.substring(0, p), modelID: msg.model.substring(p + 1) }
                        }

                        SessionPrompt.prompt({
                          sessionID: created.id,
                          parts: [{ type: "text", text: msg.text }],
                          model: parsedModel,
                          agent: msg.agent,
                          variant: msg.variant,
                          system: MOBILE_SYSTEM_CONTEXT,
                        }).catch((err) => {
                          log.error("failed to inject initial prompt into new session", {
                            error: diagnosticError(err),
                          })
                          try {
                            const safeError = MobileBridge.sanitizeMessageError(err)
                            const safeData = safeError.data as Record<string, unknown>
                            ws.send(
                              JSON.stringify({
                                type: "prompt_error",
                                session_id: created.id,
                                status_code: typeof safeData.statusCode === "number" ? safeData.statusCode : undefined,
                                message: safeData.message,
                              }),
                            )
                          } catch {
                            /* ws may be closed */
                          }
                        })
                      }
                      return created
                    })
                    sendIdempotent(ws, msg, {
                      status: "ok",
                      type: "session_created",
                      client_request_id: msg.client_request_id,
                      session_id: newSession.id,
                      session_title: newSession.title,
                      initial_text: msg.text ?? null,
                      directory: selectedDirectory,
                    })
                  } catch (err) {
                    log.error("failed to create new session from mobile", { error: diagnosticError(err) })
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "session_creation_failed",
                    })
                  }
                  break
                }

                case "get_messages": {
                  log.info("get_messages requested", { session_id: msg.session_id })
                  try {
                    const msgs = await inDirectory(msg.directory, directory, () =>
                      Session.messages({ sessionID: msg.session_id, excludePatches: true }),
                    )
                    const serialized = msgs.map((m) => ({
                      id: m.info.id,
                      role: m.info.role,
                      sessionID: m.info.sessionID,
                      time: m.info.time,
                      ...(m.info.role === "user"
                        ? {
                            model: `${m.info.model.providerID}/${m.info.model.modelID}`,
                            agent: m.info.agent,
                            variant: m.info.variant,
                          }
                        : {
                            model: `${m.info.providerID}/${m.info.modelID}`,
                            ...(m.info.error ? { error: MobileBridge.sanitizeMessageError(m.info.error) } : {}),
                          }),
                      parts: m.parts.map((p) => ({
                        id: p.id,
                        type: p.type,
                        // text / reasoning
                        ...("text" in p ? { text: p.text } : {}),
                        // tool
                        ...(p.type === "tool" ? { tool: p.tool, state: p.state, callID: p.callID } : {}),
                        // file attachment
                        ...(p.type === "file" ? { mime: p.mime, filename: p.filename, url: p.url } : {}),
                      })),
                    }))
                    ws.send(
                      JSON.stringify({
                        type: "messages_result",
                        status: "ok",
                        client_request_id: msg.client_request_id,
                        session_id: msg.session_id,
                        messages: serialized,
                      }),
                    )
                  } catch (err) {
                    log.error("failed to get messages", {
                      session_id: msg.session_id,
                      error: diagnosticError(err),
                    })
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.session_id,
                      error: err instanceof Error ? err.message : "get_messages_failed",
                    })
                  }
                  break
                }

                case "list_directories": {
                  try {
                    const selected = await resolveCompanionDirectory(msg.path, directory)
                    const entries = await fs.readdir(selected, { withFileTypes: true })
                    const directories = entries
                      .filter((entry) => entry.isDirectory() && entry.name !== ".git")
                      .map((entry) => ({
                        name: entry.name,
                        path: path.join(selected, entry.name),
                        hidden: entry.name.startsWith("."),
                      }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                    const home = await fs.realpath(os.homedir())
                    const roots = (await knownDirectories(directory)).map((item) => ({
                      name: path.basename(item) || item,
                      path: item,
                    }))
                    const parentCandidate = path.dirname(selected)
                    const parent =
                      selected === home || parentCandidate === selected
                        ? null
                        : await resolveCompanionDirectory(parentCandidate, directory).catch(() => null)
                    ws.send(
                      JSON.stringify({
                        type: "directories_result",
                        status: "ok",
                        client_request_id: msg.client_request_id,
                        path: selected,
                        parent,
                        home,
                        roots,
                        directories,
                      }),
                    )
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "directory_listing_failed",
                    })
                  }
                  break
                }

                case "get_models": {
                  await sendModelList(ws)
                  break
                }

                case "question_reply": {
                  log.info("question_reply received", { id: msg.id })

                  try {
                    await inDirectory(msg.directory, directory, () =>
                      Question.reply({
                        requestID: msg.id,
                        answers: msg.answers,
                      }),
                    )
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.id })
                  } catch (err) {
                    log.error("failed to reply to question", { id: msg.id, error: diagnosticError(err) })
                    actionResult(ws, msg.type, msg, { status: "error", id: msg.id, error: "question_reply_failed" })
                  }
                  break
                }

                case "question_reject": {
                  log.info("question_reject received", { id: msg.id })

                  try {
                    await inDirectory(msg.directory, directory, () => Question.reject(msg.id))
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.id })
                  } catch (err) {
                    log.error("failed to reject question", { id: msg.id, error: diagnosticError(err) })
                    actionResult(ws, msg.type, msg, { status: "error", id: msg.id, error: "question_reject_failed" })
                  }
                  break
                }

                case "unpair": {
                  actionResult(ws, msg.type, { ...msg, device_id: connection.deviceId }, { status: "ok" })
                  CompanionAuth.removeDevice(connection.deviceId)
                  const active = ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceId)
                  if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection.deviceId)
                  if (registered) {
                    MobileBridge.unregisterClient(clientId)
                    registered = false
                  }
                  connection = undefined
                  break
                }

                case "abort_session": {
                  try {
                    await inDirectory(msg.directory, directory, async () => {
                      SessionTermination.mark(msg.session_id)
                      SessionPrompt.cancel(msg.session_id)
                      await Bus.publish(TuiEvent.ChainUpdateStep, {
                        sessionID: msg.session_id,
                        status: "stopped",
                      }).catch(() => {})
                    })
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.session_id })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.session_id,
                      error: err instanceof Error ? err.message : "session_abort_failed",
                    })
                  }
                  break
                }

                case "pause_session": {
                  try {
                    await inDirectory(msg.directory, directory, async () => {
                      // A pause cancels only the active turn. Unlike stop, it does
                      // not mark the session as explicitly terminated, so its
                      // transcript remains available for a later continuation.
                      SessionPrompt.cancel(msg.session_id)
                      await Bus.publish(TuiEvent.ChainUpdateStep, {
                        sessionID: msg.session_id,
                        status: "paused",
                      }).catch(() => {})
                    })
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.session_id })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.session_id,
                      error: err instanceof Error ? err.message : "session_pause_failed",
                    })
                  }
                  break
                }

                case "delete_session": {
                  try {
                    await inDirectory(msg.directory, directory, async () => {
                      if (SessionStatus.get(msg.session_id).type !== "idle") {
                        throw new Error("active_session_cannot_be_deleted")
                      }
                      SessionSummary.cancelPendingSummarize(msg.session_id)
                      await MemoryLifecycle.flush(msg.session_id)
                      await Session.remove(msg.session_id)
                    })
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.session_id })
                    await sendSessionList(ws)
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.session_id,
                      error: err instanceof Error ? err.message : "session_delete_failed",
                    })
                  }
                  break
                }

                case "create_upload": {
                  try {
                    const selectedDirectory = await resolveCompanionDirectory(msg.directory, directory)
                    const upload = await inDirectory(selectedDirectory, directory, () =>
                      CompanionTransfer.createUpload({
                        filename: msg.filename,
                        mime: msg.mime,
                        size: msg.size,
                        sha256: msg.sha256,
                        sessionID: msg.session_id,
                        directory: selectedDirectory,
                        deviceName: msg.device_name,
                        model: msg.model,
                        agent: msg.agent,
                        variant: msg.variant,
                      }),
                    )
                    actionResult(ws, msg.type, msg, {
                      status: "ok",
                      id: upload.id,
                      upload_path: upload.uploadPath,
                      expires_at: upload.expiresAt,
                      offset: upload.offset,
                      chunk_size: upload.chunkSize,
                    })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "upload_ticket_failed",
                    })
                  }
                  break
                }

                case "artifact_delete": {
                  try {
                    const selectedDirectory = await resolveCompanionDirectory(msg.directory, directory)
                    const deleted = await inDirectory(selectedDirectory, directory, () =>
                      CompanionTransfer.deleteArtifact(msg.artifact_id),
                    )
                    if (!deleted) throw new Error("Transfer item was not found")
                    actionResult(ws, msg.type, msg, { status: "ok", id: msg.artifact_id })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "artifact_delete_failed",
                    })
                  }
                  break
                }

                case "preview_logs": {
                  try {
                    const preview = await inDirectory(msg.directory, directory, () =>
                      CompanionTransfer.preview(msg.preview_id),
                    )
                    if (!preview) throw new Error("Preview was not found")
                    ws.send(
                      JSON.stringify({
                        type: "preview_result",
                        status: "ok",
                        client_request_id: msg.client_request_id,
                        preview,
                      }),
                    )
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "preview_logs_failed",
                    })
                  }
                  break
                }

                case "preview_access": {
                  try {
                    const preview = await inDirectory(msg.directory, directory, () =>
                      CompanionTransfer.previewAccess(msg.preview_id),
                    )
                    actionResult(ws, msg.type, msg, { status: "ok", id: preview.id, preview })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "preview_access_failed",
                    })
                  }
                  break
                }

                case "preview_stop": {
                  try {
                    const preview = await inDirectory(msg.directory, directory, () =>
                      CompanionTransfer.stopPreview(msg.preview_id),
                    )
                    actionResult(ws, msg.type, msg, { status: "ok", id: preview.id, preview })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "preview_stop_failed",
                    })
                  }
                  break
                }
              }
            },
          })
        },

        onClose() {
          log.info("client disconnected", { clientId })
          const active = connection && ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceId)
          if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection!.deviceId)
          if (registered) MobileBridge.unregisterClient(clientId)
        },

        onError(err) {
          log.error("ws error", { clientId, error: diagnosticError(err) })
          const active = connection && ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceId)
          if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection!.deviceId)
          if (registered) MobileBridge.unregisterClient(clientId)
        },
      }
    }),
  )
  .get("/companion/artifact/:id", async (c) => {
    try {
      const directory = c.req.query("directory")
      const token = c.req.query("token") ?? ""
      const selected = await resolveCompanionDirectory(directory, Instance.directory)
      const artifact = await inDirectory(selected, Instance.directory, () =>
        CompanionTransfer.artifact(c.req.param("id"), token),
      )
      if (!artifact) return c.json({ error: "artifact_not_found" }, 404)
      const file = Bun.file(artifact.filePath)
      if (!(await file.exists()) || file.size !== artifact.size) {
        return c.json({ error: "artifact_source_changed" }, 409)
      }
      const etag = `"sha256-${artifact.sha256}"`
      const rangeHeader = c.req.header("range")
      const ifRange = c.req.header("if-range")
      let start = 0
      let end = artifact.size > 0 ? artifact.size - 1 : 0
      let partial = false
      if (rangeHeader && (!ifRange || ifRange === etag)) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
        if (!match || artifact.size === 0) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${artifact.size}` },
          })
        }
        start = Number(match[1])
        end = match[2] ? Math.min(Number(match[2]), artifact.size - 1) : artifact.size - 1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= artifact.size) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${artifact.size}` },
          })
        }
        partial = true
      }
      // Bun automatically applies the request Range again to a BunFile body.
      // Stream the full body when If-Range does not match so stale partial
      // downloads cannot be spliced into a different artifact revision.
      const body = partial ? file.slice(start, end + 1) : rangeHeader ? file.stream() : file
      return new Response(body, {
        status: partial ? 206 : 200,
        headers: {
          "content-type": artifact.mime,
          "content-length": String(partial ? end - start + 1 : artifact.size),
          ...(partial ? { "content-range": `bytes ${start}-${end}/${artifact.size}` } : {}),
          "accept-ranges": "bytes",
          etag,
          "x-content-sha256": artifact.sha256,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
          "cache-control": "private, no-store",
        },
      })
    } catch (err) {
      log.error("artifact download failed", { error: diagnosticError(err) })
      return c.json({ error: "artifact_download_failed" }, 400)
    }
  })
  .get("/companion/upload/:id", async (c) => {
    const directory = c.req.query("directory")
    const token = c.req.query("token") ?? ""
    const selected = await resolveCompanionDirectory(directory, Instance.directory)
    const status = await inDirectory(selected, Instance.directory, () =>
      CompanionTransfer.uploadStatus(c.req.param("id"), token),
    )
    if (!status) return c.json({ error: "upload_not_found" }, 404)
    return c.json(
      {
        offset: status.offset,
        size: status.size,
        expires_at: status.expiresAt,
        chunk_size: status.chunkSize,
      },
      200,
      { "cache-control": "no-store" },
    )
  })
  .patch("/companion/upload/:id", async (c) => {
    try {
      const directory = c.req.query("directory")
      const token = c.req.query("token") ?? ""
      const selected = await resolveCompanionDirectory(directory, Instance.directory)
      const offset = Number(c.req.header("upload-offset"))
      const contentLength = Number(c.req.header("content-length"))
      const result = await inDirectory(selected, Instance.directory, () =>
        CompanionTransfer.acceptUploadChunk({
          id: c.req.param("id"),
          token,
          offset,
          contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
          chunkSha256: c.req.header("x-chunk-sha256"),
          body: c.req.raw.body,
        }),
      )
      return c.json({
        status: result.status,
        offset: result.offset,
        size: result.size,
        ...(result.status === "complete" ? { artifact: result.artifact } : {}),
      })
    } catch (err) {
      log.error("mobile upload chunk failed", { error: diagnosticError(err) })
      return c.json({ error: err instanceof Error ? err.message : "upload_chunk_failed" }, 400)
    }
  })
  .put("/companion/upload/:id", async (c) => {
    try {
      const directory = c.req.query("directory")
      const token = c.req.query("token") ?? ""
      const selected = await resolveCompanionDirectory(directory, Instance.directory)
      const contentLengthHeader = c.req.header("content-length")
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined
      const result = await inDirectory(selected, Instance.directory, () =>
        CompanionTransfer.acceptUpload({
          id: c.req.param("id"),
          token,
          contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
          body: c.req.raw.body,
        }),
      )
      return c.json({ status: "ok", artifact: result.artifact })
    } catch (err) {
      log.error("mobile upload failed", { error: diagnosticError(err) })
      return c.json({ error: err instanceof Error ? err.message : "upload_failed" }, 400)
    }
  })

/**
 * HTTP companion pair endpoint (for AtomBase server).
 * Mirrors the same logic in enterprise's /companion/pair for completeness.
 */
export const CompanionPairRoute = new Hono().post(
  "/companion/pair",
  describeRoute({
    summary: "Pair a mobile device",
    operationId: "companion.pair",
    responses: {
      200: {
        description: "Device paired",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                status: z.literal("ok"),
                device_id: z.string(),
                machine_id: z.string().uuid(),
                machine_name: z.string(),
                process_id: z.string().uuid(),
                bridge_id: z.string().uuid(),
                project_directory: z.string(),
              }),
            ),
          },
        },
      },
      401: {
        description: "Invalid token",
        content: { "application/json": { schema: resolver(z.object({ error: z.string() })) } },
      },
    },
  }),
  validator(
    "json",
    z.object({
      pairing_token: z.string().min(1),
      public_key: z.string().min(1),
      device_name: z.string().min(1).max(100),
      device_id: z.string().min(1).max(128).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json")
    const valid = CompanionAuth.consumeToken(body.pairing_token)
    if (!valid) return c.json({ error: "invalid_token" }, 401)
    const device = CompanionAuth.registerDevice(body.device_name, body.public_key, body.device_id)
    const machine = CompanionIdentity.machine()
    return c.json({
      status: "ok" as const,
      device_id: device.deviceId ?? device.deviceName,
      machine_id: machine.machineId,
      machine_name: machine.machineName,
      process_id: CompanionIdentity.processId(),
      bridge_id: MobileBridge.bridgeId(),
      project_directory: Instance.directory,
    })
  },
)
