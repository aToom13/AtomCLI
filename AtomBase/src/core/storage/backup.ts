import fs from "fs/promises"
import path from "path"
import z from "zod"

const BackupInfo = z.object({
  version: z.literal(1),
  createdAt: z.number(),
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
})

type BackupInfo = z.infer<typeof BackupInfo>

export namespace StorageBackup {
  async function exists(target: string) {
    return fs
      .access(target)
      .then(() => true)
      .catch(() => false)
  }

  function hash(content: Uint8Array) {
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(content)
    return hasher.digest("hex")
  }

  function safeRelative(value: string) {
    if (!value || path.isAbsolute(value) || value.split(/[\\/]/).some((part) => part === "..")) {
      throw new Error(`Unsafe backup path: ${value}`)
    }
    return value
  }

  async function filesUnder(root: string, prefix = ""): Promise<string[]> {
    const directory = path.join(root, prefix)
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    const files: string[] = []
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name
      if (entry.isDirectory()) files.push(...(await filesUnder(root, relative)))
      else if (entry.isFile()) files.push(relative)
    }
    return files
  }

  async function validateFile(root: string, entry: BackupInfo["files"][number]) {
    const relative = safeRelative(entry.path)
    const content = new Uint8Array(await Bun.file(path.join(root, "records", relative)).arrayBuffer())
    if (content.byteLength !== entry.bytes || hash(content) !== entry.sha256) {
      throw new Error(`Storage backup integrity check failed: ${relative}`)
    }
  }

  export async function verify(root: string) {
    const info = BackupInfo.parse(await Bun.file(path.join(root, "manifest.json")).json())
    for (const entry of info.files) await validateFile(root, entry)
    return info
  }

  export async function createLegacy(sourceDir: string, root: string, createdAt = Date.now()) {
    if (await exists(path.join(root, "manifest.json"))) return verify(root)
    const partial = `${root}.partial.${process.pid}.${crypto.randomUUID()}`
    await fs.mkdir(path.join(partial, "records"), { recursive: true })
    const files: BackupInfo["files"] = []
    if (await exists(sourceDir)) {
      for (const relative of await filesUnder(sourceDir)) {
        if (!relative.endsWith(".json")) continue
        if (relative.split(path.sep)[0] === ".blobs") continue
        const safe = safeRelative(relative)
        const content = new Uint8Array(await Bun.file(path.join(sourceDir, safe)).arrayBuffer())
        const target = path.join(partial, "records", safe)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await Bun.write(target, content)
        files.push({ path: safe, bytes: content.byteLength, sha256: hash(content) })
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    const info: BackupInfo = { version: 1, createdAt, files }
    await Bun.write(path.join(partial, "manifest.json"), JSON.stringify(info, null, 2))
    await verify(partial)
    await fs.mkdir(path.dirname(root), { recursive: true })
    try {
      await fs.rename(partial, root)
      return info
    } catch (error: unknown) {
      if (!(await exists(path.join(root, "manifest.json")))) throw error
      await fs.rm(partial, { recursive: true, force: true })
      return verify(root)
    }
  }

  export async function restore(input: { backupDir: string; destination: string; dryRun?: boolean }) {
    const info = await verify(input.backupDir)
    if (input.dryRun) return { files: info.files.length, applied: false }
    const existing = await fs.readdir(input.destination).catch(() => [])
    if (existing.length) throw new Error(`Storage restore destination is not empty: ${input.destination}`)
    const staging = `${input.destination}.restore.${process.pid}.${crypto.randomUUID()}`
    try {
      for (const entry of info.files) {
        const relative = safeRelative(entry.path)
        const target = path.join(staging, relative)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(path.join(input.backupDir, "records", relative), target)
        const content = new Uint8Array(await Bun.file(target).arrayBuffer())
        if (content.byteLength !== entry.bytes || hash(content) !== entry.sha256) {
          throw new Error(`Storage restore integrity check failed: ${relative}`)
        }
      }
      await fs.mkdir(path.dirname(input.destination), { recursive: true })
      if (existing.length === 0) await fs.rmdir(input.destination).catch(() => {})
      await fs.rename(staging, input.destination)
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true })
      throw error
    }
    return { files: info.files.length, applied: true }
  }
}
