import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import type { ToolKind } from "@agentclientprotocol/sdk"
import type { ACPConfig } from "./types"
import { applyPatch } from "diff"

const log = Log.create({ service: "acp-utils" })

export function toToolKind(toolName: string): ToolKind {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
        case "bash":
            return "execute"
        case "webfetch":
            return "fetch"

        case "edit":
        case "patch":
        case "write":
            return "edit"

        case "grep":
        case "glob":
        case "context7_resolve_library_id":
        case "context7_get_library_docs":
            return "search"

        case "list":
        case "read":
            return "read"

        default:
            return "other"
    }
}

export function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
        case "read":
        case "edit":
        case "write":
            return input["filePath"] ? [{ path: input["filePath"] }] : []
        case "glob":
        case "grep":
            return input["path"] ? [{ path: input["path"] }] : []
        case "bash":
            return []
        case "list":
            return input["path"] ? [{ path: input["path"] }] : []
        default:
            return []
    }
}

export async function defaultModel(config: ACPConfig, cwd?: string) {
    const sdk = config.sdk
    const configured = config.defaultModel
    if (configured) return configured

    const directory = cwd ?? process.cwd()

    const specified = await sdk.config
        .get({ directory }, { throwOnError: true })
        .then((resp) => {
            const cfg = resp.data
            if (!cfg || !cfg.model) return undefined
            const parsed = Provider.parseModel(cfg.model)
            return {
                providerID: parsed.providerID,
                modelID: parsed.modelID,
            }
        })
        .catch((error) => {
            log.error("failed to load user config for default model", { error })
            return undefined
        })

    const providers = await sdk.config
        .providers({ directory }, { throwOnError: true })
        .then((x) => x.data?.providers ?? [])
        .catch((error) => {
            log.error("failed to list providers for default model", { error })
            return []
        })

    if (specified && providers.length) {
        const provider = providers.find((p) => p.id === specified.providerID)
        if (provider && provider.models[specified.modelID]) return specified
    }

    if (specified && !providers.length) return specified

    const atomcliProvider = providers.find((p) => p.id === "atomcli")
    if (atomcliProvider) {
        if (atomcliProvider.models["big-pickle"]) {
            return { providerID: "atomcli", modelID: "big-pickle" }
        }
        const [best] = Provider.sort(Object.values(atomcliProvider.models))
        if (best) {
            return {
                providerID: best.providerID,
                modelID: best.id,
            }
        }
    }

    const models = providers.flatMap((p) => Object.values(p.models))
    const [best] = Provider.sort(models)
    if (best) {
        return {
            providerID: best.providerID,
            modelID: best.id,
        }
    }

    if (specified) return specified

    return { providerID: "atomcli", modelID: "big-pickle" }
}

export function parseUri(
    uri: string,
): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
    try {
        if (uri.startsWith("file://")) {
            const path = uri.slice(7)
            const name = path.split("/").pop() || path
            return {
                type: "file",
                url: uri,
                filename: name,
                mime: "text/plain",
            }
        }
        if (uri.startsWith("zed://")) {
            const url = new URL(uri)
            const path = url.searchParams.get("path")
            if (path) {
                const name = path.split("/").pop() || path
                return {
                    type: "file",
                    url: `file://${path}`,
                    filename: name,
                    mime: "text/plain",
                }
            }
        }
        return {
            type: "text",
            text: uri,
        }
    } catch {
        return {
            type: "text",
            text: uri,
        }
    }
}

export function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
    const result = applyPatch(fileOriginal, unifiedDiff)
    if (result === false) {
        log.error("Failed to apply unified diff (context mismatch)")
        return undefined
    }
    return result
}
