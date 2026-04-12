import { Plugin } from "../plugin"
import { Auth } from "../auth"
import type { Info } from "./types"

export async function loadPlugins(
    database: Record<string, Info>,
    disabled: Set<string>,
    mergeProvider: (id: string, p: Partial<Info>) => void
) {
    for (const plugin of await Plugin.list()) {
        if (!plugin.auth) continue
        const providerID = plugin.auth.provider
        if (disabled.has(providerID)) continue

        let hasAuth = false
        const auth = await Auth.get(providerID)
        if (auth) hasAuth = true

        if (providerID === "github-copilot" && !hasAuth) {
            const enterpriseAuth = await Auth.get("github-copilot-enterprise")
            if (enterpriseAuth) hasAuth = true
        }

        if (!hasAuth) continue
        if (!plugin.auth.loader) continue

        if (auth) {
            const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
            mergeProvider(plugin.auth.provider, {
                source: "custom",
                options: options,
            })
        }

        if (providerID === "github-copilot") {
            const enterpriseProviderID = "github-copilot-enterprise"
            if (!disabled.has(enterpriseProviderID)) {
                const enterpriseAuth = await Auth.get(enterpriseProviderID)
                if (enterpriseAuth) {
                    const enterpriseOptions = await plugin.auth.loader(
                        () => Auth.get(enterpriseProviderID) as any,
                        database[enterpriseProviderID],
                    )
                    mergeProvider(enterpriseProviderID, {
                        source: "custom",
                        options: enterpriseOptions,
                    })
                }
            }
        }
    }
}
