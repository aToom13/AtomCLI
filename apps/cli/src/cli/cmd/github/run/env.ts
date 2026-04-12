import { Provider } from "../../../../provider/provider"

export function normalizeModel() {
    const value = process.env["MODEL"]
    if (!value) throw new Error(`Environment variable "MODEL" is not set`)

    const { providerID, modelID } = Provider.parseModel(value)

    if (!providerID.length || !modelID.length)
        throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)
    return { providerID, modelID }
}

export function normalizeRunId() {
    const value = process.env["GITHUB_RUN_ID"]
    if (!value) throw new Error(`Environment variable "GITHUB_RUN_ID" is not set`)
    return value
}

export function normalizeShare() {
    const value = process.env["SHARE"]
    if (!value) return undefined
    if (value === "true") return true
    if (value === "false") return false
    throw new Error(`Invalid share value: ${value}. Share must be a boolean.`)
}

export function normalizeUseGithubToken() {
    const value = process.env["USE_GITHUB_TOKEN"]
    if (!value) return false
    if (value === "true") return true
    if (value === "false") return false
    throw new Error(`Invalid use_github_token value: ${value}. Must be a boolean.`)
}

export function normalizeOidcBaseUrl(): string {
    const value = process.env["OIDC_BASE_URL"]
    if (!value) return "https://api.atomcli.ai"
    return value.replace(/\/+$/, "")
}
