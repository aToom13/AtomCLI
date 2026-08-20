import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "@/core/config/config"
import { CompanionAuth } from "@atomcli/companion"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  companion: {
    type: "boolean" as const,
    describe: "enable companion app pairing (binds to 0.0.0.0, generates QR code)",
    default: false,
  },
  companionPort: {
    type: "number" as const,
    describe: "port for the scoped companion listener",
    default: 4096,
  },
  auth: {
    type: "string" as const,
    describe: "bearer token required by the control-plane API",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const explicitlySet = (name: string) =>
    process.argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
  const portExplicitlySet = explicitlySet("port")
  const hostnameExplicitlySet = explicitlySet("hostname")
  const mdnsExplicitlySet = explicitlySet("mdns")
  const companionExplicitlySet = explicitlySet("companion")
  const companionPortExplicitlySet = explicitlySet("companion-port") || explicitlySet("companionPort")
  const authExplicitlySet = explicitlySet("auth")

  CompanionAuth.loadDevices()
  const hasPairedDevices = CompanionAuth.listDevices().length > 0

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const pairing = companionExplicitlySet ? args.companion : false
  const companion = pairing || hasPairedDevices

  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const companionPort = companionPortExplicitlySet
    ? args.companionPort
    : (config?.server?.companionPort ?? args.companionPort)
  const auth = authExplicitlySet ? args.auth : (process.env.ATOMCLI_SERVER_TOKEN ?? config?.server?.auth ?? args.auth)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, companion, companionPort, pairing, auth, cors }
}

export function authenticatedFetch(token: string | undefined, baseFetch: typeof fetch = fetch): typeof fetch {
  if (!token) return baseFetch
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", `Bearer ${token}`)
    return baseFetch(request)
  }) as typeof fetch
}
