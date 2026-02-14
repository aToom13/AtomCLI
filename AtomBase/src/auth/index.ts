import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { Lock } from "../util/lock"
import { Crypto } from "../util/crypto"

export const OAUTH_DUMMY_KEY = "atomcli-oauth-dummy-key"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
      accountId: z.string().optional(),
      enterpriseUrl: z.string().optional(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown]).meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) {
    const auth = await all()
    return auth[providerID]
  }

  /**
   * Read all auth entries. Handles both encrypted and plaintext (legacy) data.
   * Uses a read lock to prevent concurrent read/write conflicts.
   */
  export async function all(): Promise<Record<string, Info>> {
    using _ = await Lock.read("auth")
    const file = Bun.file(filepath)
    const raw = await file.text().catch(() => "")
    if (!raw.trim()) return {}

    let data: Record<string, unknown>
    try {
      data = await Crypto.decryptJSON<Record<string, unknown>>(raw)
    } catch {
      // If decryption fails, try parsing as plain JSON (legacy/corrupted)
      try {
        data = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return {}
      }
    }

    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (!parsed.success) return acc
        acc[key] = parsed.data
        return acc
      },
      {} as Record<string, Info>,
    )
  }

  /**
   * Set an auth entry. Data is encrypted before writing.
   * Uses a write lock to prevent concurrent modifications.
   */
  export async function set(key: string, info: Info) {
    using _ = await Lock.write("auth")
    const file = Bun.file(filepath)

    // Read current data (without lock since we already hold the write lock)
    const raw = await file.text().catch(() => "")
    let currentData: Record<string, unknown> = {}
    if (raw.trim()) {
      try {
        currentData = await Crypto.decryptJSON<Record<string, unknown>>(raw)
      } catch {
        try {
          currentData = JSON.parse(raw) as Record<string, unknown>
        } catch {
          currentData = {}
        }
      }
    }

    // Validate existing entries
    const validData: Record<string, Info> = {}
    for (const [k, v] of Object.entries(currentData)) {
      const parsed = Info.safeParse(v)
      if (parsed.success) validData[k] = parsed.data
    }

    const encrypted = await Crypto.encryptJSON({ ...validData, [key]: info })
    await Bun.write(file, encrypted)
    await fs.chmod(file.name!, 0o600)
  }

  /**
   * Remove an auth entry. Uses a write lock to prevent concurrent modifications.
   */
  export async function remove(key: string) {
    using _ = await Lock.write("auth")
    const file = Bun.file(filepath)

    // Read current data (without lock since we already hold the write lock)
    const raw = await file.text().catch(() => "")
    let currentData: Record<string, unknown> = {}
    if (raw.trim()) {
      try {
        currentData = await Crypto.decryptJSON<Record<string, unknown>>(raw)
      } catch {
        try {
          currentData = JSON.parse(raw) as Record<string, unknown>
        } catch {
          currentData = {}
        }
      }
    }

    // Validate existing entries
    const validData: Record<string, Info> = {}
    for (const [k, v] of Object.entries(currentData)) {
      const parsed = Info.safeParse(v)
      if (parsed.success) validData[k] = parsed.data
    }

    delete validData[key]
    const encrypted = await Crypto.encryptJSON(validData)
    await Bun.write(file, encrypted)
    await fs.chmod(file.name!, 0o600)
  }
}
