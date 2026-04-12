import { CustomLoader } from "../types"
import { Env } from "../../env"

export const google_vertex: CustomLoader = async () => {
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
        async getModel(sdk: any, modelID: string) {
            const id = String(modelID).trim()
            return sdk.languageModel(id)
        },
    }
}

export const google_vertex_anthropic: CustomLoader = async () => {
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
        async getModel(sdk: any, modelID) {
            const id = String(modelID).trim()
            return sdk.languageModel(id)
        },
    }
}
