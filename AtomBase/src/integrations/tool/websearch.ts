import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

export const WebSearchTool = Tool.define("websearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Websearch query"),
    numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
    livecrawl: z
      .enum(["fallback", "preferred"])
      .optional()
      .describe(
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
      ),
    type: z
      .enum(["auto", "fast", "deep"])
      .optional()
      .describe("Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"),
    contextMaxCharacters: z
      .number()
      .optional()
      .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        numResults: params.numResults,
        livecrawl: params.livecrawl,
        type: params.type,
        contextMaxCharacters: params.contextMaxCharacters,
      },
    })

    const { Flag } = await import("@/interfaces/flag/flag")
    const { Config } = await import("@/core/config/config")

    // Determine which search engine to use based on the same rules registry uses
    let useExa = false
    try {
      const config = await Config.get()
      const agentConfig: any = ctx.agent ? config.agent?.[ctx.agent] : undefined
      const providerID = agentConfig?.model ? (typeof agentConfig.model === "string" ? agentConfig.model.split(":")[0] : agentConfig.model.providerID) : config.provider?.default || "atomcli"
      useExa = providerID === "atomcli" || Flag.ATOMCLI_ENABLE_EXA
    } catch {
      useExa = Flag.ATOMCLI_ENABLE_EXA
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 25000)

    try {
      if (useExa) {
        const searchRequest: McpSearchRequest = {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search_exa",
            arguments: {
              query: params.query,
              type: params.type || "auto",
              numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
              livecrawl: params.livecrawl || "fallback",
              contextMaxCharacters: params.contextMaxCharacters,
            },
          },
        }

        const headers: Record<string, string> = {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
          method: "POST",
          headers,
          body: JSON.stringify(searchRequest),
          signal: AbortSignal.any([controller.signal, ctx.abort]),
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Exa Search error (${response.status}): ${errorText}`)
        }

        const responseText = await response.text()

        // Parse SSE response
        const lines = responseText.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data: McpSearchResponse = JSON.parse(line.substring(6))
            if (data.result && data.result.content && data.result.content.length > 0) {
              return {
                output: data.result.content[0].text,
                title: `Web search: ${params.query}`,
                metadata: {},
              }
            }
          }
        }

        return {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      } else {
        // Fallback to DuckDuckGo HTML Search
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml"
          },
          signal: AbortSignal.any([controller.signal, ctx.abort]),
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Fallback search error: HTTP ${response.status}`)
        }

        const html = await response.text()
        const results = []
        const regex = /<a class="result__url" href="([^"]+)">(.*?)<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gsv
        let match
        const limit = params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS

        while ((match = regex.exec(html)) !== null && results.length < limit) {
          let url = match[1]
          if (url.startsWith("//duckduckgo.com/l/?uddg=")) {
            url = decodeURIComponent(url.split("uddg=")[1].split("&")[0])
          }
          const snippet = match[3].replace(/<[^>]+>/g, "").trim()
          results.push(`URL: ${url}\nSnippet: ${snippet}\n`)
        }

        if (results.length === 0) {
          return {
            output: "No search results found from fallback engine.",
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }

        return {
          output: `Fallback Search Results:\n\n${results.join("\n---\n")}`,
          title: `Web search: ${params.query}`,
          metadata: {},
        }
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Search request timed out")
      }

      throw error
    }
  },
})
