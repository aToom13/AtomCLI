import * as os from "node:os"
import { Log } from "@atomcli/util"

const log = Log.create({ service: "companion-discovery" })

/**
 * Companion App Endpoint Discovery
 *
 * Detects reachable network endpoints for the mobile companion to connect.
 * Priority order:
 *  1. Tailscale IP (100.x.x.x on tailscale0 interface)
 *  2. Local network IPv4 (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 *  3. Tailscale MagicDNS hostname (if `tailscale status --json` is available)
 */
export namespace CompanionDiscovery {
    export interface Endpoint {
        /** e.g. "ws://192.168.1.42:4096/companion/ws" */
        url: string
        /** Human-readable label for the UI */
        label: string
        /** Priority (lower = preferred) */
        priority: number
    }

    /**
     * Detects all viable endpoints for the given server port.
     */
    export function detectEndpoints(port: number): Endpoint[] {
        const endpoints: Endpoint[] = []
        const interfaces = os.networkInterfaces()

        for (const [name, addrs] of Object.entries(interfaces)) {
            if (!addrs) continue
            for (const addr of addrs ?? []) {
                if (addr.internal) continue
                if (addr.family !== "IPv4") continue

                const isTailscale = name.startsWith("tailscale") || name.startsWith("ts")
                const isLocalNetwork = isPrivateIPv4(addr.address)

                if (isTailscale) {
                    endpoints.push({
                        url: `ws://${addr.address}:${port}/companion/ws`,
                        label: `Tailscale (${name}: ${addr.address})`,
                        priority: 1,
                    })
                } else if (isLocalNetwork) {
                    endpoints.push({
                        url: `ws://${addr.address}:${port}/companion/ws`,
                        label: `LAN (${name}: ${addr.address})`,
                        priority: 2,
                    })
                }
            }
        }

        // Sort by priority
        endpoints.sort((a, b) => a.priority - b.priority)

        if (endpoints.length === 0) {
            log.warn("no companion-reachable endpoints found; mobile app will not be able to connect")
            // NOTE: Do NOT add ws://0.0.0.0 here — mobile devices cannot resolve 0.0.0.0.
            // The caller (printCompanionInfo) will warn the user instead.
        }

        return endpoints
    }

    /**
     * Try to get Tailscale MagicDNS hostname by running `tailscale status --json`.
     * Returns null if Tailscale is not installed or not running.
     */
    export async function getTailscaleMagicDNS(): Promise<string | null> {
        try {
            const proc = Bun.spawn(["tailscale", "status", "--json"], {
                stdout: "pipe",
                stderr: "ignore",
            })
            const text = await new Response(proc.stdout).text()
            const exitCode = await proc.exited
            if (exitCode !== 0) return null

            const status = JSON.parse(text)
            const selfNode = status?.Self
            if (!selfNode?.DNSName) return null

            // MagicDNS names end with a trailing dot — remove it
            const dnsName = selfNode.DNSName.replace(/\.$/, "")
            return dnsName
        } catch {
            return null
        }
    }

    /**
     * Build the full QR payload for the companion app.
     */
    export async function buildQRPayload(port: number, pairingToken: string): Promise<QRPayload> {
        const endpoints = detectEndpoints(port)
        const magicDNS = await getTailscaleMagicDNS()

        // If we have MagicDNS, add it as highest priority endpoint
        if (magicDNS) {
            endpoints.unshift({
                url: `ws://${magicDNS}:${port}/companion/ws`,
                label: `Tailscale MagicDNS (${magicDNS})`,
                priority: 0,
            })
        }

        // For http_pair, prefer a direct IP endpoint over MagicDNS.
        // Android Tailscale may not resolve MagicDNS hostnames depending on DNS config.
        const ipEndpoint = endpoints.find((e) => e.priority >= 1) ?? endpoints[0]
        const httpHost = ipEndpoint
            ? new URL(ipEndpoint.url).host
            : null

        return {
            v: 1,
            endpoints: endpoints.map((e) => e.url),
            pairing_token: pairingToken,
            // If no IP endpoint found, http_pair will be empty — caller must warn user.
            http_pair: httpHost ? `http://${httpHost}/companion/pair` : ``,
        }
    }

    export interface QRPayload {
        v: number
        endpoints: string[]
        pairing_token: string
        http_pair: string
    }

    /**
     * Print QR code + endpoint info to the terminal.
     */
    export async function printCompanionInfo(port: number, pairingToken: string): Promise<void> {
        const payload = await buildQRPayload(port, pairingToken)
        const payloadJSON = JSON.stringify(payload)

        console.log("")
        console.log("╔══════════════════════════════════════════════════════════╗")
        console.log("║            🔗 AtomCLI Companion App Pairing            ║")
        console.log("╠══════════════════════════════════════════════════════════╣")

        // Print detected endpoints — reuse what buildQRPayload already gathered
        if (payload.endpoints.length === 0) {
            console.log("║  ⚠️  WARNING: No LAN/Tailscale interfaces detected!      ")
            console.log("║  The companion app will NOT be able to connect.          ")
            console.log("║  Run with a reachable network interface (e.g. Wi-Fi).    ")
        } else {
            for (const url of payload.endpoints) {
                const isTailscale = url.includes("tailscale") || /ws:\/\/100\./.test(url)
                const icon = isTailscale ? "🔒" : "📡"
                console.log(`║  ${icon} ${url}`)
            }
        }
        console.log("╠══════════════════════════════════════════════════════════╣")

        // Generate QR code
        try {
            const { default: qrcode } = await import("qrcode-terminal")
            qrcode.generate(payloadJSON, { small: true }, (qr: string) => {
                for (const line of qr.split("\n")) {
                    console.log(`║  ${line}`)
                }
            })
        } catch {
            // Fallback: just show the payload
            console.log("║  QR generation unavailable (install: bun add qrcode-terminal)")
            console.log(`║  Payload: ${payloadJSON}`)
        }

        console.log("╠══════════════════════════════════════════════════════════╣")
        console.log(`║  Token: ${pairingToken.slice(0, 8)}...${pairingToken.slice(-4)}`)
        console.log(`║  Expires in: 5 minutes`)
        console.log("╚══════════════════════════════════════════════════════════╝")
        console.log("")
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    function isPrivateIPv4(ip: string): boolean {
        const parts = ip.split(".").map(Number)
        if (parts.length !== 4) return false
        // 10.0.0.0/8
        if (parts[0] === 10) return true
        // 172.16.0.0/12
        if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true
        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) return true
        // Tailscale CGNAT: 100.64.0.0/10
        if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) return true
        return false
    }
}
