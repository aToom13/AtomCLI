import { Auth } from "@/auth"
import { Env } from "@/env"
import { iife } from "@/util/iife"
import type { CustomLoader } from "../types"

export const openrouter: CustomLoader = async () => {
    return {
        autoload: false,
        options: {
            headers: {
                "HTTP-Referer": "https://atomcli.ai/",
                "X-Title": "atomcli",
            },
        },
    }
}

export const vercel: CustomLoader = async () => {
    return {
        autoload: false,
    }
}

export const sapAiCore: CustomLoader = async () => {
    const envServiceKey = iife(() => {
        const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
        try {
            if (envAICoreServiceKey) return JSON.parse(envAICoreServiceKey)
        } catch {
            return undefined
        }
        return undefined
    })
    const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
    const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

    return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
    }
}

export const zenmux: CustomLoader = async () => {
    return {
        autoload: false,
    }
}

export const cloudflareAiGateway: CustomLoader = async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

    if (!accountId || !gateway) return { autoload: false }

    const apiToken = await (async () => {
        const envToken = Env.get("CLOUDFLARE_API_TOKEN")
        if (envToken) return envToken
        const auth = await Auth.get(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
    })()

    return {
        autoload: true,
        options: {
            baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/compat`,
            headers: {
                // Cloudflare AI Gateway uses cf-aig-authorization for authenticated gateways
                // This enables Unified Billing where Cloudflare handles upstream provider auth
                ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
                "HTTP-Referer": "https://atomcli.ai/",
                "X-Title": "atomcli",
            },
            // Custom fetch to strip Authorization header - AI Gateway uses cf-aig-authorization instead
            // Sending Authorization header with invalid value causes auth errors
            fetch: (input: RequestInfo | URL, init?: RequestInit) => {
                const headers = new Headers(init?.headers)
                headers.delete("Authorization")
                return fetch(input, { ...init, headers })
            },
        },
    }
}

export const cerebras: CustomLoader = async () => {
    return {
        autoload: false,
    }
}
