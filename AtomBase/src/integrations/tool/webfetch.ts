import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { BlockList, isIP } from "net"
import { lookup } from "dns/promises"
import { Http } from "./http"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

const BLOCKED_IPS = new BlockList()
BLOCKED_IPS.addSubnet("0.0.0.0", 8, "ipv4")
BLOCKED_IPS.addSubnet("10.0.0.0", 8, "ipv4")
BLOCKED_IPS.addSubnet("100.64.0.0", 10, "ipv4")
BLOCKED_IPS.addSubnet("127.0.0.0", 8, "ipv4")
BLOCKED_IPS.addSubnet("169.254.0.0", 16, "ipv4")
BLOCKED_IPS.addSubnet("172.16.0.0", 12, "ipv4")
BLOCKED_IPS.addSubnet("192.0.0.0", 24, "ipv4")
BLOCKED_IPS.addSubnet("192.0.2.0", 24, "ipv4")
BLOCKED_IPS.addSubnet("192.168.0.0", 16, "ipv4")
BLOCKED_IPS.addSubnet("198.18.0.0", 15, "ipv4")
BLOCKED_IPS.addSubnet("198.51.100.0", 24, "ipv4")
BLOCKED_IPS.addSubnet("203.0.113.0", 24, "ipv4")
BLOCKED_IPS.addSubnet("224.0.0.0", 4, "ipv4")
BLOCKED_IPS.addSubnet("240.0.0.0", 4, "ipv4")
BLOCKED_IPS.addSubnet("::", 128, "ipv6")
BLOCKED_IPS.addSubnet("::1", 128, "ipv6")
BLOCKED_IPS.addSubnet("64:ff9b:1::", 48, "ipv6")
BLOCKED_IPS.addSubnet("100::", 64, "ipv6")
BLOCKED_IPS.addSubnet("2001:db8::", 32, "ipv6")
BLOCKED_IPS.addSubnet("fc00::", 7, "ipv6")
BLOCKED_IPS.addSubnet("fe80::", 10, "ipv6")
BLOCKED_IPS.addSubnet("ff00::", 8, "ipv6")

// Dangerous URL schemes
const DANGEROUS_SCHEMES = [
  "file://",
  "ftp://",
  "ftps://",
  "sftp://",
  "scp://",
  "ssh://",
  "telnet://",
  "smtp://",
  "imap://",
  "pop3://",
  "ldap://",
  "ldaps://",
]

/**
 * Validates URL for security issues
 * - Checks for allowed schemes (http/https only)
 * - Prevents SSRF by blocking private IPs
 * - Validates URL format
 */
function validateUrl(url: string): URL {
  // Check for dangerous schemes first
  const lowerUrl = url.toLowerCase()
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      throw new Error(
        `URL scheme "${scheme}" is not allowed for security reasons. Only http:// and https:// are permitted.`,
      )
    }
  }

  // Must start with http:// or https://
  if (!lowerUrl.startsWith("http://") && !lowerUrl.startsWith("https://")) {
    throw new Error("URL must start with http:// or https://")
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Invalid URL format")
  }
  if (parsed.username || parsed.password) throw new Error("Credentials in webfetch URLs are not allowed")

  // Check for private/internal IP addresses (SSRF protection)
  const hostname = parsed.hostname.toLowerCase()

  // Block localhost variants
  if (hostname === "localhost" || hostname === "localhost.localdomain") {
    throw new Error("Access to localhost is not allowed for security reasons.")
  }

  const address = hostname.replace(/^\[|\]$/g, "")
  const family = isIP(address)
  if (
    address.toLowerCase().startsWith("::ffff:") ||
    (family && BLOCKED_IPS.check(address, family === 4 ? "ipv4" : "ipv6"))
  ) {
    throw new Error(`Access to private IP address "${hostname}" is not allowed for security reasons.`)
  }

  // Block common internal hostnames
  const blockedHostnames = [
    "metadata.google.internal",
    "metadata.google.internal.",
    "169.254.169.254", // AWS/Azure/GCP metadata
    "instance-data", // EC2
    "metadata", // Cloud metadata
  ]
  if (blockedHostnames.includes(hostname)) {
    throw new Error(`Access to internal service "${hostname}" is not allowed.`)
  }

  // Validate port (block common internal ports)
  const port = parsed.port || (parsed.protocol === "https:" ? 443 : 80)
  const dangerousPorts = [
    22, // SSH
    23, // Telnet
    25, // SMTP
    110, // POP3
    143, // IMAP
    3306, // MySQL
    5432, // PostgreSQL
    6379, // Redis
    27017, // MongoDB
    9200, // Elasticsearch
  ]
  if (dangerousPorts.includes(Number(port))) {
    throw new Error(`Access to port ${port} is not allowed for security reasons.`)
  }

  return parsed
}

