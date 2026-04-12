import { Env } from "@/env"
import type { CustomLoader } from "../types"

export const googleVertex: CustomLoader = async () => {
    const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-east5"
    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
        autoload: true,
        options: {
            project,
            location,
        },
        getModel: async (sdk, modelID) => {
            return sdk.googleVertex(modelID)
        },
    }
}

export const googleVertexAnthropic: CustomLoader = async () => {
    const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
        autoload: true,
        options: {
            project,
            location,
        },
        getModel: async (sdk, modelID) => {
            return sdk.googleVertex(modelID)
        },
    }
}
