import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { Http } from "./http"

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_NUM_RESULTS = 8
const DEFAULT_CODE_TOKENS = 5_000
const EXA_BASE_URL = "https://mcp.exa.ai"

type McpResponse = {
  result?: {
    content?: Array<{
      type: string
      text: string
    }>
  }
  error?: {
    code?: number
    message?: string
  }
}

type WebSearchMetadata = {
  mode: "web" | "code"
  tokensNum?: number
  numResults?: number
  engine?: "exa" | "duckduckgo"
}

function parseMcpResponse(responseText: string) {
  const payloads = responseText
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))

  if (payloads.length === 0 && responseText.trim().startsWith("{")) payloads.push(responseText.trim())

  for (const payload of payloads) {
    const data = JSON.parse(payload) as McpResponse
    if (data.error)
      throw new Error(`Exa MCP error (${data.error.code ?? "unknown"}): ${data.error.message ?? "Unknown error"}`)
    const text = data.result?.content?.find((item) => item.type === "text")?.text
    if (text) return text
  }
}

export const WebSearchTool = Tool.define("websearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().min(1).max(2_000).describe("Web or programming-documentation search query"),
    mode: z
      .enum(["web", "code"])
      .default("web")
      .describe("Use 'web' for general/current information or 'code' for libraries, APIs, SDKs, and code examples"),
    numResults: z.number().int().min(1).max(20).optional().describe("Web results to return (default: 8)"),
    tokensNum: z
      .number()
      .int()
      .min(1_000)
      .max(12_000)
      .optional()
      .describe("Context token budget for code mode (default: 5000)"),
    livecrawl: z
      .enum(["fallback", "preferred"])
      .optional()
      .describe("Deprecated compatibility option; Exa now selects crawl freshness automatically"),
    type: z
      .enum(["auto", "fast", "deep"])
      .optional()
      .describe("Deprecated compatibility option; Exa now selects web search strategy automatically"),
    contextMaxCharacters: z
      .number()
      .int()
      .min(1_000)
      .max(50_000)
      .optional()
      .describe("Deprecated compatibility option retained for existing tool calls"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        mode: params.mode,
        numResults: params.numResults,
        tokensNum: params.tokensNum,
        livecrawl: params.livecrawl,
        type: params.type,
        contextMaxCharacters: params.contextMaxCharacters,
      },
    })

    const { Flag } = await import("@/interfaces/flag/flag")
    const { Config } = await import("@/core/config/config")

    let useExa = params.mode === "code"
    if (!useExa) {
      try {
        const config = await Config.get()
        const agentConfig: any = ctx.agent ? config.agent?.[ctx.agent] : undefined
        const model = agentConfig?.model ?? config.model
        const providerID = typeof model === "string" ? model.split("/", 1)[0] : "atomcli"
        useExa = providerID === "atomcli" || Flag.ATOMCLI_ENABLE_EXA
      } catch {
        useExa = Flag.ATOMCLI_ENABLE_EXA
      }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), params.mode === "code" ? 30_000 : 25_000)

    try {
      if (useExa) {
        const codeMode = params.mode === "code"
        const request = {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: codeMode ? "get_code_context_exa" : "web_search_exa",
            arguments: codeMode
              ? { query: params.query, tokensNum: params.tokensNum ?? DEFAULT_CODE_TOKENS }
              : { query: params.query, numResults: params.numResults ?? DEFAULT_NUM_RESULTS },
          },
        }

        const endpoint = codeMode ? "/mcp?tools=get_code_context_exa" : "/mcp"
        const response = await fetch(`${EXA_BASE_URL}${endpoint}`, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.any([controller.signal, ctx.abort]),
        })

        if (!response.ok) {
          const errorText = await Http.readText(response, 64 * 1024)
          throw new Error(`${codeMode ? "Code" : "Web"} search error (${response.status}): ${errorText}`)
        }

        const output = parseMcpResponse(await Http.readText(response, MAX_RESPONSE_BYTES))
        return {
          output:
            output ??
            (codeMode
              ? "No code documentation found. Try a more specific library, API, version, or programming concept."
              : "No search results found. Please try a different query."),
          title: `${codeMode ? "Code" : "Web"} search: ${params.query}`,
          metadata: (codeMode
            ? { mode: "code", tokensNum: params.tokensNum ?? DEFAULT_CODE_TOKENS, engine: "exa" }
            : {
                mode: "web",
                numResults: params.numResults ?? DEFAULT_NUM_RESULTS,
                engine: "exa",
              }) as WebSearchMetadata,
        }
      }

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.any([controller.signal, ctx.abort]),
      })

      if (!response.ok) throw new Error(`Fallback search error: HTTP ${response.status}`)

      const html = await Http.readText(response, MAX_RESPONSE_BYTES)
      const results: string[] = []
      const regex = /<a class="result__url" href="([^"]+)">(.*?)<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gsv
      const limit = params.numResults ?? DEFAULT_NUM_RESULTS
      let match: RegExpExecArray | null

      while ((match = regex.exec(html)) !== null && results.length < limit) {
        let url = match[1]
        if (url.startsWith("//duckduckgo.com/l/?uddg=")) {
          url = decodeURIComponent(url.split("uddg=")[1].split("&")[0])
        }
        const snippet = match[3].replace(/<[^>]+>/g, "").trim()
        results.push(`URL: ${url}\nSnippet: ${snippet}\n`)
      }

      return {
        output:
          results.length > 0
            ? `Fallback Search Results:\n\n${results.join("\n---\n")}`
            : "No search results found from fallback engine.",
        title: `Web search: ${params.query}`,
        metadata: { mode: "web", engine: "duckduckgo", numResults: results.length } as WebSearchMetadata,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (ctx.abort.aborted) throw ctx.abort.reason
        throw new Error(`${params.mode === "code" ? "Code" : "Web"} search request timed out`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  },
})
