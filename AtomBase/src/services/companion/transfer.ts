import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Bus } from "@/core/bus"
import { BusEvent } from "@/core/bus/bus-event"
import { SessionPrompt } from "@/core/session/prompt"
import { EnvPolicy } from "@/core/env/policy"
import { ExecutionWorld } from "@/core/execution/world"
import { Provider } from "@/integrations/provider/provider"
import { Shell } from "@/interfaces/shell/shell"
import { Instance } from "@/services/project/instance"
import { Filesystem } from "@/util/util/filesystem"
import { Log } from "@/util/util/log"

const MAX_ARTIFACTS = 100
const MAX_PREVIEWS = 20
const MAX_UPLOAD_TICKETS = 20
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_LOG_BYTES = 128 * 1024
const TICKET_TTL_MS = 10 * 60 * 1000
const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000
const TEXT_UPLOAD_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".dart",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".vue",
  ".svelte",
  ".astro",
  ".gradle",
  ".properties",
  ".ini",
  ".env",
])

function isTextUpload(filename: string, mime: string) {
  const basename = path.basename(filename).toLowerCase()
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/javascript",
      "application/x-yaml",
    ].includes(mime) ||
    TEXT_UPLOAD_EXTENSIONS.has(path.extname(basename)) ||
    ["dockerfile", "makefile", "justfile", ".gitignore", ".gitattributes"].includes(basename)
  )
}

function isDirectModelInput(mime: string) {
  return (
    mime.startsWith("image/") || mime === "application/pdf" || mime.startsWith("audio/") || mime.startsWith("video/")
  )
}

function directInputModality(mime: string): "image" | "pdf" | "audio" | "video" | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
}

async function selectedModelSupportsInput(modelSpec: string | undefined, mime: string) {
  const modality = directInputModality(mime)
  if (!modality || !modelSpec) return false
  const slash = modelSpec.indexOf("/")
  if (slash <= 0 || slash === modelSpec.length - 1) return false
  try {
    const model = await Provider.getModel(modelSpec.slice(0, slash), modelSpec.slice(slash + 1))
    return model.capabilities.input[modality]
  } catch {
    return false
  }
}

export namespace CompanionTransfer {
  const log = Log.create({ service: "companion-transfer" })

  export const Artifact = z.object({
    id: z.string(),
    kind: z.enum(["file", "image"]),
    direction: z.enum(["pc_to_mobile", "mobile_to_pc"]),
    sourceDevice: z.string(),
    title: z.string(),
    name: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    createdAt: z.number().int(),
    sessionID: z.string().optional(),
    downloadPath: z.string(),
  })
  export type Artifact = z.infer<typeof Artifact>

  export const Preview = z.object({
    id: z.string(),
    title: z.string(),
    command: z.string(),
    port: z.number().int(),
    status: z.enum(["starting", "running", "stopped", "failed"]),
    endpoints: z.string().array(),
    logTail: z.string(),
    createdAt: z.number().int(),
    sourceDevice: z.string(),
    directory: z.string(),
    sessionID: z.string().optional(),
    exitCode: z.number().int().optional(),
  })
  export type Preview = z.infer<typeof Preview>

  export const Event = {
    ArtifactShared: BusEvent.define("companion.artifact.shared", Artifact),
    PreviewUpdated: BusEvent.define("companion.preview.updated", Preview),
  }

  type ArtifactRecord = Artifact & { filePath: string; token: string; expiresAt: number }
  type UploadTicket = {
    id: string
    token: string
    filename: string
    mime: string
    size: number
    sessionID: string
    directory: string
    deviceName: string
    model?: string
    agent?: string
    variant?: string
    expiresAt: number
  }
  type PreviewRecord = Preview & { process?: Bun.Subprocess }

  const state = Instance.state(
    () => ({
      artifacts: new Map<string, ArtifactRecord>(),
      uploads: new Map<string, UploadTicket>(),
      previews: new Map<string, PreviewRecord>(),
    }),
    async (current) => {
      for (const preview of current.previews.values()) stopProcess(preview.process)
    },
  )

