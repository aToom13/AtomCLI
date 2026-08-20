import { Log } from "@/util/util/log"

const log = Log.create({ service: "provider.custom" })

export interface RawOpenAIModel {
  id: string
  object?: string
  created?: number
  owned_by?: string
  name?: string
  description?: string
  context_length?: number
  max_tokens?: number
  max_completion_tokens?: number
  pricing?: {
    prompt?: string | number
    completion?: string | number
  }
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
  capabilities?: {
    function_calling?: boolean
    vision?: boolean
    reasoning?: boolean
  }
}

export interface DiscoveredModelInfo {
  id: string
  name: string
  family?: string
  tool_call: boolean
  reasoning: boolean
  attachment: boolean
  temperature: boolean
  interleaved?: { field: "reasoning_content" } | true
  limit: {
    context: number
    output: number
  }
  modalities?: {
    input: ("text" | "audio" | "image" | "video" | "pdf")[]
    output: ("text" | "audio" | "image" | "video" | "pdf")[]
  }
  cost?: {
    input: number
    output: number
  }
  release_date: string
}

function normalizeBaseURL(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "")
  return cleaned
}

function estimateContextLimit(modelId: string, rawLimit?: number): number {
  if (rawLimit && rawLimit > 0) return rawLimit

  const lower = modelId.toLowerCase()
  if (lower.includes("1m") || lower.includes("1000k")) return 1_000_000
  if (lower.includes("200k") || lower.includes("claude-3") || lower.includes("claude-3-5") || lower.includes("claude-3.5") || lower.includes("claude-3-7") || lower.includes("claude-3.7") || lower.includes("sonnet") || lower.includes("opus")) return 200_000
  if (lower.includes("128k") || lower.includes("gpt-4o") || lower.includes("gpt-4-turbo") || lower.includes("deepseek") || lower.includes("r1") || lower.includes("v3") || lower.includes("qwen2.5") || lower.includes("qwen-2.5") || lower.includes("llama-3.1") || lower.includes("llama-3.2") || lower.includes("llama-3.3") || lower.includes("mistral-large")) return 128_000
  if (lower.includes("64k") || lower.includes("gemini")) return 64_000
  if (lower.includes("32k") || lower.includes("yi-34b") || lower.includes("command-r")) return 32_000
  if (lower.includes("16k") || lower.includes("gpt-3.5-turbo-16k")) return 16_384

  return 128_000
}

function estimateOutputLimit(modelId: string, rawOutput?: number): number {
  if (rawOutput && rawOutput > 0) return rawOutput

  const lower = modelId.toLowerCase()
  if (lower.includes("claude-3-7") || lower.includes("claude-3.7") || lower.includes("r1") || lower.includes("o1") || lower.includes("o3")) return 64_000
  if (lower.includes("claude-3-5") || lower.includes("claude-3.5") || lower.includes("gpt-4o")) return 16_384
  if (lower.includes("deepseek") || lower.includes("qwen")) return 8_192

  return 8_192
}

function detectVision(modelId: string, raw?: RawOpenAIModel): boolean {
  if (raw?.architecture?.input_modalities?.includes("image") || raw?.capabilities?.vision) {
    return true
  }
  const lower = modelId.toLowerCase()
  const visionKeywords = [
    "vision", "vl", "4o", "4.5", "claude-3", "sonnet", "opus", "haiku",
    "gemini", "pixtral", "minicpm-v", "llava", "qwen-vl", "qwen2-vl",
    "qwen2.5-vl", "gemma3", "gemma-3", "gemma4", "gemma-4"
  ]
  return visionKeywords.some((k) => lower.includes(k))
}

function detectReasoning(modelId: string, raw?: RawOpenAIModel): boolean {
  if (raw?.capabilities?.reasoning) return true
  const lower = modelId.toLowerCase()
  const reasoningKeywords = [
    "r1", "o1", "o3", "reasoner", "thinking", "qwq", "deepseek-reasoner",
    "deepseek-r1", "skywork-o1", "marco-o1"
  ]
  return reasoningKeywords.some((k) => lower.includes(k))
}

function detectToolCall(modelId: string, raw?: RawOpenAIModel): boolean {
  if (raw?.capabilities?.function_calling !== undefined) {
    return raw.capabilities.function_calling
  }
  const lower = modelId.toLowerCase()
  const nonToolKeywords = [
    "embed", "embedding", "whisper", "tts", "dall-e", "moderation",
    "rerank", "bge-", "clip-"
  ]
  if (nonToolKeywords.some((k) => lower.includes(k))) {
    return false
  }
  return true
}

