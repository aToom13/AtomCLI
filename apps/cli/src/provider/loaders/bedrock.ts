import { Auth } from "@/auth"
import { BunProc } from "@/bun"
import { Config } from "../../config/config"
import { Env } from "@/env"
import type { CustomLoader } from "../types"

export const amazonBedrock: CustomLoader = async () => {
    const config = await Config.get()
    const providerConfig = config.provider?.["amazon-bedrock"]

    const auth = await Auth.get("amazon-bedrock")

    const profile = (auth?.type === "api" ? auth.key : undefined) ?? providerConfig?.options?.profile
    const defaultRegion = providerConfig?.options?.region ?? Env.get("AWS_REGION")

    // Only proceed if we have some form of credentials or profile/region configured
    const hasEnvCreds = Env.get("AWS_ACCESS_KEY_ID") || Env.get("AWS_PROFILE") || Env.get("AWS_REGION") || Env.get("AWS_BEARER_TOKEN_BEDROCK")
    if (!hasEnvCreds && !profile && !providerConfig) {
        return { autoload: false }
    }

    const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))

    // Build credential provider options (only pass profile if specified)
    const credentialProviderOptions = profile ? { profile } : {}

    const providerOptions: any = {
        region: defaultRegion,
        credentialProvider: fromNodeProviderChain(credentialProviderOptions),
    }

    // Add custom endpoint if specified (endpoint takes precedence over baseURL)
    const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
    if (endpoint) {
        providerOptions.baseURL = endpoint
    }

    return {
        autoload: true,
        options: providerOptions,
        getModel: async (sdk, modelID, options) => {
            return sdk.bedrock(modelID, options)
        },
    }
}
