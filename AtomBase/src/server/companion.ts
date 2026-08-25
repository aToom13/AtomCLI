import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { describeRoute, resolver, validator } from "hono-openapi"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { CompanionAuth, MobileBridge, PermissionMutex } from "@atomcli/companion"
import { PermissionNext } from "@/util/permission/next"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { GlobalBus } from "@/core/bus/global"
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
import { CompanionTransfer } from "@/services/companion/transfer"
import { CompanionProtocol } from "./companion-protocol"

const log = Log.create({ service: "companion-ws" })
const MAX_ACTIVE_DEVICES = 100
const ACTIVE_DEVICE_CONNECTIONS = new Map<string, { clientId: string; close: (reason: string) => void }>()
const MOBILE_SYSTEM_CONTEXT =
  "This user message was sent from the AtomCLI Android Companion. The user is currently interacting from a phone; preserve this origin for workflow and tool decisions that depend on the active client."

// ---------------------------------------------------------------------------
// Inbound message schemas
// ---------------------------------------------------------------------------

const SyncMessage = z.object({
  type: z.literal("sync"),
  last_seq_id: z.number().int().min(0),
})

const PingMessage = z.object({
  type: z.literal("ping"),
  timestamp: z.number().int().positive(),
})

const SnapshotMessage = z.object({
  type: z.literal("request_snapshot"),
})

const AuthenticateMessage = z.object({
  type: z.literal("authenticate"),
  challenge: z.string().uuid(),
  timestamp: z.number().int().positive(),
  signature: z.string(),
  device_name: z.string(),
})

const SignedFields = {
  signature: z.string(),
  device_name: z.string(),
  connection_id: z.string().uuid(),
  counter: z.number().int().positive(),
  timestamp: z.number().int().positive(),
  client_request_id: z.string().uuid().optional(),
}

const PermissionResolveMessage = z.object({
  type: z.literal("permission_resolve"),
  id: z.string(),
  resolution: z.enum(["allow", "allow_once", "allow_always", "autonomous", "deny", "intervene"]),
  directory: z.string().optional(),
  /** Used only when resolution === "intervene" */
  intervention_params: z.string().optional(),
  /** Raw 64-byte ED25519 signature of the canonical payload, Base64 */
  ...SignedFields,
})

const CommandMessage = z.object({
  type: z.literal("command"),
  action: z.string(),
  params: z.record(z.string(), z.any()).optional(),
  ...SignedFields,
})

const ChatMessage = z.object({
  type: z.literal("chat_message"),
  session_id: z.string(),
  text: z.string(),
  attachments: z.array(z.string()).max(10).optional(),
  ...SignedFields,
  model: z.string().optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  directory: z.string().optional(),
})

const CreateSessionMessage = z.object({
  type: z.literal("create_session"),
  text: z.string().optional(),
  ...SignedFields,
  model: z.string().optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  directory: z.string().optional(),
})

const GetMessagesMessage = z.object({
  type: z.literal("get_messages"),
  session_id: z.string(),
  directory: z.string().optional(),
  client_request_id: z.string().uuid().optional(),
})

const ListDirectoriesMessage = z.object({
  type: z.literal("list_directories"),
  path: z.string().optional(),
  client_request_id: z.string().uuid().optional(),
})

const GetModelsMessage = z.object({
  type: z.literal("get_models"),
})

const QuestionReplyMessage = z.object({
  type: z.literal("question_reply"),
  id: z.string(),
  answers: z.array(z.array(z.string())),
  directory: z.string().optional(),
  ...SignedFields,
})

const QuestionRejectMessage = z.object({
  type: z.literal("question_reject"),
  id: z.string(),
  directory: z.string().optional(),
  ...SignedFields,
})

const UnpairMessage = z.object({
  type: z.literal("unpair"),
  ...SignedFields,
})

const AbortSessionMessage = z.object({
  type: z.literal("abort_session"),
  session_id: z.string(),
  directory: z.string().optional(),
  ...SignedFields,
})

