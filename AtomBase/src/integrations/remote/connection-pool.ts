import { createHash } from "crypto"
import type { Client, SFTPWrapper } from "ssh2"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"

const MAX_CONNECTIONS = 8
const IDLE_TTL_MS = 10 * 60 * 1000
const KEEPALIVE_INTERVAL_MS = 15_000
const KEEPALIVE_COUNT_MAX = 3
const MAX_CONNECT_ATTEMPTS = 3
const CONNECT_RETRY_DELAY_MS = 500

type HostProfile = Config.RemoteHost

type Entry = {
  key: string
  client?: Client
  connecting: Promise<Client>
  lastUsed: number
  active: number
}

type AcquireInput = {
  name: string
  profile: HostProfile
  signal: AbortSignal
  verifyUnknownHost(fingerprint: string): Promise<void>
}

export namespace RemoteConnection {
  const log = Log.create({ service: "remote.connection" })

  const state = Instance.state(
    () => ({ entries: new Map<string, Entry>() }),
    async (value) => {
      for (const entry of value.entries.values()) entry.client?.end()
      value.entries.clear()
    },
  )

  function profileKey(name: string, profile: HostProfile) {
    const fingerprint = createHash("sha256").update(JSON.stringify(profile)).digest("hex")
    return `${name}:${fingerprint}`
  }

  function hostFingerprint(key: Buffer) {
    const digest = createHash("sha256").update(key).digest("base64").replace(/=+$/, "")
    return `SHA256:${digest}`
  }

  function normalizeFingerprint(value: string) {
    return value.replace(/=+$/, "")
  }

  function clean(entries: Map<string, Entry>) {
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (entry.active > 0) continue
      if (now - entry.lastUsed <= IDLE_TTL_MS) continue
      entry.client?.end()
      entries.delete(key)
    }

    while (entries.size >= MAX_CONNECTIONS) {
      const oldest = [...entries.values()]
        .filter((entry) => entry.active === 0)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!oldest) throw new Error(`Remote connection pool is full (${MAX_CONNECTIONS} active connections)`)
      oldest.client?.end()
      entries.delete(oldest.key)
    }
  }

  export async function acquire(input: AcquireInput) {
    const current = state()
    clean(current.entries)
    const key = profileKey(input.name, input.profile)
    const existing = current.entries.get(key)
    if (existing) {
      existing.active++
      existing.lastUsed = Date.now()
      return lease(existing, input.signal)
    }

    const entry: Entry = {
      key,
      lastUsed: Date.now(),
      active: 1,
      connecting: undefined as unknown as Promise<Client>,
    }
    entry.connecting = connectWithRetry(input, entry, current.entries)
    current.entries.set(key, entry)

    return lease(entry, input.signal)
  }

  async function lease(entry: Entry, signal: AbortSignal) {
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.active = Math.max(0, entry.active - 1)
      entry.lastUsed = Date.now()
    }
    try {
      const client = await waitForConnection(entry.connecting, signal)
      return { client, release }
    } catch (error) {
      release()
      throw error
    }
  }

  function waitForConnection(connecting: Promise<Client>, signal: AbortSignal) {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error("SSH connection aborted"))
    return new Promise<Client>((resolve, reject) => {
      const abort = () => {
        cleanup()
        reject(signal.reason ?? new Error("SSH connection aborted"))
      }
      const cleanup = () => signal.removeEventListener("abort", abort)
      signal.addEventListener("abort", abort, { once: true })
      connecting.then(
        (client) => {
          cleanup()
          resolve(client)
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
    })
  }

  function transientConnectionError(error: Error) {
    const code = (error as Error & { code?: string }).code
    if (["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(code ?? "")) {
      return true
    }
    return /timed out while waiting for handshake|connection lost before handshake|socket hang up|no response from server/i.test(
      error.message,
    )
  }

  function retryDelay(milliseconds: number, signal: AbortSignal) {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error("SSH connection aborted"))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort)
        resolve()
      }, milliseconds)
      const abort = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
        reject(signal.reason ?? new Error("SSH connection aborted"))
      }
      signal.addEventListener("abort", abort, { once: true })
    })
  }

  async function connectWithRetry(input: AcquireInput, entry: Entry, entries: Map<string, Entry>) {
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      try {
        return await connectOnce(input, entry, entries)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt === MAX_CONNECT_ATTEMPTS || !transientConnectionError(lastError) || input.signal.aborted) break
        log.warn("retrying transient SSH connection failure", {
          host: input.name,
          attempt,
          maxAttempts: MAX_CONNECT_ATTEMPTS,
          error: lastError.message,
        })
        await retryDelay(CONNECT_RETRY_DELAY_MS * attempt, input.signal)
      }
    }
    if (entries.get(entry.key) === entry) entries.delete(entry.key)
    throw lastError ?? new Error(`Failed to connect to SSH profile '${input.name}'`)
  }

  async function connectOnce(input: AcquireInput, entry: Entry, entries: Map<string, Entry>) {
    const { Client } = await import("ssh2")
    const client = new Client()
    let verificationError: Error | undefined

    const remove = () => {
      if (entries.get(entry.key) === entry) entries.delete(entry.key)
    }
    return new Promise<Client>((resolve, reject) => {
      let settled = false
      const cleanup = () => input.signal.removeEventListener("abort", abort)
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        client.end()
        reject(verificationError ?? error)
      }
      const abort = () => fail(input.signal.reason ?? new Error("SSH connection aborted"))
      input.signal.addEventListener("abort", abort, { once: true })
      client.once("error", fail)
      client.once("ready", () => {
        if (settled) return
        settled = true
        cleanup()
        client.removeListener("error", fail)
        client.once("close", remove)
        client.once("end", remove)
        client.on("error", (error) => {
          remove()
          log.warn("SSH connection error", { host: input.name, error })
        })
        entry.client = client
        entry.lastUsed = Date.now()
        resolve(client)
      })
      try {
        client.connect({
          host: input.profile.host,
          port: input.profile.port,
          username: input.profile.username,
          password: input.profile.password,
          privateKey: input.profile.privateKey,
          passphrase: input.profile.passphrase,
          readyTimeout: input.profile.connectTimeout,
          keepaliveInterval: KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: KEEPALIVE_COUNT_MAX,
          hostVerifier(key, verify) {
            const actual = hostFingerprint(key)
            if (input.profile.hostKey) {
              const valid = normalizeFingerprint(actual) === normalizeFingerprint(input.profile.hostKey)
              if (!valid) {
                verificationError = new Error(
                  `SSH host key mismatch for '${input.name}': expected ${input.profile.hostKey}, received ${actual}`,
                )
              }
              verify(valid)
              return
            }

            input
              .verifyUnknownHost(actual)
              .then(() => verify(true))
              .catch((error) => {
                verificationError = error instanceof Error ? error : new Error(String(error))
                verify(false)
              })
          },
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  export function sftp(client: Client, signal: AbortSignal) {
    return new Promise<SFTPWrapper>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error("Remote operation aborted"))
        return
      }
      let settled = false
      const abort = () => {
        if (settled) return
        settled = true
        reject(signal.reason ?? new Error("Remote operation aborted"))
      }
      const cleanup = () => signal.removeEventListener("abort", abort)
      signal.addEventListener("abort", abort, { once: true })
      client.sftp((error, value) => {
        if (settled) {
          value?.end()
          return
        }
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve(value)
      })
    })
  }

  export async function invalidate(name: string) {
    const current = state()
    for (const [key, entry] of current.entries) {
      if (!key.startsWith(`${name}:`)) continue
      entry.client?.end()
      current.entries.delete(key)
    }
  }
}
