import { BunFetchRequestInit } from "bun" // Wait, bun types? Revert to "any" if not avail.
import { Log } from "../util/log"
import { InitError } from "./errors"
import { BunProc } from "../bun"
import { Model } from "./types"
import { type Provider as SDK } from "ai"
import { Provider } from "./provider"

const log = Log.create({ service: "provider:sdk" })

export async function createSDK(
    model: Model,
    providerOptions: any,
    sdkState: Map<number, SDK>,
    bundledProviders: Record<string, (options: any) => SDK>
): Promise<SDK> {
    try {
        using _ = log.time("createSDK", {
            providerID: model.providerID,
        })

        const options = { ...providerOptions }

        if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
            options["includeUsage"] = true
        }

        if (!options["baseURL"]) options["baseURL"] = model.api.url
        if (model.headers)
            options["headers"] = {
                ...options["headers"],
                ...model.headers,
            }

        const key = Bun.hash.xxHash32(JSON.stringify({ npm: model.api.npm, options }))
        const existing = sdkState.get(key)
        if (existing) return existing

        const customFetch = options["fetch"]

        options["fetch"] = async (input: any, init?: any) => {
            // Preserve custom fetch if it exists, wrap it with timeout logic
            const fetchFn = customFetch ?? fetch
            const opts = init ?? {}

            if (options["timeout"] !== undefined && options["timeout"] !== null) {
                const signals: AbortSignal[] = []
                if (opts.signal) signals.push(opts.signal)
                if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

                const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

                opts.signal = combined
            }

            return fetchFn(input, {
                ...opts,
                timeout: false,
            })
        }

        // Special case: google-vertex-anthropic uses a subpath import
        const bundledKey =
            model.providerID === "google-vertex-anthropic" ? "@ai-sdk/google-vertex/anthropic" : model.api.npm
        const bundledFn = bundledProviders[bundledKey]
        if (bundledFn) {
            log.info("using bundled provider", { providerID: model.providerID, pkg: bundledKey })
            const loaded = bundledFn({
                name: model.providerID,
                ...options,
            })
            sdkState.set(key, loaded)
            return loaded as SDK
        }

        let installedPath: string
        if (!model.api.npm.startsWith("file://")) {
            installedPath = await BunProc.install(model.api.npm, "latest")
        } else {
            log.info("loading local provider", { pkg: model.api.npm })
            installedPath = model.api.npm
        }

        const mod = await import(installedPath)

        const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
        const loaded = fn({
            name: model.providerID,
            ...options,
        })
        sdkState.set(key, loaded)
        return loaded as SDK
    } catch (e) {
        throw new InitError({ providerID: model.providerID }, { cause: e })
    }
}
