import { chmod, rename } from "fs/promises"
import path from "path"

const API_BASE_URL = "https://api.cline.bot/api/v1"
const TOKEN_FILE = process.env.CLINE_TOKEN_FILE ?? "/tmp/cline-probe/token.json"
const REQUEST_TIMEOUT_MS = 30_000
const MAX_OUTPUT_TOKENS = Number(process.env.CLINE_PROBE_MAX_TOKENS ?? 64)
const REQUESTED_MODEL_IDS = new Set((process.env.CLINE_PROBE_MODELS ?? "").split(",").filter(Boolean))
const packageJson = (await Bun.file(new URL("../../../package.json", import.meta.url)).json()) as { version: string }
const CLIENT_VERSION = packageJson.version
const TASK_ID = crypto.randomUUID()

type Tokens = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  [key: string]: unknown
}

function buildHeaders(accessToken: string) {
  const token = accessToken.startsWith("workos:") ? accessToken : `workos:${accessToken}`
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://cline.bot",
    "User-Agent": `AtomCLI/${CLIENT_VERSION}`,
    "X-Title": "Cline",
    "X-PLATFORM": process.platform || "unknown",
    "X-PLATFORM-VERSION": process.version || "unknown",
    "X-CLIENT-TYPE": "atomcli",
    "X-CLIENT-VERSION": CLIENT_VERSION,
    "X-CORE-VERSION": CLIENT_VERSION,
    "X-IS-MULTIROOT": "false",
    "X-Task-ID": TASK_ID,
  }
}

function freeSource(id: string, promotedIDs: Set<string>) {
  const promoted = promotedIDs.has(id)
  const suffix = id.endsWith(":free")
  if (promoted && suffix) return "both" as const
  if (promoted) return "promoted" as const
  return "catalog-suffix" as const
}

