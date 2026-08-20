import { isIP } from "node:net"
import { timingSafeEqual } from "node:crypto"

export namespace ServerSecurity {
  export interface RequestPolicy {
    authToken?: string
    allowedHosts?: string[]
    allowedOrigins?: string[]
  }

  function normalizeHostname(value: string) {
    const input = value.trim().toLowerCase()
    if (!input) return ""
    try {
      const hostname = new URL(`http://${input}`).hostname.toLowerCase()
      return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
    } catch {
      return ""
    }
  }

  export function isLoopback(hostname: string) {
    const normalized = normalizeHostname(hostname)
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
  }

  export function acceptsBearer(header: string | undefined, expected: string) {
    if (!header?.startsWith("Bearer ")) return false
    const actual = Buffer.from(header.slice("Bearer ".length), "utf8")
    const wanted = Buffer.from(expected, "utf8")
    return actual.length === wanted.length && timingSafeEqual(actual, wanted)
  }

  function isAllowedHost(host: string | undefined, allowedHosts: string[]) {
    if (!host) return false
    const hostname = normalizeHostname(host)
    if (!hostname) return false
    if (isLoopback(hostname)) return true

    const normalizedAllowed = allowedHosts.map(normalizeHostname)
    if (normalizedAllowed.includes(hostname)) return true

    // Wildcard listeners are reached through the machine's concrete LAN IP.
    // Accept IP literals only for that explicit bind mode; a loopback listener
    // must not trust an arbitrary IP-shaped Host header.
    if (isIP(hostname) !== 0) {
      return normalizedAllowed.includes("0.0.0.0") || normalizedAllowed.includes("::")
    }
    return false
  }

  function originAllowed(origin: URL, host: string, allowedOrigins: string[]) {
    if (origin.protocol === "tauri:" && origin.hostname === "localhost") return true
    if (origin.origin === "http://tauri.localhost") return true
    if (allowedOrigins.includes(origin.origin)) return true
    if (/^https:\/\/([a-z0-9-]+\.)*atomcli\.ai$/.test(origin.origin)) return true

    const hostName = normalizeHostname(host)
    const originName = normalizeHostname(origin.host)
    if (hostName !== originName) return false
    if (isLoopback(originName)) return origin.protocol === "http:" || origin.protocol === "https:"
    return origin.protocol === "https:"
  }

  export function reject(request: Request, policy: RequestPolicy): Response | undefined {
    const host = request.headers.get("host") ?? new URL(request.url).host
    if (!isAllowedHost(host, policy.allowedHosts ?? [])) {
      return Response.json({ error: "invalid_host" }, { status: 403 })
    }

    const originHeader = request.headers.get("origin")
    if (originHeader) {
      let origin: URL
      try {
        origin = new URL(originHeader)
      } catch {
        return Response.json({ error: "invalid_origin" }, { status: 403 })
      }
      if (!originAllowed(origin, host, policy.allowedOrigins ?? [])) {
        return Response.json({ error: "invalid_origin" }, { status: 403 })
      }
    }

    if (policy.authToken && request.method !== "OPTIONS") {
      if (!acceptsBearer(request.headers.get("authorization") ?? undefined, policy.authToken)) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } })
      }
    }
  }
}
