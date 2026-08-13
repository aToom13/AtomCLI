import { Global } from "@/core/global"
import { Log } from "@/util/util/log"
import path from "path"
import z from "zod"
import { data } from "./models-macro"
import { Installation } from "@/services/installation"
import { Flag } from "@/interfaces/flag/flag"
import { rename, unlink } from "fs/promises"

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")
  const refreshInterval = 60 * 60 * 1000
  const maxCatalogBytes = 10 * 1024 * 1024
  // Process-wide and bounded to one in-flight request. models.dev is a global
  // catalog, so project instances should share the same refresh operation.
  let refreshing: Promise<boolean> | undefined

  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      family: z.string().optional(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean().optional().default(false),
      tool_call: z.boolean(),
      interleaved: z
        .union([
          z.literal(true),
          z
            .object({
              field: z.enum(["reasoning_content", "reasoning_details"]),
            })
            .strict(),
        ])
        .optional(),
      cost: z
        .object({
          input: z.number(),
          output: z.number(),
          cache_read: z.number().optional(),
          cache_write: z.number().optional(),
          context_over_200k: z
            .object({
              input: z.number(),
              output: z.number(),
              cache_read: z.number().optional(),
              cache_write: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      modalities: z
        .object({
          input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
          output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        })
        .optional(),
      // models.dev also uses this field for experimental mode metadata.
      experimental: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
      status: z.enum(["alpha", "beta", "deprecated"]).optional(),
      options: z.record(z.string(), z.any()).optional().default({}),
      headers: z.record(z.string(), z.string()).optional(),
      provider: z
        .object({
          npm: z.string().optional(),
        })
        .passthrough()
        .optional(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .passthrough()
  export type Model = z.infer<typeof Model>

  export const Provider = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      models: z.record(z.string(), Model),
    })
    .passthrough()

  const Database = z.record(z.string(), Provider)

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    return getWithRevision().then((result) => result.database)
  }

  export async function getWithRevision() {
    // Explicit fixture/catalog overrides must take precedence over a cache left
    // by another run. This also keeps tests and managed installations stable.
    const override = Bun.env.MODELS_DEV_API_JSON
    if (override) {
      const snapshot = await readSnapshot(override, "MODELS_DEV_API_JSON")
      if (snapshot) return snapshot
      return { database: parse(await data(), "MODELS_DEV_API_JSON"), revision: 0 }
    }

    const file = Bun.file(filepath)
    const cached = await readSnapshot(filepath, "models cache")
    const stale = !cached || Date.now() - file.lastModified >= refreshInterval

    // Await stale refreshes so a process never initializes providers from an
    // old catalog while a newer catalog is being downloaded in the background.
    if (stale) await refresh()

    // Recreate the BunFile after an atomic rename; BunFile may retain metadata
    // from before the refresh when the cache did not exist yet.
    const latest = await readSnapshot(filepath, "models cache")
    if (latest) return latest
    return { database: parse(await data(), "bundled models catalog", true), revision: 0 }
  }

  export async function refresh() {
    if (Flag.ATOMCLI_DISABLE_MODELS_FETCH) return false
    if (refreshing) return refreshing

    refreshing = (async () => {
      const file = Bun.file(filepath)
      log.info("refreshing", { file: filepath })
      const result: Response | undefined = await fetch("https://models.dev/api.json", {
        headers: {
          "User-Agent": Installation.USER_AGENT,
        },
        signal: AbortSignal.timeout(10 * 1000),
      }).catch((error): undefined => {
        log.error("failed to fetch models.dev", { error })
      })
      if (!result?.ok) {
        if (result) log.error("models.dev returned an error", { status: result.status })
        return false
      }

      const body = await readResponse(result, maxCatalogBytes).catch((error): undefined => {
        log.error("models.dev response exceeded safe limits", { error })
      })
      if (!body) return false
      try {
        parse(body, "models.dev response")
      } catch (error) {
        log.error("models.dev returned an invalid catalog", { error })
        return false
      }

      const temp = `${filepath}.${process.pid}.${crypto.randomUUID()}.tmp`
      await Bun.write(temp, body)
      try {
        await rename(temp, filepath)
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw error
      }
      return true
    })().finally(() => {
      refreshing = undefined
    })

    return refreshing
  }

  export function revision() {
    const override = Bun.env.MODELS_DEV_API_JSON
    return Bun.file(override || filepath).lastModified
  }

  async function readResponse(response: Response, maxBytes: number) {
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > maxBytes) throw new Error(`models.dev response exceeds ${maxBytes} bytes`)
    if (!response.body) return ""

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parts: string[] = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new Error(`models.dev response exceeds ${maxBytes} bytes`)
        }
        parts.push(decoder.decode(value, { stream: true }))
      }
      parts.push(decoder.decode())
      return parts.join("")
    } finally {
      reader.releaseLock()
    }
  }

  async function readSnapshot(sourcePath: string, source: string) {
    // Pair the parsed bytes with the exact file revision that produced them.
    // Atomic renames from other processes are detected by the before/after
    // revision check and retried with a fresh BunFile handle.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = Bun.file(sourcePath)
      if (!(await before.exists())) return
      const stat = await before.stat()
      if (stat.size > maxCatalogBytes) {
        log.error(`${source} exceeds ${maxCatalogBytes} bytes`)
        return
      }
      const revision = before.lastModified
      try {
        const database = parse(await before.text(), source)
        const after = Bun.file(sourcePath).lastModified
        if (revision === after) return { database, revision }
      } catch (error) {
        log.error(`failed to read ${source}`, { error })
        return
      }
    }
    log.warn(`${source} changed repeatedly while reading`)
  }

  function parse(input: string, source: string, allowEmpty = false): Record<string, Provider> {
    const value = JSON.parse(input)
    if (!allowEmpty && Object.keys(value ?? {}).length === 0) throw new Error(`${source} contains no providers`)
    const result = Database.safeParse(value)
    if (!result.success) throw new Error(`${source} is invalid: ${z.prettifyError(result.error)}`)
    return result.data
  }
}

setInterval(() => void ModelsDev.refresh().catch((error) => Log.create({ service: "models.dev" }).error("refresh failed", { error })), 60 * 60 * 1000).unref()