async function refresh(tokens: Tokens) {
  if (!tokens.refreshToken) throw new Error("Cline refresh token is missing")
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      refreshToken: tokens.refreshToken,
      grantType: "refresh_token",
      clientType: "extension",
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Cline refresh failed: ${response.status} ${text.slice(0, 300)}`)
  const body = JSON.parse(text)
  const next = body?.data ?? body
  if (!next?.accessToken) throw new Error("Cline refresh response has no access token")
  return { ...tokens, ...next } as Tokens
}

async function saveTokens(tokens: Tokens) {
  const temporary = path.join(path.dirname(TOKEN_FILE), `.${path.basename(TOKEN_FILE)}.${process.pid}.tmp`)
  await Bun.write(temporary, `${JSON.stringify({ ...tokens, savedAt: new Date().toISOString() }, null, 2)}\n`)
  await chmod(temporary, 0o600)
  await rename(temporary, TOKEN_FILE)
}

async function request(pathname: string, accessToken: string, init?: RequestInit) {
  return fetch(`${API_BASE_URL}${pathname}`, {
    ...init,
    headers: { ...buildHeaders(accessToken), ...init?.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

const file = Bun.file(TOKEN_FILE)
if (!(await file.exists())) throw new Error(`Cline token file not found: ${TOKEN_FILE}`)

let tokens = (await file.json()) as Tokens
tokens = await refresh(tokens)
await saveTokens(tokens)

const accessToken = tokens.accessToken!
const userResponse = await request("/users/me", accessToken)
const userText = await userResponse.text()
console.log(`users/me status=${userResponse.status}`)
if (!userResponse.ok) throw new Error(`Cline identity probe failed: ${userResponse.status} ${userText.slice(0, 300)}`)

const modelsResponse = await request("/models", accessToken)
const modelsText = await modelsResponse.text()
if (!modelsResponse.ok)
  throw new Error(`Cline models probe failed: ${modelsResponse.status} ${modelsText.slice(0, 300)}`)
const modelsBody = JSON.parse(modelsText)
const models = Array.isArray(modelsBody) ? modelsBody : modelsBody?.data
if (!Array.isArray(models)) throw new Error("Cline models response has no model list")

const recommendedResponse = await request("/ai/cline/recommended-models", accessToken)
const recommendedText = await recommendedResponse.text()
if (!recommendedResponse.ok) {
  throw new Error(
    `Cline recommended models probe failed: ${recommendedResponse.status} ${recommendedText.slice(0, 300)}`,
  )
}
const recommendedBody = JSON.parse(recommendedText)
const recommended = recommendedBody?.data ?? recommendedBody
if (!Array.isArray(recommended?.free)) throw new Error("Cline recommended models response has no free list")
const promotedModels = recommended.free.filter((model: unknown) => {
  return !!model && typeof model === "object" && typeof (model as { id?: unknown }).id === "string"
}) as Array<{ id: string; name?: string }>
const catalogIDs = models.filter((model) => typeof model?.id === "string").map((model) => model.id as string)
const promotedIDs = new Set(promotedModels.map((model) => model.id))
const suffixFreeIDs = catalogIDs.filter((id) => id.endsWith(":free"))
const freeIDs = [...new Set([...promotedIDs, ...suffixFreeIDs])]
const freeModels = freeIDs
  .filter((id) => REQUESTED_MODEL_IDS.size === 0 || REQUESTED_MODEL_IDS.has(id))
  .map((id) => ({ id, source: freeSource(id, promotedIDs) }))
const batchCount = catalogIDs.filter((id) => id.endsWith(":batch")).length
if (!freeModels.length) throw new Error("Cline free model union is empty")
console.log(
  `models status=${modelsResponse.status} total=${catalogIDs.length} promotedFree=${promotedModels.length} suffixFree=${suffixFreeIDs.length} uniqueFree=${freeIDs.length} tested=${freeModels.length} batch=${batchCount}`,
)

const failures: string[] = []
for (const model of freeModels) {
  try {
    const chatResponse = await request("/chat/completions", accessToken, {
      method: "POST",
      body: JSON.stringify({
        model: model.id,
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: "Reply with only: ok" }],
      }),
    })
    const chatText = await chatResponse.text()
    if (!chatResponse.ok) {
      failures.push(`${model.id}: HTTP ${chatResponse.status} ${chatText.slice(0, 160)}`)
      console.log(`FAIL model=${model.id} source=${model.source} status=${chatResponse.status}`)
      continue
    }

    if (!chatText.includes("data:") || !chatText.includes("[DONE]")) {
      failures.push(`${model.id}: response is not OpenAI SSE`)
      console.log(`FAIL model=${model.id} source=${model.source} status=${chatResponse.status} invalidSse=true`)
      continue
    }
    let content = ""
    let reasoning = ""
    let finishReason = ""
    let streamError = ""
    for (const line of chatText.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue
      const raw = JSON.parse(line.slice(6))
      streamError = raw?.error?.message ?? streamError
      const chunk = raw?.data ?? raw
      const choice = chunk?.choices?.[0]
      content += choice?.delta?.content ?? ""
      reasoning += choice?.delta?.reasoning ?? choice?.delta?.reasoning_content ?? ""
      finishReason = choice?.finish_reason ?? finishReason
    }
    if (streamError) {
      failures.push(`${model.id}: ${streamError.slice(0, 300)}`)
      console.log(`FAIL model=${model.id} source=${model.source} streamError=${streamError.slice(0, 160)}`)
      continue
    }
    if (!content.trim()) {
      const detail = `reasoningLength=${reasoning.length} finishReason=${finishReason || "unknown"}`
      failures.push(`${model.id}: empty streamed assistant content ${detail}`)
      console.log(`FAIL model=${model.id} source=${model.source} status=${chatResponse.status} ${detail}`)
      continue
    }
    console.log(`PASS model=${model.id} source=${model.source} responseLength=${content.length}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${model.id}: ${message}`)
    console.log(`FAIL model=${model.id} source=${model.source} error=${message}`)
  }
}
if (failures.length)
  throw new Error(`Cline free model failures (${failures.length}/${freeModels.length}):\n${failures.join("\n")}`)
