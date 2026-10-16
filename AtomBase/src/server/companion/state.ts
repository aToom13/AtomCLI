export type CompanionConnection = { clientId: string; close: (reason: string) => void }
export type CompanionActionMessage = { client_request_id?: string; device_id?: string; device_name?: string }
export type CachedAction = { expiresAt: number; payload: Record<string, unknown> }

export const MAX_ACTIVE_DEVICES = 100
export const ACTION_RESULT_TTL_MS = 15 * 60_000
export const ACTION_RESULT_MAX = 1_000
const ACTIVE_ACTIONS_MAX = ACTION_RESULT_MAX
const activeDeviceConnections = new Map<string, CompanionConnection>()
const ACTION_RESULTS = new Map<string, CachedAction>()
const ACTIVE_ACTIONS = new Map<string, number>()

export const ConnectionStore = {
  get: (deviceID: string) => activeDeviceConnections.get(deviceID),
  has: (deviceID: string) => activeDeviceConnections.has(deviceID),
  get size() {
    return activeDeviceConnections.size
  },
  set: (deviceID: string, connection: CompanionConnection) => activeDeviceConnections.set(deviceID, connection),
  delete: (deviceID: string) => activeDeviceConnections.delete(deviceID),
  evictOldest() {
    const oldest = activeDeviceConnections.keys().next().value
    if (!oldest) return undefined
    const connection = activeDeviceConnections.get(oldest)
    activeDeviceConnections.delete(oldest)
    return { deviceID: oldest, connection }
  },
}

export function actionKey(msg: CompanionActionMessage) {
  if (!msg.client_request_id) return undefined
  const device = msg.device_id ?? msg.device_name
  return device ? `${device}:${msg.client_request_id}` : undefined
}

export function cachedAction(msg: CompanionActionMessage) {
  const key = actionKey(msg)
  if (!key) return undefined
  const cached = ACTION_RESULTS.get(key)
  if (!cached) return undefined
  if (cached.expiresAt > Date.now()) return cached.payload
  ACTION_RESULTS.delete(key)
  return undefined
}

export function beginAction(msg: CompanionActionMessage, now = Date.now()) {
  const key = actionKey(msg)
  if (!key) return "new" as const
  // ponytail: active requests expire after 15 minutes; longer operations need durable operation tracking.
  for (const [id, startedAt] of ACTIVE_ACTIONS) {
    if (now - startedAt >= ACTION_RESULT_TTL_MS) ACTIVE_ACTIONS.delete(id)
  }
  if (ACTIVE_ACTIONS.has(key)) return "active" as const
  if (ACTIVE_ACTIONS.size >= ACTIVE_ACTIONS_MAX) return "capacity" as const
  ACTIVE_ACTIONS.set(key, now)
  return "new" as const
}

export function cacheAction(msg: CompanionActionMessage, payload: Record<string, unknown>) {
  const key = actionKey(msg)
  if (!key) return
  ACTIVE_ACTIONS.delete(key)
  ACTION_RESULTS.delete(key)
  ACTION_RESULTS.set(key, { expiresAt: Date.now() + ACTION_RESULT_TTL_MS, payload })
  while (ACTION_RESULTS.size > ACTION_RESULT_MAX) {
    const oldest = ACTION_RESULTS.keys().next().value
    if (!oldest) break
    ACTION_RESULTS.delete(oldest)
  }
}
