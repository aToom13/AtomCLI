import { CustomLoader } from "../types"
import { Env } from "../../env"

export const azure: CustomLoader = async () => {
    return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
            if (options?.["useCompletionUrls"]) {
                return sdk.chat(modelID)
            } else {
                return sdk.responses(modelID)
            }
        },
        options: {},
    }
}

export const azure_cognitive_services: CustomLoader = async () => {
    const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
    return {
        autoload: false,
        async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
            if (options?.["useCompletionUrls"]) {
                return sdk.chat(modelID)
            } else {
                return sdk.responses(modelID)
            }
        },
        options: {
            baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
    }
}