type ResolvedAddress = { address: string; family: number }
type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const defaultResolver: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true })

function withAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

export namespace WebFetchSecurity {
  export function validate(url: string) {
    return validateUrl(url)
  }

  export async function resolvePublicAddresses(url: URL, signal: AbortSignal, resolver = defaultResolver) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    const directFamily = isIP(hostname)
    const addresses = directFamily
      ? [{ address: hostname, family: directFamily }]
      : await withAbort(resolver(hostname), signal)
    if (addresses.length === 0) throw new Error(`Hostname did not resolve: ${hostname}`)

    for (const entry of addresses) {
      const family = entry.family === 4 || entry.family === 6 ? entry.family : isIP(entry.address)
      const type = family === 4 ? "ipv4" : family === 6 ? "ipv6" : undefined
      if (!type || entry.address.toLowerCase().startsWith("::ffff:") || BLOCKED_IPS.check(entry.address, type)) {
        throw new Error(`Hostname "${hostname}" resolves to a private or reserved address`)
      }
    }
    return addresses
  }

  export async function fetchPinned(
    url: URL,
    init: RequestInit,
    resolver: HostResolver = defaultResolver,
    fetcher: Fetcher = globalThis.fetch,
  ) {
    if (!init.signal) throw new Error("A request signal is required")
    const addresses = await resolvePublicAddresses(url, init.signal, resolver)
    const selected = addresses[0].address
    const originalHostname = url.hostname.replace(/^\[|\]$/g, "")
    const pinned = new URL(url)
    pinned.hostname = selected.includes(":") ? `[${selected}]` : selected

    const headers = new Headers(init.headers)
    headers.set("Host", url.host)
    const tls = url.protocol === "https:" && !isIP(originalHostname) ? { serverName: originalHostname } : undefined

    return fetcher(pinned, {
      ...init,
      headers,
      keepalive: false,
      ...(tls ? { tls } : {}),
    } as RequestInit)
  }
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().int().min(1).max(MAX_TIMEOUT / 1_000).describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL with enhanced security checks
    const validatedUrl = validateUrl(params.url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: [`${validatedUrl.origin}/*`],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })
    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(new Error(`Web fetch timed out after ${timeout} ms`)), timeout)
    const signal = AbortSignal.any([controller.signal, ctx.abort])

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }

    // Custom fetch with redirect limit to prevent redirect loops
    let redirectCount = 0
    let currentUrl = validatedUrl.toString()
    let response: Response | undefined

    try {
      while (true) {
        const requestUrl = new URL(currentUrl)
        response = await WebFetchSecurity.fetchPinned(requestUrl, {
          signal,
          headers: {
            "User-Agent": "AtomCLI/1.0",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "manual",
        })

        if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
          redirectCount++
          if (redirectCount > MAX_REDIRECTS) {
            await response.body?.cancel().catch(() => {})
            response = undefined
            throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS} allowed)`)
          }

          try {
            const location = response.headers.get("location")!
            const redirectUrl = validateUrl(new URL(location, currentUrl).toString())
            if (redirectUrl.origin !== new URL(currentUrl).origin) {
              await ctx.ask({
                permission: "webfetch",
                patterns: [redirectUrl.toString()],
                always: [`${redirectUrl.origin}/*`],
                metadata: { url: redirectUrl.toString(), redirectedFrom: currentUrl },
              })
            }
            currentUrl = redirectUrl.toString()
          } finally {
            await response.body?.cancel().catch(() => {})
            response = undefined
          }
          continue
        }
        break
      }

      if (!response?.ok) throw new Error(`Request failed with status code: ${response?.status ?? "unknown"}`)

      const contentType = response.headers.get("content-type") || ""
      if (
        contentType &&
        !contentType.startsWith("text/") &&
        !/application\/(json|xml|xhtml\+xml|javascript)/i.test(contentType)
      ) {
        throw new Error(`Unsupported response content type: ${contentType}`)
      }

      const content = await Http.readText(response, MAX_RESPONSE_SIZE)
      response = undefined
      const title = `${params.url} (${contentType})`

      switch (params.format) {
        case "markdown":
          if (contentType.includes("text/html")) {
            const markdown = convertHTMLToMarkdown(content)
            return { output: markdown, title, metadata: {} }
          }
          return { output: content, title, metadata: {} }
        case "text":
          if (contentType.includes("text/html")) {
            const text = await extractTextFromHTML(content)
            return { output: text, title, metadata: {} }
          }
          return { output: content, title, metadata: {} }
        case "html":
          return {
            output: content,
            title,
            metadata: {},
          }
      }
    } catch (error) {
      await response?.body?.cancel().catch(() => {})
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  },
})

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
