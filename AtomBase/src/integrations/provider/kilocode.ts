/**
 * Kilocode Provider for AtomCLI
 *
 * This module provides integration with Kilocode's cloud services,
 * including device-based authentication and model access.
 */

import open from "open"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { Provider as SDK } from "ai"
import { Log } from "@/util/util/log"
import { Auth } from "@/services/auth"
import { Env } from "@/core/env"

const log = Log.create({ service: "kilocode" })

// Kilocode API Configuration
const KILOCODE_API_BASE_URL = "https://api.kilo.ai"
const KILOCODE_LLM_BASE_URL = "https://api.kilo.ai/api/openrouter/" // Kilocode's proxy to OpenRouter
const POLL_INTERVAL_MS = 3000

// Types
export interface DeviceAuthInitiateResponse {
  code: string
  verificationUrl: string
  expiresIn: number
}

export interface DeviceAuthPollResponse {
  status: "pending" | "approved" | "denied" | "expired"
  token?: string
  userEmail?: string
}

export interface KilocodeOrganization {
  id: string
  name: string
  role: string
}

export interface KilocodeProfileData {
  email: string
  organizations?: KilocodeOrganization[]
}

// Utility functions
function getApiUrl(path: string = ""): string {
  const backend = Env.get("KILOCODE_BACKEND_BASE_URL")
  if (backend) {
    return new URL(path, backend).toString()
  }
  return new URL(path, KILOCODE_API_BASE_URL).toString()
}

async function openBrowser(url: string): Promise<boolean> {
  try {
    await open(url)
    return true
  } catch {
    return false
  }
}

// Interface for Kilocode model response
interface KilocodeModelResponse {
  data: Array<{
    id: string
    name: string
    description?: string
    context_length: number
    max_completion_tokens?: number | null
    pricing?: {
      prompt?: string | null
      completion?: string | null
    }
    architecture?: {
      input_modalities?: string[] | null
      output_modalities?: string[] | null
    }
  }>
}

/**
 * Fetch available models from Kilocode API
 */
export async function getKilocodeModels(token: string): Promise<Record<string, any>> {
  const models: Record<string, any> = {}

  try {
    const response = await fetch(`${KILOCODE_LLM_BASE_URL}models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch Kilocode models: ${response.status}`)
    }

    const json = (await response.json()) as KilocodeModelResponse

    for (const model of json.data || []) {
      // Skip image generation models
      if (model.architecture?.output_modalities?.includes("image")) {
        continue
      }

      const inputPrice = model.pricing?.prompt
        ? parseFloat(model.pricing.prompt) * 1_000_000
        : undefined
      const outputPrice = model.pricing?.completion
        ? parseFloat(model.pricing.completion) * 1_000_000
        : undefined

      models[model.id] = {
        id: model.id,
        name: model.name,
        description: model.description,
        contextWindow: model.context_length,
        maxTokens: model.max_completion_tokens || Math.ceil(model.context_length * 0.2),
        supportsImages: model.architecture?.input_modalities?.includes("image") ?? false,
        inputPrice,
        outputPrice,
      }
    }

    log.info("Fetched Kilocode models", { count: Object.keys(models).length })
    return models
  } catch (error) {
    log.error("Failed to fetch Kilocode models", { error })
    return {}
  }
}

function formatTimeRemaining(startTime: number, expiresIn: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const remaining = Math.max(0, expiresIn - elapsed)
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

// Device Auth Flow
async function initiateDeviceAuth(): Promise<DeviceAuthInitiateResponse> {
  const response = await fetch(getApiUrl("/api/device-auth/codes"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many pending authorization requests. Please try again later.")
    }
    throw new Error(`Failed to initiate device authorization: ${response.status}`)
  }

  return (await response.json()) as DeviceAuthInitiateResponse
}

async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
  const response = await fetch(getApiUrl(`/api/device-auth/codes/${code}`))

  if (response.status === 202) {
    return { status: "pending" }
  }

  if (response.status === 403) {
    return { status: "denied" }
  }

  if (response.status === 410) {
    return { status: "expired" }
  }

  if (!response.ok) {
    throw new Error(`Failed to poll device authorization: ${response.status}`)
  }

  return (await response.json()) as DeviceAuthPollResponse
}

