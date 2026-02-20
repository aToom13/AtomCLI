/**
 * Antigravity Provider for AtomCLI
 * 
 * Provides access to Antigravity quota models (Claude, Gemini 3) via Google OAuth.
 * Adapted from opencode-antigravity-auth.
 */

import type { LanguageModel } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import {
    ANTIGRAVITY_ENDPOINT,
    GEMINI_CLI_ENDPOINT,
    getAntigravityHeaders,
    initAntigravityVersion,
    GEMINI_CLI_HEADERS,
    ANTIGRAVITY_DEFAULT_PROJECT_ID,
    getModelInfo,
    type HeaderStyle,
    MODEL_MAPPING,
} from "./constants"
import { refreshToken as refreshOAuthToken } from "./oauth"
import { getActiveAccount, rotateAccount } from "./storage"

// Token cache with promise lock to prevent parallel refresh
let cachedToken: { access: string; expires: number } | null = null
let refreshPromise: Promise<string | null> | null = null

/**
 * Get a valid access token, refreshing if necessary.
 * Uses promise-based lock to prevent duplicate parallel refresh requests.
 */
async function getAccessToken(): Promise<string | null> {
    // Check cache
    if (cachedToken && cachedToken.expires > Date.now() + 60000) {
        return cachedToken.access
    }

    // If a refresh is already in progress, wait for it
    if (refreshPromise) return refreshPromise

    refreshPromise = doRefreshToken()
    try {
        return await refreshPromise
    } finally {
        refreshPromise = null
    }
}

async function doRefreshToken(): Promise<string | null> {
    const account = await getActiveAccount()
    if (!account) return null

    const result = await refreshOAuthToken(account.refreshToken)
    if (result.type === "failed") {
        // Try rotating to next account
        const nextAccount = await rotateAccount()
        if (!nextAccount) return null
        const retryResult = await refreshOAuthToken(nextAccount.refreshToken)
        if (retryResult.type === "failed") return null
        cachedToken = { access: retryResult.access, expires: retryResult.expires }
        return retryResult.access
    }

    cachedToken = { access: result.access, expires: result.expires }
    return result.access
}

/**
 * Get endpoint based on header style.
 */
function getEndpoint(headerStyle: HeaderStyle): string {
    return headerStyle === "antigravity" ? ANTIGRAVITY_ENDPOINT : GEMINI_CLI_ENDPOINT
}

// Managed project cache
let managedProjectId: string | null = null
let managedProjectResolved = false

/**
 * Discover the user's managed cloudaicompanion project via loadCodeAssist.
 * Falls back to onboardUser if no managed project exists.
 */
async function ensureManagedProject(accessToken: string): Promise<string> {
    if (managedProjectResolved && managedProjectId) {
        return managedProjectId
    }

    const endpoints = [
        ANTIGRAVITY_ENDPOINT,
        "https://cloudcode-pa.googleapis.com",
        "https://daily-cloudcode-pa.sandbox.googleapis.com",
        "https://autopush-cloudcode-pa.sandbox.googleapis.com",
    ]

    const metadata = {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: ANTIGRAVITY_DEFAULT_PROJECT_ID,
    }

    for (const endpoint of endpoints) {
        try {
            const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    "User-Agent": "google-api-nodejs-client/9.15.1",
                    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                },
                body: JSON.stringify({ metadata }),
            })

            if (!res.ok) continue

            const payload = await res.json() as Record<string, unknown>
            const project = payload.cloudaicompanionProject
            const projectStr = typeof project === "string" ? project
                : (project && typeof project === "object" && "id" in project)
                    ? (project as Record<string, unknown>).id as string
                    : null

            if (projectStr) {
                managedProjectId = projectStr
                managedProjectResolved = true
                return projectStr
            }

            // Try onboarding if no managed project yet
            const allowedTiers = payload.allowedTiers as Array<{ id?: string; isDefault?: boolean }> | undefined
            const tierId = allowedTiers?.find(t => t.isDefault)?.id || allowedTiers?.[0]?.id || "FREE"

            const onboardRes = await fetch(`${endpoint}/v1internal:onboardUser`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    ...getAntigravityHeaders(),
                },
                body: JSON.stringify({ tierId, metadata }),
            })

            if (onboardRes.ok) {
                const onboardPayload = await onboardRes.json() as Record<string, unknown>
                const responseObj = onboardPayload.response as Record<string, unknown> | undefined
                const onboardedProject = responseObj?.cloudaicompanionProject as Record<string, unknown> | undefined
                if (onboardedProject?.id) {
                    managedProjectId = onboardedProject.id as string
                    managedProjectResolved = true
                    return managedProjectId
                }
            }
        } catch (e) {
            continue
        }
    }

    // Fallback to default
    managedProjectResolved = true
    managedProjectId = ANTIGRAVITY_DEFAULT_PROJECT_ID
    return ANTIGRAVITY_DEFAULT_PROJECT_ID
}

/**
 * Get headers based on header style.
 */
function getHeaders(headerStyle: HeaderStyle, accessToken: string, projectId?: string): Record<string, string> {
    const baseHeaders = headerStyle === "antigravity" ? getAntigravityHeaders() : GEMINI_CLI_HEADERS
    const effectiveProjectId = projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID

    return {
        ...baseHeaders,
        Authorization: `Bearer ${accessToken}`,
        "X-Goog-User-Project": effectiveProjectId,
    }
}

/**
 * Create a custom fetch that injects Antigravity auth headers.
 */
