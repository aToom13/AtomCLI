/**
 * Antigravity Authentication Plugin for AtomCLI
 *
 * This plugin provides Google OAuth-based authentication for Antigravity,
 * which gives access to Claude and Gemini models through Google's cloud quota.
 */

import type { Hooks, PluginInput } from "@atomcli/plugin"
import { Log } from "@/util/util/log"
import open from "open"
import { createAuthorizationUrl, exchangeCode, startOAuthServer } from "../provider/antigravity/oauth"
import { addAccount } from "../provider/antigravity/storage"
import {
  ANTIGRAVITY_PROVIDER_ID,
  MODEL_MAPPING,
  ANTIGRAVITY_ENDPOINT,
  GEMINI_CLI_ENDPOINT,
} from "../provider/antigravity/constants"
import { createAntigravityModel } from "../provider/antigravity"

const log = Log.create({ service: "plugin.antigravity" })

export async function AntigravityAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: ANTIGRAVITY_PROVIDER_ID,
      async loader(getAuth, provider) {
        if (provider) {
          if (!provider.models) provider.models = {} as any
           provider.models = Object.assign(
            provider.models,
            Object.fromEntries(
              Object.entries(MODEL_MAPPING).map(([id, m]) => {
                // Only Claude Opus has variants (thinking budget).
                // All Gemini/OSS models have tier baked into the model ID.
                const getVariants = () => {
                  if (m.family === "claude" && id.includes("opus")) {
                    return { low: { thinkingBudget: 8192 }, max: { thinkingBudget: 32768 } }
                  }
                  return {}
                }

                const contextLimit = m.family === "claude" ? 200000
                  : m.family === "openweight" ? 131072
                  : 1048576

                const releaseDate = id.includes("3.7") ? "2026-08-13"
                  : id.includes("3.6") ? "2026-07-21"
                  : id.includes("3.5") ? "2026-06-01"
                  : id.includes("3.1") ? "2026-03-01"
                  : "2025-12-01"

                return [
                  id,
                  {
                    id,
                    name: m.name,
                    providerID: ANTIGRAVITY_PROVIDER_ID,
                    api: {
                      npm: "@atomcli/antigravity",
                      id,
                      url: m.headerStyle === "gemini-cli" ? GEMINI_CLI_ENDPOINT : ANTIGRAVITY_ENDPOINT,
                    },
                    status: "active" as const,
                    capabilities: {
                      temperature: true,
                      reasoning: m.family === "gemini" || id.includes("thinking") || id.includes("opus"),
                      attachment: m.family !== "openweight",
                      toolcall: true,
                      input: { text: true, audio: false, image: m.family !== "openweight", video: false, pdf: m.family !== "openweight" },
                      output: { text: true, audio: false, image: false, video: false, pdf: false },
                      interleaved: false,
                    },
                    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                    limit: { context: contextLimit, output: 65535 },
                    options: {},
                    headers: {},
                    release_date: releaseDate,
                    variants: getVariants(),
                  },
                ]
              }),
            ),
          ) as any
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
            // Uses built-in credentials from constants (with fallback)
            const authResult = createAuthorizationUrl()

            if ("error" in authResult) {
              throw new Error(authResult.error)
            }

            // Open browser for Google OAuth
            try {
              await open(authResult.url)
            } catch (e) {
              log.warn("Could not open browser automatically")
            }

            // Start local OAuth callback server to receive the code
            const serverPromise = startOAuthServer(51121)

            return {
              url: authResult.url,
              instructions:
                "Complete Google sign-in in your browser. If browser didn't open, copy the URL above and open it manually.",
              method: "auto" as const,
              callback: async () => {
                try {
                  // Wait for OAuth callback from browser
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
                  await addAccount(tokenResult.refresh, tokenResult.email, tokenResult.projectId)

                  log.info("Antigravity authentication successful", {
                    email: tokenResult.email,
                  })

                  return {
                    type: "success" as const,
                    refresh: tokenResult.refresh,
                    access: tokenResult.access,
                    expires: tokenResult.expires,
                    email: tokenResult.email,
                    projectId: tokenResult.projectId,
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
