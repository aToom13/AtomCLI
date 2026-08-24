import path from "path"
import z from "zod"
import type { Client, FileEntryWithStats, SFTPWrapper, Stats } from "ssh2"
import DESCRIPTION from "./ssh.txt"
import { Tool } from "./tool"
import { RemoteConnection } from "@/integrations/remote/connection-pool"
import { RemoteProfileStore } from "@/integrations/remote/profile-store"

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 30 * 60 * 1000
const MAX_COMMAND_OUTPUT_BYTES = 5 * 1024 * 1024
const MAX_REMOTE_READ_BYTES = 2 * 1024 * 1024
const MAX_REMOTE_WRITE_BYTES = 2 * 1024 * 1024
const MAX_SECRET_LENGTH = 16 * 1024
const MAX_PRIVATE_KEY_LENGTH = 1024 * 1024
const MAX_RECURSIVE_ENTRIES = 10_000
const MAX_METADATA_OUTPUT_BYTES = 30_000
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/

const parameters = z
  .object({
    host: z
      .string()
      .min(1)
      .max(100)
      .regex(PROFILE_NAME_PATTERN, "Use letters, numbers, dot, dash, or underscore")
      .optional()
      .describe("SSH profile name. For profile_add, an omitted name defaults to username."),
    timeout: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional().describe("Operation timeout in milliseconds"),
    action: z.enum([
      "profile_list",
      "profile_add",
      "profile_remove",
      "exec",
      "read",
      "write",
      "list",
      "stat",
      "mkdir",
      "remove",
    ]),
    command: z.string().min(1).max(100_000).optional().describe("Required only for exec"),
    description: z.string().min(1).max(1000).optional().describe("Optional title for exec"),
    path: z.string().min(1).max(4096).optional().describe("Required for every filesystem action"),
    content: z.string().max(MAX_REMOTE_WRITE_BYTES).optional().describe("Required only for write"),
    recursive: z.boolean().optional().describe("mkdir defaults to true; remove defaults to false"),
    hostname: z.string().min(1).max(253).optional().describe("Server hostname or IP; required only for profile_add"),
    port: z.number().int().min(1).max(65535).optional().describe("SSH port for profile_add; defaults to 22"),
    username: z.string().min(1).max(255).optional().describe("SSH username; required only for profile_add"),
    password: z
      .string()
      .max(MAX_SECRET_LENGTH)
      .optional()
      .describe("Password authentication secret; only for profile_add"),
    privateKey: z
      .string()
      .max(MAX_PRIVATE_KEY_LENGTH)
      .optional()
      .describe("Private key contents; only for profile_add"),
    passphrase: z.string().max(MAX_SECRET_LENGTH).optional().describe("Private-key passphrase; only for profile_add"),
    hostKey: z
      .string()
      .regex(/^SHA256:[A-Za-z0-9+/]+={0,2}$/)
      .optional()
      .describe("Optional pinned OpenSSH SHA-256 host fingerprint for profile_add"),
    connectTimeout: z
      .number()
      .int()
      .min(1)
      .max(120_000)
      .optional()
      .describe("SSH handshake timeout override for profile_add or a connection operation"),
    overwrite: z.boolean().optional().describe("Allow profile_add to replace an existing managed profile"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (field: keyof typeof value, message: string) =>
      ctx.addIssue({ code: "custom", path: [field], message })
    const profileFields = [
      "hostname",
      "port",
      "username",
      "password",
      "privateKey",
      "passphrase",
      "hostKey",
      "connectTimeout",
      "overwrite",
    ] as const
    const operationFields = ["timeout", "command", "description", "path", "content", "recursive"] as const
    const rejectPresent = (fields: readonly (keyof typeof value)[], action: string) => {
      for (const field of fields) {
        if (value[field] !== undefined) issue(field, `${String(field)} is not valid for ${action}`)
      }
    }

    if (value.action === "profile_list") {
      if (value.host !== undefined) issue("host", "host is not valid for profile_list")
      rejectPresent([...profileFields, ...operationFields], value.action)
      return
    }

    if (value.action === "profile_add") {
      if (!value.hostname) issue("hostname", "hostname is required for profile_add")
      if (!value.username) issue("username", "username is required for profile_add")
      if (!value.password && !value.privateKey) issue("password", "password or privateKey is required for profile_add")
      if (!value.host && value.username && !PROFILE_NAME_PATTERN.test(value.username)) {
        issue("host", "host alias is required when username is not a safe profile name")
      }
      rejectPresent(operationFields, value.action)
      return
    }

    if (!value.host) issue("host", `host is required for ${value.action}`)

    if (value.action === "profile_remove") {
      rejectPresent([...profileFields, ...operationFields], value.action)
      return
    }

    rejectPresent(
      profileFields.filter((field) => field !== "connectTimeout"),
      value.action,
    )

    if (value.action === "exec") {
      if (!value.command) issue("command", "command is required for exec")
      if (value.path !== undefined) issue("path", "path is not valid for exec")
      if (value.content !== undefined) issue("content", "content is not valid for exec")
      if (value.recursive !== undefined) {
        ctx.addIssue({ code: "custom", path: ["recursive"], message: "recursive is not valid for exec" })
      }
      return
    }

    if (!value.path) issue("path", `path is required for ${value.action}`)
    if (value.command !== undefined) issue("command", `command is not valid for ${value.action}`)
    if (value.action === "write") {
      if (value.content === undefined) issue("content", "content is required for write")
    } else if (value.content !== undefined) issue("content", `content is not valid for ${value.action}`)
    if (!["mkdir", "remove"].includes(value.action) && value.recursive !== undefined) {
      ctx.addIssue({ code: "custom", path: ["recursive"], message: `recursive is not valid for ${value.action}` })
    }
  })

type Parameters = z.infer<typeof parameters>
type RemoteMetadata = {
  host?: string
  action: Parameters["action"]
  description?: string
  target?: string
  output?: string
  path?: string
  exit?: number | null
  bytes?: number
  entries?: number
}

function profileName(input: Parameters) {
  return input.host ?? input.username!
}

function callback<T>(invoke: (done: (error: Error | undefined, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    invoke((error, value) => {
      if (error) reject(error)
      else resolve(value)
    })
  })
}

function done(invoke: (finish: (error?: Error) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    invoke((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function formatStats(value: Stats) {
  const type = value.isDirectory() ? "directory" : value.isSymbolicLink() ? "symlink" : "file"
  return [
    `type: ${type}`,
    `size: ${value.size}`,
    `mode: ${(value.mode & 0o7777).toString(8)}`,
    `modified: ${new Date(value.mtime * 1000).toISOString()}`,
  ].join("\n")
}

function formatEntry(entry: FileEntryWithStats) {
  const type = entry.attrs.isDirectory() ? "d" : entry.attrs.isSymbolicLink() ? "l" : "f"
  return `${type}\t${entry.attrs.size}\t${new Date(entry.attrs.mtime * 1000).toISOString()}\t${entry.filename}`
}

async function mkdirRecursive(sftp: SFTPWrapper, remotePath: string) {
  const normalized = path.posix.normalize(remotePath)
  const segments = normalized.split("/").filter(Boolean)
  let current = normalized.startsWith("/") ? "/" : ""
  for (const segment of segments) {
    current = current === "/" ? `/${segment}` : current ? `${current}/${segment}` : segment
    try {
      await done((finish) => sftp.mkdir(current, finish))
    } catch (error) {
      const stats = await callback<Stats>((finish) => sftp.stat(current, finish)).catch(() => undefined)
      if (!stats?.isDirectory()) throw error
    }
  }
}

async function removeRecursive(sftp: SFTPWrapper, remotePath: string, counter: { value: number }) {
  if (++counter.value > MAX_RECURSIVE_ENTRIES)
    throw new Error(`Recursive removal exceeds ${MAX_RECURSIVE_ENTRIES} entries`)
  const stats = await callback<Stats>((finish) => sftp.lstat(remotePath, finish))
  if (!stats.isDirectory()) {
    await done((finish) => sftp.unlink(remotePath, finish))
    return
  }
  const entries = await callback<FileEntryWithStats[]>((finish) => sftp.readdir(remotePath, finish))
  for (const entry of entries) {
    if (entry.filename === "." || entry.filename === "..") continue
    await removeRecursive(sftp, path.posix.join(remotePath, entry.filename), counter)
  }
  await done((finish) => sftp.rmdir(remotePath, finish))
}

async function executeCommand(
  command: string,
  client: Client,
  signal: AbortSignal,
  onOutput: (output: string) => void,
) {
  return new Promise<{ output: string; exitCode: number | null }>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Remote command aborted"))
      return
    }
    client.exec(command, (error, channel) => {
      if (error) {
        reject(error)
        return
      }
      const chunks: Buffer[] = []
      const preview: Buffer[] = []
      let bytes = 0
      let previewBytes = 0
      let exitCode: number | null = null
      let lastUpdate = 0
      let settled = false

      const append = (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_COMMAND_OUTPUT_BYTES) channel.close()
        else {
          chunks.push(chunk)
          if (previewBytes < MAX_METADATA_OUTPUT_BYTES) {
            const captured = chunk.subarray(0, MAX_METADATA_OUTPUT_BYTES - previewBytes)
            preview.push(captured)
            previewBytes += captured.length
          }
          const now = Date.now()
          if (now - lastUpdate >= 100) {
            lastUpdate = now
            onOutput(Buffer.concat(preview, previewBytes).toString("utf8"))
          }
        }
      }
      channel.on("data", append)
      channel.stderr.on("data", append)
      channel.on("exit", (code) => {
        exitCode = typeof code === "number" ? code : null
      })

      const abort = () => channel.close()
      signal.addEventListener("abort", abort, { once: true })
      channel.once("error", (channelError) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", abort)
        reject(channelError)
      })
      channel.once("close", () => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", abort)
        if (signal.aborted) {
          reject(signal.reason ?? new Error("Remote command aborted"))
          return
        }
        if (bytes > MAX_COMMAND_OUTPUT_BYTES) {
          reject(new Error(`Remote command output exceeds ${MAX_COMMAND_OUTPUT_BYTES} bytes`))
          return
        }
        const output = Buffer.concat(chunks, bytes).toString("utf8")
        onOutput(output.slice(0, MAX_METADATA_OUTPUT_BYTES))
        resolve({ output, exitCode })
      })
      if (signal.aborted) abort()
    })
  })
}