async function getKilocodeProfile(token: string): Promise<KilocodeProfileData> {
  const response = await fetch(getApiUrl("/api/profile"), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("INVALID_TOKEN")
    }
    throw new Error(`Failed to fetch profile: ${response.status}`)
  }

  return (await response.json()) as KilocodeProfileData
}

async function getKilocodeDefaultModel(token: string, organizationId?: string): Promise<string> {
  try {
    const path = organizationId ? `/api/organizations/${organizationId}/defaults` : `/api/defaults`
    const response = await fetch(getApiUrl(path), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch default model: ${response.status}`)
    }

    const data = (await response.json()) as { defaultModel?: string }
    if (!data.defaultModel) {
      throw new Error("Default model was empty")
    }

    return data.defaultModel
  } catch (err) {
    log.warn("Failed to get default model, using fallback", { error: err })
    return "anthropic/claude-sonnet-4" // Fallback to a popular model
  }
}

/**
 * Interactive device authentication flow for CLI
 */
export async function authenticateWithDeviceAuth(): Promise<{ token: string; email: string; organizationId?: string }> {
  console.log("\n🔐 Starting browser-based authentication with Kilocode...\n")

  // Step 1: Initiate device auth
  const authData = await initiateDeviceAuth()
  const { code, verificationUrl, expiresIn } = authData

  // Step 2: Display instructions and open browser
  console.log("Opening browser for authentication...")
  console.log(`Visit: ${verificationUrl}`)
  console.log(`\nVerification code: ${code}`)

  const browserOpened = await openBrowser(verificationUrl)
  if (!browserOpened) {
    console.log("\n⚠️  Could not open browser automatically. Please open the URL manually.")
  }

  console.log(`\nWaiting for authorization... ⏳ (expires in ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")})\n`)

  // Step 3: Poll for authorization
  const startTime = Date.now()
  const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollResult = await pollDeviceAuth(code)

    // Update progress display
    const timeRemaining = formatTimeRemaining(startTime, expiresIn)
    process.stdout.write(`\rWaiting for authorization... ⏳ (${timeRemaining} remaining)`)

    if (pollResult.status === "approved") {
      if (!pollResult.token || !pollResult.userEmail) {
        throw new Error("Invalid response from authorization server")
      }
      console.log(`\n\n✓ Authenticated as ${pollResult.userEmail}\n`)

      // Fetch profile for organizations
      const profileData = await getKilocodeProfile(pollResult.token)
      let organizationId: string | undefined

      // If user has organizations, use the first one (or could prompt for selection)
      if (profileData.organizations && profileData.organizations.length > 0) {
        organizationId = profileData.organizations[0].id
        console.log(`Using organization: ${profileData.organizations[0].name}`)
      }

      return {
        token: pollResult.token,
        email: pollResult.userEmail,
        organizationId,
      }
    }

    if (pollResult.status === "denied") {
      throw new Error("Authorization denied by user")
    }

    if (pollResult.status === "expired") {
      throw new Error("Authorization code expired")
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new Error("Authorization timed out")
}

/**
 * Create the Kilocode SDK provider
 */
export function createKilocode(options: { apiKey: string; organizationId?: string }): SDK {
  return createOpenAICompatible({
    name: "kilocode",
    baseURL: KILOCODE_LLM_BASE_URL,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      ...(options.organizationId && { "X-Kilocode-Organization": options.organizationId }),
    },
  })
}

/**
 * Detect if Kilocode is available (has token stored)
 */
export async function detectKilocode(): Promise<{
  available: boolean
  token?: string
  organizationId?: string
}> {
  // Check environment variable first
  const envToken = Env.get("KILOCODE_TOKEN")
  if (envToken) {
    return { available: true, token: envToken }
  }

  // Check stored auth
  const auth = await Auth.get("kilocode")
  if (auth?.type === "api") {
    return {
      available: true,
      token: auth.key,
      organizationId: (auth as any).organizationId,
    }
  }

  return { available: false }
}
