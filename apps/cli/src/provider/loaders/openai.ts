import { Env } from "@/env"
import type { CustomLoader } from "../types"

export const openai: CustomLoader = async () => {
    return {
        autoload: false,
        getModel: async (sdk, modelID) => {
            return sdk.openai(modelID)
        },
        options: {},
    }
}

export const githubCopilot: CustomLoader = async () => {
    return {
        autoload: false,
        getModel: async (sdk, modelID) => {
            return sdk.openai(modelID)
        },
        options: {},
    }
}

export const githubCopilotEnterprise: CustomLoader = async () => {
    return {
        autoload: false,
        getModel: async (sdk, modelID) => {
            return sdk.openai(modelID)
        },
        options: {},
    }
}

export const azure: CustomLoader = async () => {
    return {
        autoload: false,
        getModel: async (sdk, modelID, options) => {
            return sdk.azure(modelID, options)
        },
    }
}

export const azureCognitiveServices: CustomLoader = async () => {
    const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
    return {
        autoload: false,
        getModel: async (sdk, modelID, options) => {
            return sdk.azure(modelID, options)
        },
        options: {
            baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
        },
    }
}