export const SshTool = Tool.define<typeof parameters, RemoteMetadata>("ssh", async () => {
  const hosts = await RemoteProfileStore.all()
  const availableProfiles = Object.entries(hosts)
    .map(([name, profile]) => `- ${name}: ${profile.username}@${profile.host}:${profile.port}`)
    .join("\n")

  return {
    description: `${DESCRIPTION}\n\nAvailable SSH profiles:\n${availableProfiles || "- none configured"}`,
    parameters,
    async execute(input, ctx) {
      if (input.action === "profile_list") {
        const profiles = await RemoteProfileStore.all()
        const output = Object.entries(profiles)
          .map(
            ([name, profile]) =>
              `${name}\t${profile.username}@${profile.host}:${profile.port}\thost-key:${profile.hostKey ?? "untrusted"}`,
          )
          .join("\n")
        return {
          title: "SSH profiles",
          output: output || "No SSH profiles configured",
          metadata: { action: input.action, entries: Object.keys(profiles).length },
        }
      }

      await ctx.ask({
        permission: "ssh",
        patterns: ["*"],
        always: ["*"],
        metadata: { host: input.action === "profile_add" ? profileName(input) : input.host, action: input.action },
      })

      if (input.action === "profile_add") {
        const name = profileName(input)
        const profile = await RemoteProfileStore.set(
          name,
          {
            host: input.hostname!,
            port: input.port,
            username: input.username!,
            password: input.password,
            privateKey: input.privateKey,
            passphrase: input.passphrase,
            hostKey: input.hostKey,
            connectTimeout: input.connectTimeout,
          },
          input.overwrite === true,
        )
        await RemoteConnection.invalidate(name)
        return {
          title: `Saved SSH profile ${name}`,
          output: `Saved encrypted SSH profile '${name}' for ${profile.username}@${profile.host}:${profile.port}. It is available immediately; use action=exec next.`,
          metadata: { host: name, action: input.action },
        }
      }

      if (input.action === "profile_remove") {
        const removed = await RemoteProfileStore.remove(input.host!)
        if (!removed) {
          throw new Error(
            `SSH profile '${input.host}' is not managed by the ssh tool. Profiles declared manually in global config cannot be removed here.`,
          )
        }
        await RemoteConnection.invalidate(input.host!)
        return {
          title: `Removed SSH profile ${input.host}`,
          output: `Removed managed SSH profile '${input.host}'`,
          metadata: { host: input.host, action: input.action },
        }
      }

      const hosts = await RemoteProfileStore.all()
      const configuredProfile = hosts[input.host!]
      if (!configuredProfile) {
        throw new Error(
          `Unknown SSH profile '${input.host}'. Use action=profile_add with hostname, username, and password/privateKey; do not read or edit AtomCLI config files.`,
        )
      }
      const profile = input.connectTimeout
        ? { ...configuredProfile, connectTimeout: input.connectTimeout }
        : configuredProfile

      const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
      const signal = AbortSignal.any([ctx.abort, AbortSignal.timeout(timeout)])
      if (input.action === "exec") {
        ctx.metadata({
          metadata: {
            host: input.host,
            action: input.action,
            description: input.description,
            target: `${profile.username}@${profile.host}:${profile.port}`,
            output: "",
          },
        })
      }
      const lease = await RemoteConnection.acquire({
        name: input.host!,
        profile,
        signal,
        async verifyUnknownHost(fingerprint) {
          await ctx.ask({
            permission: "ssh",
            patterns: [`${input.host}:hostkey:${fingerprint}`],
            always: [`${input.host}:hostkey:${fingerprint}`],
            metadata: { host: input.host, fingerprint, reason: "Unknown SSH host key" },
          })
          await RemoteProfileStore.pin(input.host!, fingerprint)
        },
      })
      try {
        const client = lease.client

        if (input.action === "exec") {
          const updateOutput = (output: string) =>
            ctx.metadata({
              metadata: {
                host: input.host,
                action: input.action,
                description: input.description,
                target: `${profile.username}@${profile.host}:${profile.port}`,
                output,
              },
            })
          const result = await executeCommand(input.command!, client, signal, updateOutput)
          return {
            title: input.description ?? `Remote command on ${input.host}`,
            output: result.output,
            metadata: {
              host: input.host,
              action: input.action,
              description: input.description,
              target: `${profile.username}@${profile.host}:${profile.port}`,
              output: result.output.slice(0, MAX_METADATA_OUTPUT_BYTES),
              exit: result.exitCode,
            },
          }
        }

        const sftp = await RemoteConnection.sftp(client, signal)
        const abort = () => sftp.end()
        signal.addEventListener("abort", abort, { once: true })
        try {
          if (input.action === "read") {
            const stats = await callback<Stats>((finish) => sftp.stat(input.path!, finish))
            if (stats.size > MAX_REMOTE_READ_BYTES) {
              throw new Error(`Remote file is ${stats.size} bytes; read limit is ${MAX_REMOTE_READ_BYTES} bytes`)
            }
            const content = await callback<Buffer>((finish) => sftp.readFile(input.path!, finish))
            return {
              title: `Read ${input.path} on ${input.host}`,
              output: content.toString("utf8"),
              metadata: { host: input.host, action: input.action, path: input.path, bytes: content.length },
            }
          }

          if (input.action === "write") {
            const bytes = Buffer.byteLength(input.content!)
            if (bytes > MAX_REMOTE_WRITE_BYTES) throw new Error(`Remote write exceeds ${MAX_REMOTE_WRITE_BYTES} bytes`)
            await done((finish) => sftp.writeFile(input.path!, input.content!, finish))
            return {
              title: `Wrote ${input.path} on ${input.host}`,
              output: `Wrote ${bytes} bytes to ${input.path}`,
              metadata: { host: input.host, action: input.action, path: input.path, bytes },
            }
          }

          if (input.action === "list") {
            const entries = await callback<FileEntryWithStats[]>((finish) => sftp.readdir(input.path!, finish))
            return {
              title: `Listed ${input.path} on ${input.host}`,
              output: entries.map(formatEntry).join("\n"),
              metadata: { host: input.host, action: input.action, path: input.path, entries: entries.length },
            }
          }

          if (input.action === "stat") {
            const stats = await callback<Stats>((finish) => sftp.lstat(input.path!, finish))
            return {
              title: `Stat ${input.path} on ${input.host}`,
              output: formatStats(stats),
              metadata: { host: input.host, action: input.action, path: input.path },
            }
          }

          if (input.action === "mkdir") {
            if (input.recursive !== false) await mkdirRecursive(sftp, input.path!)
            else await done((finish) => sftp.mkdir(input.path!, finish))
            return {
              title: `Created ${input.path} on ${input.host}`,
              output: `Created remote directory ${input.path}`,
              metadata: { host: input.host, action: input.action, path: input.path },
            }
          }

          if (input.recursive === true) await removeRecursive(sftp, input.path!, { value: 0 })
          else {
            const stats = await callback<Stats>((finish) => sftp.lstat(input.path!, finish))
            if (stats.isDirectory()) await done((finish) => sftp.rmdir(input.path!, finish))
            else await done((finish) => sftp.unlink(input.path!, finish))
          }
          return {
            title: `Removed ${input.path} on ${input.host}`,
            output: `Removed remote path ${input.path}`,
            metadata: { host: input.host, action: input.action, path: input.path },
          }
        } finally {
          signal.removeEventListener("abort", abort)
          sftp.end()
        }
      } finally {
        lease.release()
      }
    },
  }
})
