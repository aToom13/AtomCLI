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
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const companionExplicitlySet = process.argv.includes("--companion")

  CompanionAuth.loadDevices()
  const hasPairedDevices = CompanionAuth.listDevices().length > 0

  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const companion = companionExplicitlySet ? args.companion : false
  const shouldExposeNetwork = companion || hasPairedDevices

  const port = portExplicitlySet
    ? args.port
    : shouldExposeNetwork && !portExplicitlySet
      ? 4096
      : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : (mdns || shouldExposeNetwork) && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, companion, cors }
}
