import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { Crypto } from "@/util/util/crypto"
import { Lock } from "@/util/util/lock"

const ProfileName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, dash, or underscore")
const Profiles = z.record(ProfileName, Config.RemoteHost)

function filepath() {
  return path.join(Global.Path.data, "ssh-profiles.json")
}

function lockKey() {
  return `ssh-profiles:${filepath()}`
}

export namespace RemoteProfileStore {
  export type Info = Config.RemoteHost

  async function readManagedUnlocked(): Promise<Record<string, Info>> {
    const raw = await Bun.file(filepath())
      .text()
      .catch(() => "")
    if (!raw.trim()) return {}
    try {
      return Profiles.parse(await Crypto.decryptJSON(raw))
    } catch {
      throw new Error("Managed SSH profile store is corrupted or cannot be decrypted")
    }
  }

  async function writeManagedUnlocked(profiles: Record<string, Info>) {
    const encrypted = await Crypto.encryptJSON(Profiles.parse(profiles))
    await fs.mkdir(Global.Path.data, { recursive: true })
    await Bun.write(filepath(), encrypted)
    if (process.platform !== "win32") await fs.chmod(filepath(), 0o600)
  }

  export async function managed() {
    using _ = await Lock.read(lockKey())
    return readManagedUnlocked()
  }

  export async function all() {
    const configured = (await Config.global()).remote?.hosts ?? {}
    return { ...configured, ...(await managed()) }
  }

  export async function set(name: string, profile: Info, overwrite = false) {
    const validName = ProfileName.parse(name)
    const validProfile = Config.RemoteHost.parse(profile)
    using _ = await Lock.write(lockKey())
    const profiles = await readManagedUnlocked()
    const configured = (await Config.global()).remote?.hosts ?? {}
    if ((profiles[validName] || configured[validName]) && !overwrite) {
      throw new Error(`SSH profile '${validName}' already exists; set overwrite=true to replace it`)
    }
    profiles[validName] = validProfile
    await writeManagedUnlocked(profiles)
    return validProfile
  }

  export async function pin(name: string, fingerprint: string) {
    using _ = await Lock.write(lockKey())
    const profiles = await readManagedUnlocked()
    const profile = profiles[name]
    if (!profile) return false
    profiles[name] = Config.RemoteHost.parse({ ...profile, hostKey: fingerprint })
    await writeManagedUnlocked(profiles)
    return true
  }

  export async function remove(name: string) {
    const validName = ProfileName.parse(name)
    using _ = await Lock.write(lockKey())
    const profiles = await readManagedUnlocked()
    if (!profiles[validName]) return false
    delete profiles[validName]
    await writeManagedUnlocked(profiles)
    return true
  }
}
