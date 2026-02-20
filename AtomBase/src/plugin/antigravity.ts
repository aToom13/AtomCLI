/**
 * Antigravity Authentication Plugin for AtomCLI
 *
 * This plugin provides Google OAuth-based authentication for Antigravity,
 * which gives access to Claude and Gemini models through Google's cloud quota.
 */

import type { Hooks, PluginInput } from "@atomcli/plugin"
import { Log } from "../util/log"
import open from "open"
import {
    createAuthorizationUrl,
    exchangeCode,
    startOAuthServer,
} from "../provider/antigravity/oauth"
import { addAccount } from "../provider/antigravity/storage"
import { ANTIGRAVITY_PROVIDER_ID, MODEL_MAPPING, ANTIGRAVITY_ENDPOINT, GEMINI_CLI_ENDPOINT } from "../provider/antigravity/constants"
import { createAntigravityModel } from "../provider/antigravity"

const log = Log.create({ service: "plugin.antigravity" })

export async function AntigravityAuthPlugin(input: PluginInput): Promise<Hooks> {
    return {
        auth: {
            provider: ANTIGRAVITY_PROVIDER_ID,
            async loader(getAuth, provider) {

                if (provider) {
                    if (!provider.models) provider.models = {} as any
                    provider.models = Object.assign(provider.models, Object.fromEntries(
                        Object.entries(MODEL_MAPPING).map(([id, m]) => {
                            // Determine variants based on model family and name
                            const getVariants = () => {
                                if (m.family === "claude" && m.name.includes("Opus")) {
                                    return { low: { thinkingBudget: 8192 }, max: { thinkingBudget: 32768 } }
                                }
                                if (m.family === "gemini" && id.includes("3")) {
                                    return { low: { thinkingLevel: "low" }, high: { thinkingLevel: "high" } }
                                }
                                if (m.family === "gemini" && id.includes("2.5")) {
                                    return {
                                        high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
                                        max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24576 } },
                                    }
                                }
                                return {}
                            }
                            return [
                                id,
                                {
                                    id,
                                    name: m.name,
                                    providerID: ANTIGRAVITY_PROVIDER_ID,
                                    api: { npm: "@ai-sdk/google", id, url: m.headerStyle === "gemini-cli" ? GEMINI_CLI_ENDPOINT : ANTIGRAVITY_ENDPOINT },
                                    status: "active" as const,
                                    capabilities: {
                                        temperature: true,
                                        reasoning: m.family === "gemini" || m.name.includes("Thinking"),
                                        attachment: true,
                                        toolcall: true,
                                        input: { text: true, audio: false, image: true, video: false, pdf: true },
                                        output: { text: true, audio: false, image: false, video: false, pdf: false },
                                        interleaved: false,
                                    },
                                    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                                    limit: { context: m.family === "claude" ? 200000 : 1048576, output: 65535 },
                                    options: {},
                                    headers: {},
                                    release_date: id.includes("2.5") ? "2025-06-01" : "2025-12-01",
                                    variants: getVariants(),
                                }
                            ]
                        })
                    )) as any
                }

                return {
                    getModel: async (_sdk: any, modelId: string) => {
                        return createAntigravityModel(modelId)
                    },
                }
            },
            methods: [
                {
                    label: "Google OAuth (Antigravity)",
                    type: "oauth" as const,
                    authorize: async () => {
                        // Create authorization URL
                        const auth = createAuthorizationUrl()

                        // Start local OAuth callback server
                        const serverPromise = startOAuthServer(51121)

                        // Try to open browser
                        try {
                            await open(auth.url)
                        } catch {
                            log.warn("Could not open browser automatically")
                        }

                        return {
                            url: auth.url,
                            instructions: "Complete Google sign-in in your browser to authenticate with Antigravity",
                            method: "auto" as const,
                            callback: async () => {
                                try {
                                    // Wait for OAuth callback
                                    const result = await serverPromise
                                    if (!result) {
                                        return { type: "failed" as const }
                                    }

                                    // Exchange code for tokens
                                    const tokenResult = await exchangeCode(result.code, result.state)
                                    if (tokenResult.type === "failed") {
                                        log.error("Token exchange failed", { error: tokenResult.error })
                                        return { type: "failed" as const }
                                    }

                                    // Store the account
                                    await addAccount(
                                        tokenResult.refresh,
                                        tokenResult.email,
                                        tokenResult.projectId
                                    )

                                    log.info("Antigravity authentication successful", {
                                        email: tokenResult.email,
                                    })

                                    return {
                                        type: "success" as const,
                                        refresh: tokenResult.refresh,
                                        access: tokenResult.access,
                                        expires: tokenResult.expires,
                                    }
                                } catch (error) {
                                    log.error("Antigravity auth failed", { error })
                                    return { type: "failed" as const }
                                }
                            },
                        }
                    },
                },
            ],
        },
    }
}