function createAntigravityFetch(headerStyle: HeaderStyle, projectId?: string) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const accessToken = await getAccessToken()
        if (!accessToken) {
            throw new Error("No Antigravity authentication. Run 'atomcli auth login' and select Antigravity OAuth.")
        }

        // Resolve managed project before first request
        const effectiveProjectId = projectId || await ensureManagedProject(accessToken)

        const inputStr = typeof input === "string" ? input : input.toString()
        const url = new URL(inputStr)
        const headers = getHeaders(headerStyle, accessToken, effectiveProjectId)

        let targetUrl = inputStr
        let newBody = init?.body

        if (url.hostname === "generativelanguage.googleapis.com") {
            const endpoint = getEndpoint(headerStyle)

            const match = url.pathname.match(/\/models\/([^:]+):(\w+)/)
            if (match) {
                const [, modelName, action] = match
                const streaming = url.searchParams.get("alt") === "sse" || action.includes("stream")

                targetUrl = `${endpoint}/v1internal:${action}${streaming ? "?alt=sse" : ""}`

                if (init?.body && typeof init.body === "string") {
                    try {
                        const parsedBody = JSON.parse(init.body)
                        if (!parsedBody.project && !parsedBody.request) {
                            const wrappedBody: Record<string, unknown> = {
                                project: effectiveProjectId,
                                model: modelName,
                                request: parsedBody
                            }
                            if (headerStyle === "antigravity") {
                                wrappedBody.requestType = "agent"
                                wrappedBody.userAgent = "antigravity"
                                wrappedBody.requestId = "agent-" + crypto.randomUUID()
                            }
                            newBody = JSON.stringify(wrappedBody)
                        }
                    } catch (e) {
                        // Ignore parse error
                    }
                }
            } else {
                targetUrl = url.href.replace("https://generativelanguage.googleapis.com", endpoint)
            }
        }

        // Properly merge headers - init.headers may be a Headers instance
        const finalHeaders = new Headers(init?.headers as HeadersInit || {})
        // Override with our auth/antigravity headers
        for (const [key, value] of Object.entries(headers)) {
            finalHeaders.set(key, value)
        }
        finalHeaders.delete("x-api-key")
        finalHeaders.delete("x-goog-api-key")

        // Always remove x-goog-user-project - the managed project doesn't have
        // Cloud Code API enabled, causing 403 SERVICE_DISABLED errors.
        // Project ID is passed in the wrapped body for antigravity models.
        finalHeaders.delete("x-goog-user-project")



        const res = await fetch(targetUrl, {
            ...init,
            headers: finalHeaders,
            body: newBody
        })

        if (!res.ok) return res

        const contentType = res.headers.get("content-type") || ""

        if (contentType.includes("application/json")) {
            const text = await res.text()
            try {
                const data = JSON.parse(text)
                if (data && typeof data === "object" && "response" in data) {
                    return new Response(JSON.stringify(data.response), {
                        status: res.status,
                        statusText: res.statusText,
                        headers: res.headers
                    })
                }
            } catch (e) {
                // Ignore parse errors, fallback to returning raw text
            }
            return new Response(text, {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers
            })
        }

        if (contentType.includes("text/event-stream") && res.body) {
            let buffer = ''
            const decoder = new TextDecoder()
            const encoder = new TextEncoder()

            const transformStream = new TransformStream({
                transform(chunk, controller) {
                    buffer += decoder.decode(chunk, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const jsonStr = line.slice(5).trim()
                            if (!jsonStr) {
                                controller.enqueue(encoder.encode(line + '\n'))
                                continue
                            }
                            try {
                                const parsed = JSON.parse(jsonStr)
                                if (parsed && typeof parsed === "object" && "response" in parsed) {
                                    const unwrapped = JSON.stringify(parsed.response)

                                    controller.enqueue(encoder.encode(`data: ${unwrapped}\n`))
                                } else {

                                    controller.enqueue(encoder.encode(line + '\n'))
                                }
                            } catch (e) {

                                controller.enqueue(encoder.encode(line + '\n'))
                            }
                        } else {

                            controller.enqueue(encoder.encode(line + '\n'))
                        }
                    }
                },
                flush(controller) {
                    buffer += decoder.decode()
                    if (buffer) {
                        if (buffer.startsWith('data:')) {
                            const jsonStr = buffer.slice(5).trim()
                            try {
                                const parsed = JSON.parse(jsonStr)
                                if (parsed && typeof parsed === "object" && "response" in parsed) {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed.response)}\n`))
                                    return
                                }
                            } catch (e) { }
                        }
                        controller.enqueue(encoder.encode(buffer + '\n'))
                    }
                }
            })

            return new Response(res.body.pipeThrough(transformStream), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers
            })
        }

        return res
    }
}


// Fire-and-forget version init at module load (will resolve before first API request)
initAntigravityVersion().catch(() => { })

/**
 * Create an Antigravity language model.
 */
export function createAntigravityModel(modelId: string, options?: { projectId?: string }): LanguageModel {
    const modelInfo = getModelInfo(modelId)
    if (!modelInfo) {
        throw new Error(`Unknown Antigravity model: ${modelId}. Available: ${Object.keys(MODEL_MAPPING).join(", ")}`)
    }

    const google = createGoogleGenerativeAI({
        apiKey: "antigravity", // Dummy key, auth via headers
        fetch: createAntigravityFetch(modelInfo.headerStyle, options?.projectId) as any,
    })

    return google(modelInfo.backend)
}

/**
 * Provider SDK compatible interface.
 */
export function createAntigravity(options?: { projectId?: string }) {
    return {
        languageModel(modelId: string): LanguageModel {
            return createAntigravityModel(modelId, options)
        },
        chat(modelId: string): LanguageModel {
            return createAntigravityModel(modelId, options)
        },
    }
}

export * from "./constants"
export * from "./oauth"
export * from "./storage"
