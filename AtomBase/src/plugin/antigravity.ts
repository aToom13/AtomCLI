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
import { ANTIGRAVITY_PROVIDER_ID } from "../provider/antigravity/constants"

const log = Log.create({ service: "plugin.antigravity" })

export async function AntigravityAuthPlugin(input: PluginInput): Promise<Hooks> {
    return {
        auth: {
            provider: ANTIGRAVITY_PROVIDER_ID,
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
