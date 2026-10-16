import { Auth } from "@/services/auth"
import { Env } from "@/core/env"
import type { Provider } from "./provider"

export async function loadConfiguredAuth(input: {
  database: Record<string, Provider.Info>
  disabled: Set<string>
  mergeProvider: (id: string, provider: Partial<Provider.Info>) => void
}) {
  const env = Env.all()
  for (const [providerID, provider] of Object.entries(input.database)) {
    if (input.disabled.has(providerID)) continue
    const apiKey = provider.env.map((item) => env[item]).find(Boolean)
    if (apiKey) input.mergeProvider(providerID, { source: "env", key: provider.env.length === 1 ? apiKey : undefined })
  }
  for (const [providerID, auth] of Object.entries(await Auth.all())) {
    if (input.disabled.has(providerID) || auth.type !== "api") continue
    input.mergeProvider(providerID, { source: "api", key: auth.key })
  }
}