const CreateUploadMessage = z.object({
  type: z.literal("create_upload"),
  session_id: z.string(),
  filename: z.string().min(1).max(255),
  mime: z.string().max(255),
  size: z.number().int().nonnegative(),
  model: z.string().optional(),
  agent: z.string().optional(),
  variant: z.string().optional(),
  directory: z.string().optional(),
  ...SignedFields,
})

const PreviewStopMessage = z.object({
  type: z.literal("preview_stop"),
  preview_id: z.string(),
  directory: z.string().optional(),
  ...SignedFields,
})

const PreviewLogsMessage = z.object({
  type: z.literal("preview_logs"),
  preview_id: z.string(),
  directory: z.string().optional(),
  client_request_id: z.string().uuid().optional(),
})

const InboundMessage = z.discriminatedUnion("type", [
  AuthenticateMessage,
  SyncMessage,
  PingMessage,
  SnapshotMessage,
  PermissionResolveMessage,
  CommandMessage,
  ChatMessage,
  CreateSessionMessage,
  GetMessagesMessage,
  GetModelsMessage,
  ListDirectoriesMessage,
  QuestionReplyMessage,
  QuestionRejectMessage,
  UnpairMessage,
  AbortSessionMessage,
  CreateUploadMessage,
  PreviewStopMessage,
  PreviewLogsMessage,
])

