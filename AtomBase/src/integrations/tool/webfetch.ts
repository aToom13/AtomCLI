import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

// Private IP ranges for SSRF protection
const PRIVATE_IP_PATTERNS = [
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // Link-local
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fc00:/, // IPv6 unique local
  /^fe80:/, // IPv6 link-local
]

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

  // Check for private/internal IP addresses (SSRF protection)
  const hostname = parsed.hostname.toLowerCase()

  // Block localhost variants
  if (hostname === "localhost" || hostname === "localhost.localdomain") {
    throw new Error("Access to localhost is not allowed for security reasons.")
  }

  // Block private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Access to private IP address "${hostname}" is not allowed for security reasons.`)
    }
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

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL with enhanced security checks
    const validatedUrl = validateUrl(params.url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

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
    let response: Response

    while (true) {
      response = await fetch(currentUrl, {
        signal: AbortSignal.any([controller.signal, ctx.abort]),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: acceptHeader,
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual", // Handle redirects manually to validate each hop
      })

      // Check if it's a redirect
      if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
        redirectCount++
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS} allowed)`)
        }

        // Validate the redirect URL
        const location = response.headers.get("location")!
        const redirectUrl = new URL(location, currentUrl)

        // Re-validate the redirect URL for security
        try {
          validateUrl(redirectUrl.toString())
        } catch (error) {
          throw new Error(`Redirect to unsafe URL blocked: ${error instanceof Error ? error.message : "Unknown error"}`)
        }

        currentUrl = redirectUrl.toString()
        continue
      }

      break
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    // Check content length
    const contentLength = response.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""

    const title = `${params.url} (${contentType})`

    // Handle content based on requested format and actual content type
    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)
          return {
            output: markdown,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "text":
        if (contentType.includes("text/html")) {
          const text = await extractTextFromHTML(content)
          return {
            output: text,
            title,
            metadata: {},
          }
        }
        return {
          output: content,
          title,
          metadata: {},
        }

      case "html":
        return {
          output: content,
          title,
          metadata: {},
        }

      default:
        return {
          output: content,
          title,
          metadata: {},
        }
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