function formatDisplayName(id: string, rawName?: string): string {
  if (rawName && rawName.trim() && rawName !== id) return rawName.trim()

  const parts = id.split("/")
  const lastPart = parts[parts.length - 1] || id
  return lastPart
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function parseDiscoveredModel(raw: RawOpenAIModel): DiscoveredModelInfo {
  const modelId = raw.id
  const hasVision = detectVision(modelId, raw)
  const isReasoning = detectReasoning(modelId, raw)
  const supportsTool = detectToolCall(modelId, raw)
  const context = estimateContextLimit(modelId, raw.context_length)
  const output = estimateOutputLimit(modelId, raw.max_tokens ?? raw.max_completion_tokens)

  const isDeepSeekR1 = modelId.toLowerCase().includes("r1") || modelId.toLowerCase().includes("deepseek-reasoner")

  const inputModalities: ("text" | "audio" | "image" | "video" | "pdf")[] = ["text"]
  if (hasVision) inputModalities.push("image")

  const promptPrice = typeof raw.pricing?.prompt === "number"
    ? raw.pricing.prompt * 1_000_000
    : typeof raw.pricing?.prompt === "string"
      ? parseFloat(raw.pricing.prompt) * 1_000_000
      : undefined

  const compPrice = typeof raw.pricing?.completion === "number"
    ? raw.pricing.completion * 1_000_000
    : typeof raw.pricing?.completion === "string"
      ? parseFloat(raw.pricing.completion) * 1_000_000
      : undefined

  return {
    id: modelId,
    name: formatDisplayName(modelId, raw.name),
    family: modelId.includes("/") ? modelId.split("/")[0] : undefined,
    tool_call: supportsTool,
    reasoning: isReasoning,
    attachment: hasVision,
    temperature: true,
    interleaved: isDeepSeekR1 ? { field: "reasoning_content" } : undefined,
    limit: {
      context,
      output,
    },
    modalities: {
      input: inputModalities,
      output: ["text"],
    },
    cost: (promptPrice !== undefined && compPrice !== undefined)
      ? { input: promptPrice, output: compPrice }
      : undefined,
    release_date: raw.created ? new Date(raw.created * 1000).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
  }
}

export async function fetchOpenAICompatibleModels(options: {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  timeout?: number
}): Promise<{ ok: boolean; models: DiscoveredModelInfo[]; error?: string }> {
  const baseURL = normalizeBaseURL(options.baseURL)
  const modelsURL = baseURL.endsWith("/v1") ? `${baseURL}/models` : `${baseURL}/v1/models`

  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...(options.headers ?? {}),
  }

  if (options.apiKey && options.apiKey.trim()) {
    headers["Authorization"] = `Bearer ${options.apiKey.trim()}`
  }

  log.info("fetching openai compatible models", { url: modelsURL })

  try {
    let response = await fetch(modelsURL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(options.timeout ?? 10_000),
    }).catch((e) => {
      throw e
    })

    // If /v1/models failed with 404 and baseURL already had a custom path, try directly ${baseURL}/models
    if (!response.ok && response.status === 404 && !baseURL.endsWith("/v1")) {
      const altURL = `${baseURL}/models`
      log.info("retrying with alt url", { url: altURL })
      response = await fetch(altURL, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(options.timeout ?? 10_000),
      })
    }

    if (!response.ok) {
      return {
        ok: false,
        models: [],
        error: `HTTP ${response.status} ${response.statusText}`,
      }
    }

    const json = (await response.json()) as any
    let rawList: RawOpenAIModel[] = []

    if (Array.isArray(json)) {
      rawList = json
    } else if (Array.isArray(json.data)) {
      rawList = json.data
    } else if (Array.isArray(json.models)) {
      rawList = json.models
    } else if (json.data && typeof json.data === "object") {
      rawList = Object.values(json.data)
    }

    const filtered = rawList.filter((m) => m && typeof m.id === "string" && m.id.trim().length > 0)
    const models = filtered.map(parseDiscoveredModel)

    return {
      ok: true,
      models,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("failed to fetch models", { error: msg })
    return {
      ok: false,
      models: [],
      error: msg,
    }
  }
}
