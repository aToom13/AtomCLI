import { CompanionAuth, CompanionAudit } from "@atomcli/companion"
import { cacheAction, type CompanionActionMessage } from "./state"

const AUDITED_ACTIONS = new Set([
  "permission_resolve",
  "route_decision",
  "question_reply",
  "question_reject",
  "abort_session",
  "pause_session",
  "delete_session",
  "artifact_delete",
  "preview_stop",
  "unpair",
])

export function sendIdempotent(ws: any, msg: CompanionActionMessage, payload: Record<string, unknown>) {
  cacheAction(msg, payload)
  ws.send(JSON.stringify(payload))
}

export function actionResult(
  ws: any,
  action: string,
  msg: { client_request_id?: string; device_id?: string; device_name?: string },
  result: { status: "ok" | "conflict" | "error"; id?: string; error?: string; [key: string]: unknown },
  cache = true,
) {
  const payload = { type: "action_result", action, client_request_id: msg.client_request_id, ...result }
  if (AUDITED_ACTIONS.has(action)) {
    const claimedIdentity = msg.device_id ?? msg.device_name ?? "unknown-device"
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
