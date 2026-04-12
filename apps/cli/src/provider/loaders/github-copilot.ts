import { CustomLoader } from "../types"

export const github_copilot: CustomLoader = async () => {
    return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
            if (modelID.includes("codex")) {
                return sdk.responses(modelID)
            }
            return sdk.chat(modelID)
        },
        options: {},
    }
}

export const github_copilot_enterprise: CustomLoader = async () => {
    return {
        autoload: false,
        async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
            if (modelID.includes("codex")) {
                return sdk.responses(modelID)
            }
            return sdk.chat(modelID)
        },
        options: {},
    }
}
