import os from "os"
import type { Provider } from "@/integrations/provider/provider"
import { parseDiscoveredModel, type RawOpenAIModel } from "@/integrations/provider/custom"
import { Installation } from "@/services/installation"

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const METADATA_CACHE_MS = 5 * 60 * 1000

export namespace Cline {
  export const PROVIDER_ID = "cline"
  export const API_BASE_URL = "https://api.cline.bot/api/v1"
  export const MODELS_URL = `${API_BASE_URL}/models`
  export const RECOMMENDED_MODELS_URL = `${API_BASE_URL}/ai/cline/recommended-models`
  export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
  export const AUTHORIZE_URL = `${API_BASE_URL}/auth/authorize`
  export const TOKEN_URL = `${API_BASE_URL}/auth/token`
  export const REFRESH_URL = `${API_BASE_URL}/auth/refresh`

  export type RecommendedModel = {
    id: string
    name?: string
    description?: string
  }

  export type RecommendedModels = {
    free?: RecommendedModel[]
  }

  export type Tokens = {
    access: string
    refresh: string
    expires: number
  }

  let metadataCache: { expires: number; models: RawOpenAIModel[] } | undefined
  let metadataRequest: Promise<RawOpenAIModel[]> | undefined

  export async function loadModelMetadata(fetcher: typeof fetch = fetch) {
    if (metadataCache && metadataCache.expires > Date.now()) return metadataCache.models
    metadataRequest ??= fetcher(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`OpenRouter models endpoint returned ${response.status}`)
        const payload = await readJsonBounded<{ data?: RawOpenAIModel[] }>(response)
        if (!Array.isArray(payload.data)) throw new Error("OpenRouter model catalog is missing data")
        metadataCache = { expires: Date.now() + METADATA_CACHE_MS, models: payload.data }
        return payload.data
      })
      .finally(() => {
        metadataRequest = undefined
      })
    return metadataRequest
  }

  function tokenValue(access: string) {
    const value = access.trim()
    return value.startsWith("workos:") ? value : `workos:${value}`
  }

  export function buildHeaders(access: string, existing?: HeadersInit) {
    const headers = new Headers(existing)
    const taskID = headers.get("x-atomcli-session") || headers.get("x-task-id") || crypto.randomUUID()
    headers.delete("x-atomcli-session")
    headers.set("Authorization", `Bearer ${tokenValue(access)}`)
    headers.set("HTTP-Referer", "https://cline.bot")
    headers.set("X-Title", "Cline")
    headers.set("User-Agent", `AtomCLI/${Installation.VERSION}`)
    headers.set("X-PLATFORM", os.platform())
    headers.set("X-PLATFORM-VERSION", os.release())
    headers.set("X-CLIENT-TYPE", "atomcli")
    headers.set("X-CLIENT-VERSION", Installation.VERSION)
    headers.set("X-CORE-VERSION", Installation.VERSION)
    headers.set("X-IS-MULTIROOT", "false")
    headers.set("X-Task-ID", taskID)
    return headers
  }

  export function resolveRequestUrl(input: RequestInfo | URL) {
    const raw = input instanceof Request ? input.url : input
    const url = new URL(raw.toString(), API_BASE_URL)
    if (url.protocol !== "https:" || url.hostname !== "api.cline.bot" || url.port) {
      throw new Error(`Refusing to send Cline credentials to untrusted URL: ${url.toString()}`)
    }
    if (url.pathname !== "/api/v1" && !url.pathname.startsWith("/api/v1/")) {
      throw new Error(`Refusing to send Cline credentials to untrusted URL: ${url.toString()}`)
    }
    return url
  }

  async function readTextBounded(response: Response) {
    const declared = Number(response.headers.get("content-length") || 0)
    if (declared > MAX_RESPONSE_BYTES) throw new Error("Cline response exceeds size limit")
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("Cline response exceeds size limit")
    return text
  }

  export async function readJsonBounded<T>(response: Response): Promise<T> {
    const text = await readTextBounded(response)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error("Cline returned invalid JSON")
    }
  }

  function responseData(payload: any) {
    return payload?.data && typeof payload.data === "object" ? payload.data : payload
  }

  function parseTokens(payload: any, fallbackRefresh?: string): Tokens {
    const data = responseData(payload)
    const access = data?.accessToken ?? data?.access_token
    const refresh = data?.refreshToken ?? data?.refresh_token ?? fallbackRefresh
    const expiresAt = data?.expiresAt ?? data?.expires_at
    const expiresIn = data?.expiresIn ?? data?.expires_in
    const expires = expiresAt ? Date.parse(expiresAt) : Date.now() + Number(expiresIn ?? 3600) * 1000
    if (typeof access !== "string" || !access || typeof refresh !== "string" || !refresh || !Number.isFinite(expires)) {
      throw new Error("Cline returned an invalid token response")
    }
    return { access, refresh, expires }
  }

  export async function refreshToken(refresh: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher(REFRESH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh, grantType: "refresh_token", clientType: "extension" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Cline token refresh failed: ${response.status}`)
    return parseTokens(await readJsonBounded(response), refresh)
  }

  export function decodeAuthorizationCode(code: string): Tokens {
    const normalized = code.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const decoded = Buffer.from(padded, "base64").toString("utf8")
    const end = decoded.lastIndexOf("}")
    if (end < 0) throw new Error("Cline authorization code contains no token data")
    return parseTokens(JSON.parse(decoded.slice(0, end + 1)))
  }

  export async function exchangeAuthorizationCode(code: string, redirectUri: string, fetcher: typeof fetch = fetch) {
    try {
      return decodeAuthorizationCode(code)
    } catch {
      const response = await fetcher(TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          client_type: "extension",
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`Cline token exchange failed: ${response.status}`)
      return parseTokens(await readJsonBounded(response))
    }
  }

  function modelFrom(raw: RawOpenAIModel, promoted?: RecommendedModel): Provider.Model {
    const parsed = parseDiscoveredModel({ ...raw, name: promoted?.name ?? raw.name })
    const source = promoted && raw.id.endsWith(":free") ? "both" : promoted ? "promoted" : "catalog-suffix"
    const model: Provider.Model = {
      id: parsed.id,
      providerID: PROVIDER_ID,
      api: { id: parsed.id, url: API_BASE_URL, npm: "@ai-sdk/openai-compatible" },
      name: parsed.name,
      family: parsed.family,
      capabilities: {
        temperature: parsed.temperature,
        reasoning: parsed.reasoning,
        attachment: parsed.attachment,
        toolcall: parsed.tool_call,
        input: {
          text: parsed.modalities?.input.includes("text") ?? true,
          audio: parsed.modalities?.input.includes("audio") ?? false,
          image: parsed.modalities?.input.includes("image") ?? false,
          video: parsed.modalities?.input.includes("video") ?? false,
          pdf: parsed.modalities?.input.includes("pdf") ?? false,
        },
        output: {
          text: parsed.modalities?.output.includes("text") ?? true,
          audio: parsed.modalities?.output.includes("audio") ?? false,
          image: parsed.modalities?.output.includes("image") ?? false,
          video: parsed.modalities?.output.includes("video") ?? false,
          pdf: parsed.modalities?.output.includes("pdf") ?? false,
        },
        interleaved: parsed.interleaved ?? false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: parsed.limit,
      status: "active",
      options: {
        _catalogCostKnown: true,
        _clineFreeSource: source,
        ...(promoted?.description && { description: promoted.description }),
      },
      headers: {},
      release_date: parsed.release_date,
      variants: {},
    }
    if (parsed.reasoning) {
      model.variants = {
        none: { reasoning: { enabled: false } },
        low: { reasoning: { enabled: true, max_tokens: 2_048 } },
        medium: { reasoning: { enabled: true, max_tokens: 8_192 } },
        high: { reasoning: { enabled: true, max_tokens: 16_384 } },
        max: { reasoning: { enabled: true, max_tokens: Math.max(1, parsed.limit.output - 1) } },
      }
    }
    return model
  }

  export function applyModels(
    models: Provider.Info["models"],
    catalog: { data?: RawOpenAIModel[] } | RawOpenAIModel[],
    recommended: RecommendedModels,
    metadata: RawOpenAIModel[] = [],
  ) {
    const entries = Array.isArray(catalog) ? catalog : catalog?.data
    if (!Array.isArray(entries)) throw new Error("Cline model catalog is missing data")
    const promoted = new Map((recommended?.free ?? []).filter((item) => item?.id).map((item) => [item.id, item]))
    const catalogByID = new Map(entries.filter((item) => typeof item?.id === "string").map((item) => [item.id, item]))
    const metadataByID = new Map(metadata.filter((item) => typeof item?.id === "string").map((item) => [item.id, item]))
    const freeIDs = new Set([
      ...promoted.keys(),
      ...entries.filter((item) => item.id.endsWith(":free")).map((item) => item.id),
    ])
    const next: Provider.Info["models"] = {}
    for (const id of freeIDs) {
      const raw = { ...metadataByID.get(id), ...catalogByID.get(id), id }
      next[id] = modelFrom(raw, promoted.get(id))
    }
    for (const id of Object.keys(models)) delete models[id]
    Object.assign(models, next)
    return freeIDs.size
  }

  function streamError(data: string) {
    if (data === "[DONE]") return
    try {
      const payload = JSON.parse(data)
      const error = payload?.error ?? payload?.data?.error
      if (!error) return
      const message = typeof error === "string" ? error : (error.message ?? JSON.stringify(error))
      throw new Error(`Cline stream error: ${message}`)
    } catch (error) {
      if (error instanceof SyntaxError) return
      throw error
    }
  }

  function inspectEventStream(body: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let pending = ""
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true })
          const lines = pending.split("\n")
          pending = lines.pop() ?? ""
          for (const line of lines) {
            if (line.startsWith("data:")) streamError(line.slice(5).trim())
            controller.enqueue(encoder.encode(`${line}\n`))
          }
        },
        flush(controller) {
          pending += decoder.decode()
          if (pending.startsWith("data:")) streamError(pending.slice(5).trim())
          if (pending) controller.enqueue(encoder.encode(pending))
        },
      }),
    )
  }

  export async function normalizeResponse(response: Response) {
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream") && response.body) {
      return new Response(inspectEventStream(response.body), { status: response.status, headers: response.headers })
    }
    if (!contentType.includes("application/json")) return response
    const payload = await readJsonBounded<any>(response)
    const headers = new Headers(response.headers)
    headers.delete("content-length")
    const body = payload?.data && typeof payload.data === "object" ? payload.data : payload
    return new Response(JSON.stringify(body), { status: response.status, headers })
  }
}
