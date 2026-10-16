import { Hono } from "hono"
import { upgradeWebSocket } from "hono/bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  CompanionAuth,
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
import { Instance } from "@/services/project/instance"
import { Question } from "@/interfaces/question"
import { SessionTermination } from "@/core/session/termination"
import { SessionStatus } from "@/core/session/status"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { SessionSummary } from "@/core/session/summary"
import { MemoryLifecycle } from "@/core/memory/services/lifecycle"
import { CompanionTransfer } from "@/services/companion/transfer"
import { CompanionProtocol } from "./companion-protocol"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ConnectionStore, MAX_ACTIVE_DEVICES, beginAction, cachedAction } from "./companion/state"
import { inDirectory, knownDirectories, resolveCompanionDirectory } from "./companion/directory"
import { actionResult, sendIdempotent } from "./companion/actions"
import { sendSessionList, sendModelList, sendAgentList } from "./companion/messages"
import { sendBridgeSnapshot } from "./companion/bridge-snapshot"
import { diagnosticError, companionEndpoints, MOBILE_SYSTEM_CONTEXT, log } from "./companion/helpers"
import { CompanionUploadRoutes } from "./companion/uploads"
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
                const previous = ConnectionStore.get(deviceId)
                if (previous && previous.clientId !== clientId) {
                  log.info("replacing existing device connection", {
                    device: msg.device_name,
                    previousClientId: previous.clientId,
                    clientId,
                  })
                  MobileBridge.unregisterClient(previous.clientId)
                  previous.close("connection_replaced")
                }
                if (!ConnectionStore.has(deviceId) && ConnectionStore.size >= MAX_ACTIVE_DEVICES) {
                  const oldest = ConnectionStore.evictOldest()
                  if (oldest?.connection) {
                    MobileBridge.unregisterClient(oldest.connection.clientId)
                    oldest.connection.close("connection_capacity")
                  }
                }
                connection = {
                  deviceName: msg.device_name,
                  deviceId,
                  connectionId: crypto.randomUUID(),
                  lastCounter: 0,
                }
                ConnectionStore.set(deviceId, {
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
                const actionState = beginAction(msg)
                if (actionState !== "new") {
                  ws.send(
                    JSON.stringify({
                      type: "action_result",
                      action: msg.type,
                      client_request_id: msg.client_request_id,
                      status: "conflict",
                      error: actionState === "active" ? "request_in_progress" : "too_many_requests",
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

                case "route_decision": {
                  try {
                    const result = await inDirectory(msg.directory, directory, async () => {
                      const session = await Session.get(msg.session_id)
                      return ExecutionRuntime.decideRouteProposal({
                        requestID: msg.client_request_id ?? crypto.randomUUID(),
                        proposalID: msg.proposal_id,
                        executionID: msg.execution_id,
                        sessionID: session.id,
                        projectID: Instance.project.id,
                        expectedProposalVersion: msg.expected_proposal_version,
                        expectedRouteRevision: msg.expected_route_revision,
                        decision: msg.decision,
                        actorID: `companion:${connection.deviceId}`,
                        acceptScope: msg.accept_scope,
                      })
                    })
                    actionResult(ws, msg.type, msg, {
                      status: result.decided ? "ok" : "conflict",
                      id: msg.proposal_id,
                      proposal: result.decided ? result.proposal : undefined,
                      error: result.decided ? undefined : result.reason,
                    })
                  } catch (err) {
                    actionResult(ws, msg.type, msg, {
                      status: "error",
                      id: msg.proposal_id,
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
                            ...(m.info.model?.providerID && m.info.model?.modelID
                              ? { model: `${m.info.model.providerID}/${m.info.model.modelID}` }
                              : {}),
                            agent: m.info.agent,
                            variant: m.info.variant,
                          }
                        : {
                            ...(m.info.providerID && m.info.modelID
                              ? { model: `${m.info.providerID}/${m.info.modelID}` }
                              : {}),
                            ...(m.info.error ? { error: MobileBridge.sanitizeMessageError(m.info.error) } : {}),
                          }),
                      parts: m.parts.map((p) => ({
                        id: p.id,
                        type: p.type,
                        messageID: p.messageID,
                        sessionID: p.sessionID,
                        // text / reasoning
                        ...("text" in p ? { text: p.text } : {}),
                        // tool
                        ...(p.type === "tool" ? { tool: p.tool, state: p.state, callID: p.callID } : {}),
                        // file attachment
                        ...(p.type === "file" ? { mime: p.mime, filename: p.filename, url: p.url } : {}),
                        // checkpoint
                        ...(p.type === "checkpoint"
                          ? {
                              sequence: p.sequence,
                              decision: p.decision,
                              requestedCalls: p.requestedCalls,
                              grantedCalls: p.grantedCalls,
                              objectiveAssessment: p.objectiveAssessment,
                              progressSummary: p.progressSummary,
                              discoveries: p.discoveries,
                              completedWork: p.completedWork,
                              remainingWork: p.remainingWork,
                              failures: p.failures,
                              blockers: p.blockers,
                              routeAssessment: p.routeAssessment,
                              routeDecision: p.routeDecision,
                              selfCritique: p.selfCritique,
                              failedApproaches: p.failedApproaches,
                              whatToChanges: p.whatToChanges,
                              nextActions: p.nextActions,
                              runtime: p.runtime,
                            }
                          : {}),
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
                  const active = ConnectionStore.get(connection.deviceId)
                  if (active?.clientId === clientId) ConnectionStore.delete(connection.deviceId)
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
          const active = connection && ConnectionStore.get(connection.deviceId)
          if (active?.clientId === clientId) ConnectionStore.delete(connection!.deviceId)
          if (registered) MobileBridge.unregisterClient(clientId)
        },

        onError(err) {
          log.error("ws error", { clientId, error: diagnosticError(err) })
          const active = connection && ConnectionStore.get(connection.deviceId)
          if (active?.clientId === clientId) ConnectionStore.delete(connection!.deviceId)
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
  .route("", CompanionUploadRoutes)
export { CompanionPairRoute } from "./companion/pair"
