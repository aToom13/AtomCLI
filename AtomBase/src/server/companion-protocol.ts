import { CompanionAuth } from "@atomcli/companion"

export namespace CompanionProtocol {
  export const CHALLENGE_TTL_MS = 30_000
  export const MESSAGE_CLOCK_SKEW_MS = 2 * 60_000

  export interface Authentication {
    type: "authenticate"
    challenge: string
    timestamp: number
    device_name: string
    device_id?: string
    protocol_version?: number
    capabilities?: string[]
    signature: string
  }

  export interface SignedMutation {
    device_name: string
    device_id?: string
    connection_id: string
    counter: number
    timestamp: number
    signature: string
  }

  export interface ConnectionState {
    deviceName: string
    deviceId: string
    connectionId: string
    lastCounter: number
  }

  export function canonicalPayload(message: Record<string, unknown>) {
    const { signature: _signature, device_name: _deviceName, ...payload } = message
    const ordered = Object.fromEntries(
      Object.keys(payload)
        .sort()
        .map((key) => [key, payload[key]]),
    )
    return JSON.stringify(ordered)
  }

  export function verifyAuthentication(
    message: Authentication,
    expectedChallenge: string,
    expiresAt: number,
    now = Date.now(),
  ) {
    if (message.challenge !== expectedChallenge) return "invalid_challenge" as const
    if (now > expiresAt || Math.abs(now - message.timestamp) > MESSAGE_CLOCK_SKEW_MS) {
      return "expired_challenge" as const
    }
    const payload = canonicalPayload(message as unknown as Record<string, unknown>)
    const verified =
      CompanionAuth.verify(message.device_id ?? message.device_name, payload, message.signature) ||
      (message.device_id !== undefined && CompanionAuth.verify(message.device_name, payload, message.signature))
    if (!verified) {
      return "invalid_signature" as const
    }
    return undefined
  }

  export function verifyMutation(
    message: SignedMutation & Record<string, unknown>,
    state: ConnectionState,
    now = Date.now(),
  ) {
    if (
      message.device_name !== state.deviceName ||
      (message.device_id !== undefined && message.device_id !== state.deviceId) ||
      message.connection_id !== state.connectionId
    ) {
      return "invalid_connection" as const
    }
    if (Math.abs(now - message.timestamp) > MESSAGE_CLOCK_SKEW_MS) return "expired_message" as const
    if (message.counter <= state.lastCounter) return "replayed_message" as const
    const payload = canonicalPayload(message)
    if (!CompanionAuth.verify(message.device_id ?? message.device_name, payload, message.signature)) {
      return "invalid_signature" as const
    }
    return undefined
  }
}
