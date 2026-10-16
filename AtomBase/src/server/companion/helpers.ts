import { CompanionDiscovery } from "@atomcli/companion"
import { Log } from "@/util/util/log"

export const log = Log.create({ service: "companion-ws" })

export const MOBILE_SYSTEM_CONTEXT =
  "This user message was sent from the AtomCLI Android Companion. Use a fast, risk-proportionate execution profile: for low-risk prototypes and routine changes, prefer direct work or at most one implementation sub-agent, run one focused verification, do not spawn reviewer/checker agents manually, and return the useful result immediately. Independent review remains required for security-, authorization-, migration-, release-, or data-integrity-sensitive work. Treat this as a fresh user turn; do not resume unfinished plans or verification from an earlier request unless this message explicitly asks you to."

export function diagnosticError(error: unknown) {
  if (!(error instanceof Error)) return { kind: typeof error }
  const code = (error as Error & { code?: unknown }).code
  return {
    name: error.name.slice(0, 64),
    ...(typeof code === "string" && /^[a-z0-9_.-]{1,64}$/i.test(code) ? { code } : {}),
  }
}

export async function companionEndpoints(port: number) {
  const endpoints = CompanionDiscovery.detectEndpoints(port).map((item) => item.url)
  const magicDNS = await CompanionDiscovery.getTailscaleMagicDNS()
  if (magicDNS) endpoints.push(`ws://${magicDNS}:${port}/companion/ws`)
  return Array.from(new Set(endpoints))
}