function actionResult(
  ws: any,
  action: string,
  msg: { client_request_id?: string },
  result: { status: "ok" | "conflict" | "error"; id?: string; error?: string; [key: string]: unknown },
) {
  ws.send(
    JSON.stringify({
      type: "action_result",
      action,
      client_request_id: msg.client_request_id,
      ...result,
    }),
  )
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
    log.error("failed to send session list", { err })
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
    log.error("failed to send model list", { err })
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
    log.error("failed to send agent list", { err })
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
              protocol: 2,
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

              const result = InboundMessage.safeParse(parsed)
              if (!result.success) {
                log.error("inbound message validation failed", { error: result.error.message, parsed })
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
                const previous = ACTIVE_DEVICE_CONNECTIONS.get(msg.device_name)
                if (previous && previous.clientId !== clientId) {
                  log.info("replacing existing device connection", {
                    device: msg.device_name,
                    previousClientId: previous.clientId,
                    clientId,
                  })
                  MobileBridge.unregisterClient(previous.clientId)
                  previous.close("connection_replaced")
                }
                if (
                  !ACTIVE_DEVICE_CONNECTIONS.has(msg.device_name) &&
                  ACTIVE_DEVICE_CONNECTIONS.size >= MAX_ACTIVE_DEVICES
                ) {
                  const oldest = ACTIVE_DEVICE_CONNECTIONS.entries().next().value
                  if (oldest) {
                    ACTIVE_DEVICE_CONNECTIONS.delete(oldest[0])
                    MobileBridge.unregisterClient(oldest[1].clientId)
                    oldest[1].close("connection_capacity")
                  }
                }
                connection = {
                  deviceName: msg.device_name,
                  connectionId: crypto.randomUUID(),
                  lastCounter: 0,
                }
                ACTIVE_DEVICE_CONNECTIONS.set(msg.device_name, {
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
                    log.error("send failed", { clientId, err })
                  }
                })
                registered = true
                ws.send(
                  JSON.stringify({
                    type: "auth_ok",
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
                  actionResult(ws, msg.type, msg, { status: "error", error })
                  return
                }
                connection.lastCounter = msg.counter
              }

              switch (msg.type) {
                case "ping": {
                  ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }))
                  break
                }

                case "sync": {
                  log.info("sync requested", { clientId, last_seq_id: msg.last_seq_id })
                  // Replay any buffered events the client missed since last_seq_id
                  MobileBridge.replayMissed(clientId, msg.last_seq_id)
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
                    log.error("failed to resolve permission", { id: msg.id, err })
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.id,
                      error: err instanceof Error ? err.message : String(err),
                    })
                  }
                  break
                }

                case "command": {
                  log.info("command received", { action: msg.action, params: msg.params })
                  actionResult(ws, msg.type, msg, {
                    status: "error",
                    error: "unsupported_command",
                    requested_action: msg.action,
                  })
                  break
                }

                case "chat_message": {
                  log.info("chat message received", { session_id: msg.session_id, text: msg.text })

                  let parsedModel = undefined
                  if (msg.model) {
                    const p = msg.model.indexOf("/")
                    if (p > 0)
                      parsedModel = { providerID: msg.model.substring(0, p), modelID: msg.model.substring(p + 1) }
                  }

                  await inDirectory(msg.directory, directory, async () => {
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
                      log.error("failed to inject chat prompt", { session_id: msg.session_id, err })
                      try {
                        const errMsg = err instanceof Error ? err.message : String(err)
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
                            retry_after_seconds: retryAfterSec,
                            message: isRateLimit
                              ? `Rate limit exceeded.${retryMsg} Select another model and retry.`
                              : errMsg.slice(0, 300),
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
                          log.error("failed to inject initial prompt into new session", { err })
                          try {
                            ws.send(
                              JSON.stringify({
                                type: "prompt_error",
                                session_id: created.id,
                                message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
                              }),
                            )
                          } catch {
                            /* ws may be closed */
                          }
                        })
                      }
                      return created
                    })
                    ws.send(
                      JSON.stringify({
                        status: "ok",
                        type: "session_created",
                        client_request_id: msg.client_request_id,
                        session_id: newSession.id,
                        session_title: newSession.title,
                        initial_text: msg.text ?? null,
                        directory: selectedDirectory,
                      }),
                    )
                  } catch (err) {
                    log.error("failed to create new session from mobile", { err })
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
                        : {}),
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
                    log.error("failed to get messages", { session_id: msg.session_id, err })
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
                    log.error("failed to reply to question", { id: msg.id, err })
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
                    log.error("failed to reject question", { id: msg.id, err })
                    actionResult(ws, msg.type, msg, { status: "error", id: msg.id, error: "question_reject_failed" })
                  }
                  break
                }

                case "unpair": {
                  CompanionAuth.removeDevice(connection.deviceName)
                  actionResult(ws, msg.type, msg, { status: "ok" })
                  const active = ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceName)
                  if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection.deviceName)
                  if (registered) {
                    MobileBridge.unregisterClient(clientId)
                    registered = false
                  }
                  connection = undefined
                  break
                }

                case "abort_session": {
                  try {
                    await inDirectory(msg.directory, directory, () => {
                      SessionTermination.mark(msg.session_id)
                      SessionPrompt.cancel(msg.session_id)
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

                case "create_upload": {
                  try {
                    const selectedDirectory = await resolveCompanionDirectory(msg.directory, directory)
                    const upload = await inDirectory(selectedDirectory, directory, () =>
                      CompanionTransfer.createUpload({
                        filename: msg.filename,
                        mime: msg.mime,
                        size: msg.size,
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
                    })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      error: err instanceof Error ? err.message : "upload_ticket_failed",
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
          const active = connection && ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceName)
          if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection!.deviceName)
          if (registered) MobileBridge.unregisterClient(clientId)
        },

        onError(err) {
          log.error("ws error", { clientId, err })
          const active = connection && ACTIVE_DEVICE_CONNECTIONS.get(connection.deviceName)
          if (active?.clientId === clientId) ACTIVE_DEVICE_CONNECTIONS.delete(connection!.deviceName)
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
      return new Response(file, {
        headers: {
          "content-type": artifact.mime,
          "content-length": String(artifact.size),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
          "cache-control": "private, no-store",
        },
      })
    } catch (err) {
      log.error("artifact download failed", { err })
      return c.json({ error: "artifact_download_failed" }, 400)
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
      log.error("mobile upload failed", { err })
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
        content: { "application/json": { schema: resolver(z.object({ status: z.literal("ok") })) } },
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
    }),
  ),
  async (c) => {
    const body = c.req.valid("json")
    const valid = CompanionAuth.consumeToken(body.pairing_token)
    if (!valid) return c.json({ error: "invalid_token" }, 401)
    CompanionAuth.registerDevice(body.device_name, body.public_key)
    return c.json({ status: "ok" as const })
  },
)