  export const _internals = {
    isTextUpload,
    isDirectModelInput,
    directInputModality,
  }

  function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, maximum: number) {
    map.delete(key)
    map.set(key, value)
    while (map.size > maximum) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  function prune(now = Date.now()) {
    const current = state()
    for (const [id, artifact] of current.artifacts) {
      if (artifact.expiresAt <= now) current.artifacts.delete(id)
    }
    for (const [id, ticket] of current.uploads) {
      if (ticket.expiresAt <= now) current.uploads.delete(id)
    }
  }

  function safeFilename(value: string) {
    const name = path
      .basename(value)
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .trim()
    return name.slice(0, 180) || "mobile-upload"
  }

  function downloadPath(id: string, token: string) {
    const query = new URLSearchParams({ token, directory: Instance.directory })
    return `/companion/artifact/${encodeURIComponent(id)}?${query}`
  }

  function artifactPublic(record: ArtifactRecord): Artifact {
    const { filePath: _filePath, token: _token, expiresAt: _expiresAt, ...artifact } = record
    return artifact
  }

  function publishArtifact(record: ArtifactRecord) {
    Bus.publish(Event.ArtifactShared, artifactPublic(record))
  }

  function publishPreview(record: PreviewRecord) {
    const { process: _process, ...preview } = record
    Bus.publish(Event.PreviewUpdated, preview)
  }

  export async function shareFile(input: {
    filePath: string
    title?: string
    sessionID?: string
    direction?: "pc_to_mobile" | "mobile_to_pc"
    sourceDevice?: string
  }) {
    prune()
    const resolved = await fs.realpath(path.resolve(input.filePath))
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) throw new Error("Only regular files can be sent to the companion")
    if (stat.size > MAX_DOWNLOAD_BYTES) {
      throw new Error(`File exceeds the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB companion limit`)
    }
    const id = `artifact_${crypto.randomUUID()}`
    const token = crypto.randomUUID().replaceAll("-", "")
    const file = Bun.file(resolved)
    const name = safeFilename(resolved)
    const mime = file.type || "application/octet-stream"
    const record: ArtifactRecord = {
      id,
      kind: mime.startsWith("image/") ? "image" : "file",
      direction: input.direction ?? "pc_to_mobile",
      sourceDevice: input.sourceDevice ?? os.hostname(),
      title: input.title?.trim() || name,
      name,
      mime,
      size: stat.size,
      createdAt: Date.now(),
      sessionID: input.sessionID,
      filePath: resolved,
      token,
      expiresAt: Date.now() + ARTIFACT_TTL_MS,
      downloadPath: downloadPath(id, token),
    }
    boundedSet(state().artifacts, id, record, MAX_ARTIFACTS)
    publishArtifact(record)
    return artifactPublic(record)
  }

  export function artifact(id: string, token: string) {
    prune()
    const record = state().artifacts.get(id)
    if (!record || record.token !== token) return undefined
    return record
  }

  export async function createUpload(input: {
    filename: string
    mime: string
    size: number
    sessionID: string
    directory: string
    deviceName: string
    model?: string
    agent?: string
    variant?: string
  }) {
    prune()
    if (input.size < 0 || input.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Upload exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB companion limit`)
    }
    const id = `upload_${crypto.randomUUID()}`
    const token = crypto.randomUUID().replaceAll("-", "")
    const ticket: UploadTicket = {
      ...input,
      id,
      token,
      filename: safeFilename(input.filename),
      mime: input.mime || "application/octet-stream",
      expiresAt: Date.now() + TICKET_TTL_MS,
    }
    boundedSet(state().uploads, id, ticket, MAX_UPLOAD_TICKETS)
    const query = new URLSearchParams({ token, directory: input.directory })
    return {
      id,
      uploadPath: `/companion/upload/${encodeURIComponent(id)}?${query}`,
      expiresAt: ticket.expiresAt,
    }
  }

  export async function acceptUpload(input: {
    id: string
    token: string
    contentLength?: number
    body: ReadableStream<Uint8Array> | null
  }) {
    prune()
    const ticket = state().uploads.get(input.id)
    if (!ticket || ticket.token !== input.token) throw new Error("Upload ticket is invalid or expired")
    if (!input.body) throw new Error("Upload body is empty")
    if (input.contentLength === undefined) {
      throw new Error("Upload Content-Length is required")
    }
    if (input.contentLength > MAX_UPLOAD_BYTES || input.contentLength !== ticket.size) {
      throw new Error("Uploaded file size did not match the transfer request")
    }
    state().uploads.delete(input.id)
    const uploadDirectory = path.join(ticket.directory, ".atomcli", "inbox", "mobile")
    await fs.mkdir(uploadDirectory, { recursive: true })
    const resolvedUploadDirectory = await fs.realpath(uploadDirectory)
    if (!Filesystem.contains(ticket.directory, resolvedUploadDirectory)) {
      throw new Error("Companion upload directory resolves outside the selected workspace")
    }
    const target = path.join(resolvedUploadDirectory, `${Date.now()}-${ticket.filename}`)
    await Bun.write(target, new Response(input.body))
    const stat = await fs.stat(target)
    if (stat.size > MAX_UPLOAD_BYTES || (ticket.size > 0 && stat.size !== ticket.size)) {
      await fs.unlink(target).catch(() => {})
      throw new Error("Uploaded file size did not match the transfer request")
    }
    const artifact = await shareFile({
      filePath: target,
      title: ticket.filename,
      sessionID: ticket.sessionID,
      direction: "mobile_to_pc",
      sourceDevice: ticket.deviceName,
    })
    return { artifact, filePath: target }
  }

  /// Convert files already uploaded from Android into prompt parts only when
  /// the user sends the draft. This keeps upload and model execution separate.
  export async function promptParts(input: {
    artifactIDs: string[]
    sessionID: string
    model?: string
  }): Promise<SessionPrompt.PromptInput["parts"]> {
    prune()
    const parts: SessionPrompt.PromptInput["parts"] = []
    for (const id of Array.from(new Set(input.artifactIDs))) {
      const record = state().artifacts.get(id)
      if (!record || record.direction !== "mobile_to_pc" || record.sessionID !== input.sessionID) {
        throw new Error("A staged mobile attachment is no longer available")
      }
      const textUpload = isTextUpload(record.name, record.mime)
      const nativeModelInput = await selectedModelSupportsInput(input.model, record.mime)
      if (textUpload || nativeModelInput) {
        parts.push({
          type: "file",
          mime: textUpload ? "text/plain" : record.mime,
          filename: record.name,
          url: pathToFileURL(record.filePath).href,
        })
        continue
      }
      parts.push({
        type: "text",
        text: `The phone attachment ${record.name} was saved on this machine at ${record.filePath}. The selected model does not accept it as a native attachment. Inspect it with the appropriate AtomCLI tools; do not claim that the upload failed.`,
      })
    }
    return parts
  }

  function previewPublic(record: PreviewRecord): Preview {
    const { process: _process, ...preview } = record
    return preview
  }

  function stopProcess(child: Bun.Subprocess | undefined) {
    if (!child) return
    try {
      if (process.platform !== "win32") {
        // Preview commands run in their own process group. Signalling the group
        // prevents shells such as `bun run dev` from leaving the real server
        // alive after the Companion stop action.
        process.kill(-child.pid, "SIGTERM")
      } else {
        child.kill()
      }
    } catch {
      try {
        child.kill()
      } catch {
        // The process may already have exited between the status check and stop.
      }
    }
  }

  function appendLog(record: PreviewRecord, text: string) {
    record.logTail = (record.logTail + text).slice(-MAX_LOG_BYTES)
  }

  async function capture(stream: ReadableStream<Uint8Array>, record: PreviewRecord) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        appendLog(record, decoder.decode(value, { stream: true }))
      }
      appendLog(record, decoder.decode())
    } catch (error) {
      log.warn("preview log stream ended", { error, id: record.id })
    } finally {
      reader.releaseLock()
    }
  }

  async function previewEndpoints(port: number) {
    const { CompanionDiscovery } = await import("@atomcli/companion")
    const endpoints = CompanionDiscovery.detectEndpoints(port).map((item) => {
      const parsed = new URL(item.url)
      return `http://${parsed.hostname}:${port}`
    })
    const magicDNS = await CompanionDiscovery.getTailscaleMagicDNS()
    if (magicDNS) endpoints.push(`http://${magicDNS}:${port}`)
    return Array.from(new Set(endpoints))
  }

  async function waitForPreview(record: PreviewRecord, attempts: number) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (record.status === "stopped" || record.status === "failed" || record.process?.exitCode !== null) return false
      const reachable = await fetch(`http://127.0.0.1:${record.port}`, {
        signal: AbortSignal.timeout(250),
      })
        .then(() => true)
        .catch(() => false)
      if (reachable) {
        record.status = "running"
        publishPreview(record)
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return false
  }

  export async function startPreview(input: {
    command: string
    port: number
    title?: string
    sessionID?: string
    directory?: string
  }) {
    const current = state()
    const running = Array.from(current.previews.values()).filter(
      (preview) => preview.status === "running" || preview.status === "starting",
    )
    if (running.length >= MAX_PREVIEWS) throw new Error("Too many companion previews are running")
    if (running.some((preview) => preview.port === input.port)) {
      throw new Error(`A companion preview is already using port ${input.port}`)
    }
    const requestedDirectory = input.directory ? path.resolve(Instance.directory, input.directory) : Instance.directory
    const directory = await fs.realpath(requestedDirectory)
    const stat = await fs.stat(directory)
    if (!stat.isDirectory()) throw new Error("Preview working directory is not a directory")
    const shell = Shell.acceptable()
    const child = Bun.spawn([shell, ...ExecutionWorld.shellArguments(shell, input.command)], {
      cwd: directory,
      env: {
        ...EnvPolicy.build({ scope: "companion-preview" }),
        HOST: "0.0.0.0",
        PORT: String(input.port),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: process.platform !== "win32",
    })
    const id = `preview_${crypto.randomUUID()}`
    const record: PreviewRecord = {
      id,
      title: input.title?.trim() || `Preview on ${input.port}`,
      command: input.command,
      port: input.port,
      status: "starting",
      endpoints: await previewEndpoints(input.port),
      logTail: "",
      createdAt: Date.now(),
      sourceDevice: os.hostname(),
      directory,
      sessionID: input.sessionID,
      process: child,
    }
    boundedSet(current.previews, id, record, MAX_PREVIEWS)
    publishPreview(record)
    capture(child.stdout, record)
    capture(child.stderr, record)
    child.exited.then((exitCode) => {
      record.exitCode = exitCode
      if (record.status !== "stopped") record.status = exitCode === 0 ? "stopped" : "failed"
      publishPreview(record)
    })
    if (await waitForPreview(record, 20)) return previewPublic(record)
    if (child.exitCode !== null) {
      record.status = "failed"
      publishPreview(record)
      throw new Error(record.logTail.trim() || `Preview command exited with ${child.exitCode}`)
    }
    appendLog(record, "\nPreview process is still starting; the port did not answer within five seconds.\n")
    publishPreview(record)
    void waitForPreview(record, 220).then((ready) => {
      if (ready || record.status !== "starting") return
      appendLog(record, "\nPreview port did not become reachable within one minute. The process is still running.\n")
      publishPreview(record)
    })
    return previewPublic(record)
  }

  export function previews() {
    return Array.from(state().previews.values()).map(previewPublic)
  }

  export function preview(id: string) {
    const record = state().previews.get(id)
    return record ? previewPublic(record) : undefined
  }

  export function stopPreview(id: string) {
    const record = state().previews.get(id)
    if (!record) throw new Error("Preview was not found")
    stopProcess(record.process)
    record.status = "stopped"
    publishPreview(record)
    return previewPublic(record)
  }
}
