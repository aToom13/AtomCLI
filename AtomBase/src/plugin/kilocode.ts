/**
 * Kilocode Authentication Plugin for AtomCLI
 *
 * This plugin provides device-based authentication for Kilocode,
 * similar to how GitHub CLI authentication works.
 */

import type { Hooks, PluginInput } from "@atomcli/plugin"
import { Log } from "../util/log"
import { OAUTH_DUMMY_KEY } from "../auth"
import open from "open"

const log = Log.create({ service: "plugin.kilocode" })

// API Configuration
const KILOCODE_API_BASE_URL = "https://api.kilo.ai"
const KILOCODE_OPENROUTER_PROXY_URL = "https://api.kilo.ai/api/openrouter/" // Kilocode's proxy to OpenRouter
const POLL_INTERVAL_MS = 3000

interface DeviceAuthInitiateResponse {
    code: string
    verificationUrl: string
    expiresIn: number
}

interface DeviceAuthPollResponse {
    status: "pending" | "approved" | "denied" | "expired"
    token?: string
    userEmail?: string
}

function getApiUrl(path: string = ""): string {
    const backend = process.env.KILOCODE_BACKEND_BASE_URL
    if (backend) {
        return new URL(path, backend).toString()
    }
    return new URL(path, KILOCODE_API_BASE_URL).toString()
}

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

let pendingAuth: {
    code: string
    expiresIn: number
    startTime: number
    resolve: (token: string) => void
    reject: (error: Error) => void
} | null = null

async function waitForDeviceAuth(code: string, expiresIn: number): Promise<string> {
    return new Promise((resolve, reject) => {
        pendingAuth = {
            code,
            expiresIn,
            startTime: Date.now(),
            resolve,
            reject,
        }

        // Start polling in the background
        const pollLoop = async () => {
            const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (!pendingAuth) {
                    reject(new Error("Authorization cancelled"))
                    return
                }

                try {
                    const result = await pollDeviceAuth(code)

                    if (result.status === "approved" && result.token) {
                        pendingAuth = null
                        resolve(result.token)
                        return
                    }

                    if (result.status === "denied") {
                        pendingAuth = null
                        reject(new Error("Authorization denied by user"))
                        return
                    }

                    if (result.status === "expired") {
                        pendingAuth = null
                        reject(new Error("Authorization code expired"))
                        return
                    }

                    // Still pending, wait and try again
                    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
                } catch (error) {
                    pendingAuth = null
                    reject(error instanceof Error ? error : new Error(String(error)))
                    return
                }
            }

            pendingAuth = null
            reject(new Error("Authorization timed out"))
        }

        pollLoop()
    })
}

export async function KilocodeAuthPlugin(input: PluginInput): Promise<Hooks> {
    return {
        auth: {
            provider: "kilocode",
            async loader(getAuth, provider) {
                const auth = await getAuth()
                if (auth.type !== "api") return {}

                // All Kilocode models are effectively free for authenticated users
                // (costs are handled on Kilocode's side)
                for (const model of Object.values(provider.models)) {
                    model.cost = {
                        input: 0,
                        output: 0,
                        cache: { read: 0, write: 0 },
                    }
                }

                return {
                    apiKey: auth.key,
                    baseURL: KILOCODE_OPENROUTER_PROXY_URL,
                    headers: {
                        Authorization: `Bearer ${auth.key}`,
                    },
                    async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
                        const headers = new Headers(init?.headers)

                        // Set Kilocode-specific headers
                        headers.set("Authorization", `Bearer ${auth.key}`)
                        headers.set("HTTP-Referer", "https://atomcli.ai/")
                        headers.set("X-Title", "atomcli")

                        return fetch(requestInput, {
                            ...init,
                            headers,
                        })
                    },
                }
            },
            methods: [
                {
                    label: "Kilo Gateway (Browser login)",
                    type: "oauth" as const,
                    authorize: async () => {
                        // Initiate device auth
                        const authData = await initiateDeviceAuth()
                        const { code, verificationUrl, expiresIn } = authData

                        // Try to open browser
                        try {
                            await open(verificationUrl)
                        } catch {
                            log.warn("Could not open browser automatically")
                        }

                        // Start waiting for callback
                        const tokenPromise = waitForDeviceAuth(code, expiresIn)

                        return {
                            url: verificationUrl,
                            instructions: `Enter verification code: ${code}`,
                            method: "auto" as const,
                            callback: async () => {
                                const token = await tokenPromise
                                return {
                                    type: "success" as const,
                                    key: token,
                                }
                            },
                        }
                    },
                },
                {
                    label: "API Token",
                    type: "api" as const,
                },
            ],
        },
    }
}
