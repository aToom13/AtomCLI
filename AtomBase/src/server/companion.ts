import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { CompanionAuth, MobileBridge, PermissionMutex } from "@atomcli/companion"
import { PermissionNext } from "@/util/permission/next"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { GlobalBus } from "@/core/bus/global"
import { Log } from "@/util/util/log"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { Agent } from "@/integrations/agent/agent"
import { Config } from "@/core/config/config"
import { Question } from "@/interfaces/question"
import { CompanionProtocol } from "./companion-protocol"

const log = Log.create({ service: "companion-ws" })

// ---------------------------------------------------------------------------
// Inbound message schemas
// ---------------------------------------------------------------------------

const SyncMessage = z.object({
  type: z.literal("sync"),
  last_seq_id: z.number().int().min(0),
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
}

const PermissionResolveMessage = z.object({
  type: z.literal("permission_resolve"),
  id: z.string(),
  resolution: z.enum(["allow", "deny", "intervene"]),
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
  ...SignedFields,
  model: z.string().optional(),
  agent: z.string().optional(),
})

const CreateSessionMessage = z.object({
  type: z.literal("create_session"),
  text: z.string().optional(),
  ...SignedFields,
  model: z.string().optional(),
  agent: z.string().optional(),
})

const GetMessagesMessage = z.object({
  type: z.literal("get_messages"),
  session_id: z.string(),
})

const GetModelsMessage = z.object({
  type: z.literal("get_models"),
})

const QuestionReplyMessage = z.object({
  type: z.literal("question_reply"),
  id: z.string(),
  answers: z.array(z.array(z.string())),
  ...SignedFields,
})

const QuestionRejectMessage = z.object({
  type: z.literal("question_reject"),
  id: z.string(),
  ...SignedFields,
})

const InboundMessage = z.discriminatedUnion("type", [
  AuthenticateMessage,
  SyncMessage,
  SnapshotMessage,
  PermissionResolveMessage,
  CommandMessage,
  ChatMessage,
  CreateSessionMessage,
  GetMessagesMessage,
  GetModelsMessage,
  QuestionReplyMessage,
  QuestionRejectMessage,
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendSessionList(ws: any) {
  try {
    const sessions = []
    for await (const s of Session.list()) {
      sessions.push({
        id: s.id,
        title: s.title,
        updated: s.time.updated,
      })
    }
    sessions.sort((a, b) => b.updated - a.updated) // Recent first
    ws.send(JSON.stringify({ type: "session_list", sessions }))
  } catch (err) {
    log.error("failed to send session list", { err })
  }
}

async function sendModelList(ws: any) {
  try {
    const connected = await Provider.list()
    const models: { id: string; name: string; providerId: string; providerName: string }[] = []
    for (const [providerId, provider] of Object.entries(connected)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        models.push({
          id: `${providerId}/${modelId}`,
          name: model.name,
          providerId,
          providerName: provider.name,
        })
      }
    }
    models.sort((a, b) => a.id.localeCompare(b.id))

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

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const CompanionRoute = new Hono().get(
  "/companion/ws",
  upgradeWebSocket((c) => {
    const clientId = `companion_${crypto.randomUUID().slice(0, 8)}`
    const directory = Instance.directory
    const challenge = crypto.randomUUID()
    const challengeExpiresAt = Date.now() + CompanionProtocol.CHALLENGE_TTL_MS
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
              connection = {
                deviceName: msg.device_name,
                connectionId: crypto.randomUUID(),
                lastCounter: 0,
              }
              MobileBridge.registerClient(clientId, (data) => {
                try {
                  ws.send(data)
                } catch (err) {
                  log.error("send failed", { clientId, err })
                }
              })
              registered = true
              ws.send(JSON.stringify({ type: "auth_ok", connection_id: connection.connectionId }))
              MobileBridge.sendSnapshot(clientId)
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
                ws.send(JSON.stringify({ error }))
                return
              }
              connection.lastCounter = msg.counter
            }

            switch (msg.type) {
              case "sync": {
                log.info("sync requested", { clientId, last_seq_id: msg.last_seq_id })
                // Replay any buffered events the client missed since last_seq_id
                MobileBridge.replayMissed(clientId, msg.last_seq_id)
                // Re-send snapshot so pending_questions/permissions are visible
                // immediately after reconnect (onOpen may not have completed yet).
                // Do NOT re-send model/agent lists here — they're sent in onOpen.
                MobileBridge.sendSnapshot(clientId)
                await sendSessionList(ws)
                break
              }

              case "request_snapshot": {
                log.info("snapshot requested", { clientId })
                MobileBridge.sendSnapshot(clientId)
                await sendSessionList(ws)
                await sendModelList(ws)
                await sendAgentList(ws)
                break
              }

              case "permission_resolve": {
                // Acquire mutex — prevent TUI race condition
                const acquired = PermissionMutex.acquire(msg.id, "companion")
                if (!acquired) {
                  ws.send(JSON.stringify({ status: "conflict", msg: "Already handled locally", id: msg.id }))
                  return
                }

                // Resolve permission
                const reply: PermissionNext.Reply =
                  msg.resolution === "allow" ? "once" : msg.resolution === "deny" ? "reject" : "reject" // "intervene" → reject with message

                const message = msg.resolution === "intervene" ? (msg.intervention_params ?? undefined) : undefined

                PermissionNext.reply({
                  requestID: msg.id,
                  reply,
                  message,
                }).catch((err) => {
                  log.error("failed to resolve permission", { id: msg.id, err })
                })

                ws.send(JSON.stringify({ status: "ok", id: msg.id }))
                break
              }

              case "command": {
                // Handle known commands
                log.info("command received", { action: msg.action, params: msg.params })
                // Future: route to specific handlers (orchestrate abort, session interrupt…)
                ws.send(JSON.stringify({ status: "ok", action: msg.action }))
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

                // Inject message into target session
                SessionPrompt.prompt({
                  sessionID: msg.session_id,
                  parts: [{ type: "text", text: msg.text }],
                  model: parsedModel,
                  agent: msg.agent,
                }).catch((err) => {
                  log.error("failed to inject chat prompt", { session_id: msg.session_id, err })
                  try {
                    const errMsg = err instanceof Error ? err.message : String(err)
                    const isRateLimit =
                      errMsg.includes("429") || errMsg.includes("Rate limit") || errMsg.includes("FreeUsageLimitError")
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
                          ? `⚠️ Rate limit exceeded (opencode.ai free tier).${retryMsg} Switch to a different provider in AtomCLI config (e.g. Ollama or Anthropic).`
                          : errMsg.slice(0, 300),
                      }),
                    )
                  } catch {
                    /* ws may be closed */
                  }
                })

                ws.send(JSON.stringify({ status: "ok", type: "chat_message" }))
                break
              }

              case "create_session": {
                log.info("create_session request received", { device: msg.device_name })

                try {
                  const newSession = await Session.create({})
                  ws.send(
                    JSON.stringify({
                      status: "ok",
                      type: "session_created",
                      session_id: newSession.id,
                      session_title: newSession.title,
                      initial_text: msg.text ?? null,
                    }),
                  )
                  // If text was provided, inject it into the new session immediately
                  if (msg.text && msg.text.trim().length > 0) {
                    let parsedModel = undefined
                    if (msg.model) {
                      const p = msg.model.indexOf("/")
                      if (p > 0)
                        parsedModel = { providerID: msg.model.substring(0, p), modelID: msg.model.substring(p + 1) }
                    }

                    const { SessionPrompt } = await import("@/core/session/prompt")
                    SessionPrompt.prompt({
                      sessionID: newSession.id,
                      parts: [{ type: "text", text: msg.text }],
                      model: parsedModel,
                      agent: msg.agent,
                    }).catch((err) => {
                      log.error("failed to inject initial prompt into new session", { err })
                      try {
                        ws.send(
                          JSON.stringify({
                            type: "prompt_error",
                            session_id: newSession.id,
                            message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
                          }),
                        )
                      } catch {
                        /* ws may be closed */
                      }
                    })
                  }
                } catch (err) {
                  log.error("failed to create new session from mobile", { err })
                  ws.send(JSON.stringify({ error: "session_creation_failed" }))
                }
                break
              }

              case "get_messages": {
                log.info("get_messages requested", { session_id: msg.session_id })
                try {
                  const msgs = await Session.messages({ sessionID: msg.session_id, excludePatches: true })
                  const serialized = msgs.map((m) => ({
                    id: m.info.id,
                    role: m.info.role,
                    sessionID: m.info.sessionID,
                    time: m.info.time,
                    parts: m.parts.map((p) => ({
                      id: p.id,
                      type: p.type,
                      // text / reasoning
                      ...("text" in p ? { text: p.text } : {}),
                      // tool
                      ...(p.type === "tool" ? { tool: p.tool, state: p.state, callID: p.callID } : {}),
                    })),
                  }))
                  ws.send(JSON.stringify({ type: "messages_result", session_id: msg.session_id, messages: serialized }))
                } catch (err) {
                  log.error("failed to get messages", { session_id: msg.session_id, err })
                  ws.send(JSON.stringify({ error: "get_messages_failed", session_id: msg.session_id }))
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
                  await Question.reply({
                    requestID: msg.id,
                    answers: msg.answers,
                  })
                  ws.send(JSON.stringify({ status: "ok", type: "question_reply", id: msg.id }))
                } catch (err) {
                  log.error("failed to reply to question", { id: msg.id, err })
                  ws.send(JSON.stringify({ error: "question_reply_failed", id: msg.id }))
                }
                break
              }

              case "question_reject": {
                log.info("question_reject received", { id: msg.id })

                try {
                  await Question.reject(msg.id)
                  ws.send(JSON.stringify({ status: "ok", type: "question_reject", id: msg.id }))
                } catch (err) {
                  log.error("failed to reject question", { id: msg.id, err })
                  ws.send(JSON.stringify({ error: "question_reject_failed", id: msg.id }))
                }
                break
              }
            }
          },
        })
      },

      onClose() {
        log.info("client disconnected", { clientId })
        if (registered) MobileBridge.unregisterClient(clientId)
      },

      onError(err) {
        log.error("ws error", { clientId, err })
        if (registered) MobileBridge.unregisterClient(clientId)
      },
    }
  }),
)

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
