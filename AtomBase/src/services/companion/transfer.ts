import { createHash } from "crypto"
import { createReadStream } from "fs"
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
const MAX_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
const MAX_LOG_BYTES = 128 * 1024
const TICKET_TTL_MS = 24 * 60 * 60 * 1000
const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000
const PREVIEW_BOOTSTRAP_TTL_MS = 2 * 60 * 1000
const PREVIEW_SESSION_TTL_MS = 60 * 60 * 1000
const MAX_PREVIEW_SESSIONS = 20
const PREVIEW_TOKEN_QUERY = "atomcli_token"
const PREVIEW_SESSION_COOKIE = "atomcli_preview"
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
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
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
    accessExpiresAt: z.number().int().optional(),
  })
  export type Preview = z.infer<typeof Preview>

  export const Event = {
    ArtifactShared: BusEvent.define("companion.artifact.shared", Artifact),
    ArtifactDeleted: BusEvent.define("companion.artifact.deleted", z.object({ id: z.string() })),
    PreviewUpdated: BusEvent.define("companion.preview.updated", Preview),
  }

  type ArtifactRecord = Artifact & { filePath: string; token: string; managedFile: boolean }
  type UploadTicket = {
    id: string
    token: string
    filename: string
    mime: string
    size: number
    sha256?: string
    sessionID: string
    directory: string
    deviceName: string
    model?: string
    agent?: string
    variant?: string
    expiresAt: number
    partialPath: string
    receivedBytes: number
    busy: boolean
  }
  type PreviewRecord = Preview & {
    process?: Bun.Subprocess
    gateway?: ReturnType<typeof Bun.serve>
    accessToken?: string
    sessions: Map<string, number>
  }

  const state = Instance.state(
    () => ({
      artifacts: new Map<string, ArtifactRecord>(),
      uploads: new Map<string, UploadTicket>(),
      previews: new Map<string, PreviewRecord>(),
    }),
    async (current) => {
      for (const preview of current.previews.values()) {
        stopProcess(preview.process)
        stopGateway(preview)
      }
      for (const artifact of current.artifacts.values()) {
        if (artifact.managedFile) await fs.unlink(artifact.filePath).catch(() => {})
      }
      for (const upload of current.uploads.values()) {
        await fs.unlink(upload.partialPath).catch(() => {})
      }
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
      if (artifact.expiresAt <= now) {
        current.artifacts.delete(id)
        if (artifact.managedFile) void fs.unlink(artifact.filePath).catch(() => {})
      }
    }
    for (const [id, ticket] of current.uploads) {
      if (ticket.expiresAt <= now) {
        current.uploads.delete(id)
        void fs.unlink(ticket.partialPath).catch(() => {})
      }
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
    const { filePath: _filePath, token: _token, managedFile: _managedFile, ...artifact } = record
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
    const sourceStat = await fs.stat(resolved)
    if (!sourceStat.isFile()) throw new Error("Only regular files can be sent to the companion")
    if (sourceStat.size > MAX_DOWNLOAD_BYTES) {
      throw new Error(`File exceeds the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB companion limit`)
    }
    const id = `artifact_${crypto.randomUUID()}`
    const token = crypto.randomUUID().replaceAll("-", "")
    const direction = input.direction ?? "pc_to_mobile"
    const name = safeFilename(resolved)
    let storedPath = resolved
    let managedFile = false
    if (direction === "pc_to_mobile") {
      const transferDirectory = path.join(Instance.directory, ".atomcli", "transfers", "outgoing")
      await fs.mkdir(transferDirectory, { recursive: true })
      const safeDirectory = await fs.realpath(transferDirectory)
      if (!Filesystem.contains(Instance.directory, safeDirectory)) {
        throw new Error("Companion transfer directory resolves outside the selected workspace")
      }
      storedPath = path.join(safeDirectory, `${id}-${name}`)
      await fs.copyFile(resolved, storedPath)
      managedFile = true
    }
    const stat = await fs.stat(storedPath)
    const file = Bun.file(storedPath)
    const mime = file.type || "application/octet-stream"
    const sha256 = await hashFile(storedPath)
    const expiresAt = Date.now() + ARTIFACT_TTL_MS
    const record: ArtifactRecord = {
      id,
      kind: mime.startsWith("image/") ? "image" : "file",
      direction,
      sourceDevice: input.sourceDevice ?? os.hostname(),
      title: input.title?.trim() || name,
      name,
      mime,
      size: stat.size,
      sha256,
      createdAt: Date.now(),
      expiresAt,
      sessionID: input.sessionID,
      filePath: storedPath,
      token,
      managedFile,
      downloadPath: downloadPath(id, token),
    }
    while (state().artifacts.size >= MAX_ARTIFACTS) {
      const oldest = state().artifacts.keys().next().value
      if (oldest === undefined) break
      const evicted = state().artifacts.get(oldest)
      state().artifacts.delete(oldest)
      if (evicted?.managedFile) await fs.unlink(evicted.filePath).catch(() => {})
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

  export function deleteArtifact(id: string) {
    prune()
    const artifact = state().artifacts.get(id)
    if (!artifact) return false
    state().artifacts.delete(id)
    if (artifact.managedFile) void fs.unlink(artifact.filePath).catch(() => {})
    Bus.publish(Event.ArtifactDeleted, { id })
    return true
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
    sha256?: string
  }) {
    prune()
    if (input.size < 0 || input.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Upload exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB companion limit`)
    }
    if (input.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.sha256)) {
      throw new Error("Upload SHA-256 is invalid")
    }
    const uploadDirectory = path.join(input.directory, ".atomcli", "inbox", "mobile", ".partial")
    await fs.mkdir(uploadDirectory, { recursive: true })
    const resolvedUploadDirectory = await fs.realpath(uploadDirectory)
    if (!Filesystem.contains(input.directory, resolvedUploadDirectory)) {
      throw new Error("Companion upload directory resolves outside the selected workspace")
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
      partialPath: path.join(resolvedUploadDirectory, `${id}.part`),
      receivedBytes: 0,
      busy: false,
    }
    await Bun.write(ticket.partialPath, new Uint8Array())
    while (state().uploads.size >= MAX_UPLOAD_TICKETS) {
      const oldest = state().uploads.keys().next().value
      if (oldest === undefined) break
      const evicted = state().uploads.get(oldest)
      state().uploads.delete(oldest)
      if (evicted) await fs.unlink(evicted.partialPath).catch(() => {})
    }
    boundedSet(state().uploads, id, ticket, MAX_UPLOAD_TICKETS)
    const query = new URLSearchParams({ token, directory: input.directory })
    return {
      id,
      uploadPath: `/companion/upload/${encodeURIComponent(id)}?${query}`,
      expiresAt: ticket.expiresAt,
      offset: 0,
      chunkSize: MAX_UPLOAD_CHUNK_BYTES,
    }
  }

  export function uploadStatus(id: string, token: string) {
    prune()
    const ticket = state().uploads.get(id)
    if (!ticket || ticket.token !== token) return undefined
    return {
      offset: ticket.receivedBytes,
      size: ticket.size,
      expiresAt: ticket.expiresAt,
      chunkSize: MAX_UPLOAD_CHUNK_BYTES,
    }
  }

  export async function acceptUploadChunk(input: {
    id: string
    token: string
    offset: number
    contentLength?: number
    chunkSha256?: string
    body: ReadableStream<Uint8Array> | null
  }) {
    prune()
    const ticket = state().uploads.get(input.id)
    if (!ticket || ticket.token !== input.token) throw new Error("Upload ticket is invalid or expired")
    if (ticket.busy) throw new Error("Another chunk is already being written")
    if (!input.body && input.contentLength !== 0) throw new Error("Upload body is empty")
    if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset !== ticket.receivedBytes) {
      throw new Error(`Upload offset mismatch; expected ${ticket.receivedBytes}`)
    }
    if (
      input.contentLength === undefined ||
      input.contentLength < 0 ||
      (input.contentLength === 0 && ticket.receivedBytes < ticket.size) ||
      input.contentLength > MAX_UPLOAD_CHUNK_BYTES ||
      input.offset + input.contentLength > ticket.size
    ) {
      throw new Error("Upload chunk length is invalid")
    }
    if (input.chunkSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.chunkSha256)) {
      throw new Error("Upload chunk SHA-256 is invalid")
    }
    ticket.busy = true
    try {
      const bytes = input.body ? new Uint8Array(await new Response(input.body).arrayBuffer()) : new Uint8Array()
      if (bytes.byteLength !== input.contentLength) throw new Error("Upload chunk length did not match Content-Length")
      const chunkSha256 = createHash("sha256").update(bytes).digest("hex")
      if (input.chunkSha256 && chunkSha256 !== input.chunkSha256) {
        throw new Error("Upload chunk checksum did not match")
      }
      const file = await fs.open(ticket.partialPath, "r+")
      try {
        await file.write(bytes, 0, bytes.byteLength, ticket.receivedBytes)
        await file.sync()
      } finally {
        await file.close()
      }
      ticket.receivedBytes += bytes.byteLength
      if (ticket.receivedBytes < ticket.size) {
        return { status: "partial" as const, offset: ticket.receivedBytes, size: ticket.size }
      }
      const sha256 = await hashFile(ticket.partialPath)
      if (ticket.sha256 && sha256 !== ticket.sha256) {
        state().uploads.delete(ticket.id)
        await fs.unlink(ticket.partialPath).catch(() => {})
        throw new Error("Uploaded file checksum did not match the transfer request")
      }
      const uploadDirectory = path.dirname(path.dirname(ticket.partialPath))
      const target = path.join(uploadDirectory, `${Date.now()}-${ticket.filename}`)
      await fs.rename(ticket.partialPath, target)
      state().uploads.delete(ticket.id)
      const artifact = await shareFile({
        filePath: target,
        title: ticket.filename,
        sessionID: ticket.sessionID,
        direction: "mobile_to_pc",
        sourceDevice: ticket.deviceName,
      })
      return {
        status: "complete" as const,
        offset: ticket.receivedBytes,
        size: ticket.size,
        artifact,
        filePath: target,
      }
    } finally {
      ticket.busy = false
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
    if (ticket.receivedBytes !== 0 || input.contentLength !== ticket.size) {
      throw new Error("Uploaded file size did not match the transfer request")
    }
    const result = await acceptUploadChunk({
      ...input,
      offset: 0,
    })
    if (result.status !== "complete") throw new Error("Uploaded file was not completed")
    return result
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
    const { process: _process, gateway: _gateway, accessToken: _accessToken, sessions: _sessions, ...preview } = record
    return preview
  }

  function stopGateway(record: PreviewRecord) {
    try {
      record.gateway?.stop(true)
    } catch {
      // Gateway may already be closed during project disposal.
    }
    record.gateway = undefined
    record.sessions.clear()
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

  async function previewEndpoints(port: number, token: string) {
    const { CompanionDiscovery } = await import("@atomcli/companion")
    const endpoints = CompanionDiscovery.detectEndpoints(port).map((item) => {
      const parsed = new URL(item.url)
      return `http://${parsed.hostname}:${port}/?${PREVIEW_TOKEN_QUERY}=${encodeURIComponent(token)}`
    })
    const magicDNS = await CompanionDiscovery.getTailscaleMagicDNS()
    if (magicDNS) endpoints.push(`http://${magicDNS}:${port}/?${PREVIEW_TOKEN_QUERY}=${encodeURIComponent(token)}`)
    return Array.from(new Set(endpoints))
  }

  function cookieValue(header: string | null, name: string) {
    if (!header) return undefined
    for (const item of header.split(";")) {
      const [key, ...value] = item.trim().split("=")
      if (key === name) return value.join("=")
    }
  }

  function withoutGatewayCookie(header: string | null) {
    if (!header) return undefined
    const value = header
      .split(";")
      .map((item) => item.trim())
      .filter((item) => !item.startsWith(`${PREVIEW_SESSION_COOKIE}=`))
      .join("; ")
    return value || undefined
  }

  async function startGateway(record: PreviewRecord) {
    const gateway = Bun.serve({
      hostname: "0.0.0.0",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const now = Date.now()
        const bootstrap = url.searchParams.get(PREVIEW_TOKEN_QUERY)
        if (bootstrap) {
          if (bootstrap !== record.accessToken || (record.accessExpiresAt ?? 0) <= now) {
            return new Response("Preview access link has expired", { status: 401 })
          }
          const session = crypto.randomUUID()
          for (const [id, expiry] of record.sessions) {
            if (expiry <= now) record.sessions.delete(id)
          }
          record.sessions.set(session, now + PREVIEW_SESSION_TTL_MS)
          while (record.sessions.size > MAX_PREVIEW_SESSIONS) {
            const oldest = record.sessions.keys().next().value
            if (!oldest) break
            record.sessions.delete(oldest)
          }
          url.searchParams.delete(PREVIEW_TOKEN_QUERY)
          return new Response(null, {
            status: 302,
            headers: {
              location: url.toString(),
              "set-cookie": `${PREVIEW_SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PREVIEW_SESSION_TTL_MS / 1000}`,
              "cache-control": "no-store",
            },
          })
        }
        const session = cookieValue(request.headers.get("cookie"), PREVIEW_SESSION_COOKIE)
        const sessionExpiry = session ? record.sessions.get(session) : undefined
        if (!session || !sessionExpiry || sessionExpiry <= now) {
          if (session) record.sessions.delete(session)
          return new Response("Preview authorization required", {
            status: 401,
            headers: { "cache-control": "no-store" },
          })
        }
        if (request.headers.get("upgrade")) {
          return new Response("Preview WebSocket proxy is not available", { status: 426 })
        }
        const target = new URL(request.url)
        target.protocol = "http:"
        target.hostname = "127.0.0.1"
        target.port = String(record.port)
        const headers = new Headers(request.headers)
        headers.delete("host")
        const forwardedCookie = withoutGatewayCookie(headers.get("cookie"))
        if (forwardedCookie) headers.set("cookie", forwardedCookie)
        else headers.delete("cookie")
        try {
          const response = await fetch(target, {
            method: request.method,
            headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
            redirect: "manual",
          })
          const responseHeaders = new Headers(response.headers)
          const location = responseHeaders.get("location")
          if (location) {
            const resolved = new URL(location, target)
            if (resolved.hostname === "127.0.0.1" && resolved.port === String(record.port)) {
              resolved.hostname = url.hostname
              resolved.port = url.port
              responseHeaders.set("location", resolved.toString())
            }
          }
          return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
          })
        } catch (error) {
          log.warn("preview gateway request failed", { id: record.id, error })
          return new Response("Preview server is unavailable", { status: 502 })
        }
      },
    })
    record.gateway = gateway
    await issuePreviewAccess(record)
  }

  async function issuePreviewAccess(record: PreviewRecord) {
    if (!record.gateway) throw new Error("Preview gateway is unavailable")
    record.accessToken = crypto.randomUUID()
    record.accessExpiresAt = Date.now() + PREVIEW_BOOTSTRAP_TTL_MS
    record.endpoints = await previewEndpoints(record.gateway.port, record.accessToken)
    return previewPublic(record)
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

  function assertPreviewPortAvailable(port: number) {
    try {
      const probe = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: () => new Response("Preview port probe"),
      })
      probe.stop(true)
    } catch (error) {
      throw new Error(`Preview port ${port} is already in use or unavailable`, { cause: error })
    }
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
    assertPreviewPortAvailable(input.port)
    const shell = Shell.acceptable()
    const child = Bun.spawn([shell, ...ExecutionWorld.shellArguments(shell, input.command)], {
      cwd: directory,
      env: {
        ...EnvPolicy.build({ scope: "companion-preview" }),
        HOST: "127.0.0.1",
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
      endpoints: [],
      logTail: "",
      createdAt: Date.now(),
      sourceDevice: os.hostname(),
      directory,
      sessionID: input.sessionID,
      sessions: new Map(),
      process: child,
    }
    try {
      await startGateway(record)
    } catch (error) {
      stopProcess(child)
      throw error
    }
    while (current.previews.size >= MAX_PREVIEWS) {
      const oldestID = current.previews.keys().next().value
      if (!oldestID) break
      const oldest = current.previews.get(oldestID)
      if (oldest) {
        stopProcess(oldest.process)
        stopGateway(oldest)
      }
      current.previews.delete(oldestID)
    }
    boundedSet(current.previews, id, record, MAX_PREVIEWS)
    publishPreview(record)
    capture(child.stdout, record)
    capture(child.stderr, record)
    child.exited.then((exitCode) => {
      record.exitCode = exitCode
      if (record.status !== "stopped") record.status = exitCode === 0 ? "stopped" : "failed"
      stopGateway(record)
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
    stopGateway(record)
    record.status = "stopped"
    publishPreview(record)
    return previewPublic(record)
  }

  export async function previewAccess(id: string) {
    const record = state().previews.get(id)
    if (!record) throw new Error("Preview was not found")
    if (record.status !== "running" && record.status !== "starting") {
      throw new Error("Preview is not running")
    }
    return issuePreviewAccess(record)
  }
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}
