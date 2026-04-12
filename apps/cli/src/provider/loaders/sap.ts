import { CustomLoader } from "../types"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { iife } from "../../util/iife"

export const sap_ai_core: CustomLoader = async () => {
    const auth = await Auth.get("sap-ai-core")
    const envServiceKey = iife(() => {
        const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
        if (envAICoreServiceKey) return envAICoreServiceKey
        if (auth?.type === "api") {
            Env.set("AICORE_SERVICE_KEY", auth.key)
            return auth.key
        }
        return undefined
    })
    const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
    const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

    return {
        autoload: !!envServiceKey,
        options: envServiceKey ? { deploymentId, resourceGroup } : {},
        async getModel(sdk: any, modelID: string) {
            return sdk(modelID)
        },
    }
}
