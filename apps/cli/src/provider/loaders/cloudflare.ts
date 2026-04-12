import { CustomLoader } from "../types"
import { Env } from "../../env"
import { Auth } from "../../auth"

export const cloudflare_ai_gateway: CustomLoader = async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

    if (!accountId || !gateway) return { autoload: false }

    // Get API token from env or auth prompt
    const apiToken = await (async () => {
        const envToken = Env.get("CLOUDFLARE_API_TOKEN")
        if (envToken) return envToken
        const auth = await Auth.get(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
    })()

    return {
        autoload: true,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
            return sdk.languageModel(modelID)
        },
        options: {
            baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/compat`,
            headers: {
                // Cloudflare AI Gateway uses cf-aig-authorization for authenticated gateways
                // This enables Unified Billing where Cloudflare handles upstream provider auth
                // This enables Unified Billing where Cloudflare handles upstream provider auth
                ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
                "HTTP-Referer": "https://atomcli.ai/",
                "X-Title": "atomcli",
            },
            // Custom fetch to strip Authorization header - AI Gateway uses cf-aig-authorization instead
            // Sending Authorization header with invalid value causes auth errors
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const headers = new Headers(init?.headers)
                headers.delete("Authorization")
                return fetch(input, { ...init, headers })
            },
        },
    }
}
