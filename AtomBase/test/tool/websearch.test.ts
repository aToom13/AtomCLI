import { describe, expect, test } from "bun:test"
import { WebSearchTool } from "@/integrations/tool/websearch"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "@/util/permission/next"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.websearch permissions", () => {
  test("asks for websearch permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            // Don't actually search - reject after permission
            throw new Error("permission recorded")
          },
        }

        try {
          await websearch.execute(
            {
              query: "TypeScript best practices",
            },
            testCtx,
          )
        } catch (e) {
          if ((e as Error).message !== "permission recorded") throw e
        }

        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("websearch")
        expect(requests[0].patterns).toContain("TypeScript best practices")
        expect(requests[0].metadata?.query).toBe("TypeScript best practices")
      },
    })
  })

  test("includes numResults in permission metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            throw new Error("permission recorded")
          },
        }

        try {
          await websearch.execute(
            {
              query: "test query",
              numResults: 5,
            },
            testCtx,
          )
        } catch (e) {
          if ((e as Error).message !== "permission recorded") throw e
        }

        expect(requests[0].metadata?.numResults).toBe(5)
      },
    })
  })

  test("includes livecrawl in permission metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            throw new Error("permission recorded")
          },
        }

        try {
          await websearch.execute(
            {
              query: "test query",
              livecrawl: "preferred",
            },
            testCtx,
          )
        } catch (e) {
          if ((e as Error).message !== "permission recorded") throw e
        }

        expect(requests[0].metadata?.livecrawl).toBe("preferred")
      },
    })
  })

  test("includes type in permission metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            throw new Error("permission recorded")
          },
        }

        try {
          await websearch.execute(
            {
              query: "test query",
              type: "deep",
            },
            testCtx,
          )
        } catch (e) {
          if ((e as Error).message !== "permission recorded") throw e
        }

        expect(requests[0].metadata?.type).toBe("deep")
      },
    })
  })

  test("includes contextMaxCharacters in permission metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
            throw new Error("permission recorded")
          },
        }

        try {
          await websearch.execute(
            {
              query: "test query",
              contextMaxCharacters: 5000,
            },
            testCtx,
          )
        } catch (e) {
          if ((e as Error).message !== "permission recorded") throw e
        }

        expect(requests[0].metadata?.contextMaxCharacters).toBe(5000)
      },
    })
  })
})

import { mock } from "bun:test"

describe("tool.websearch integration", () => {
  test("basic search returns results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()

        // Mock fetch
        const originalFetch = global.fetch
        global.fetch = mock(async () => {
          return new Response(
            'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"Node.js is a JavaScript runtime built on Chrome\'s V8 JavaScript engine."}]}}\n\n',
            {
              status: 200,
            },
          )
        }) as any

        try {
          const result = await websearch.execute(
            {
              query: "Node.js",
              numResults: 3,
            },
            ctx,
          )

          expect(result.output).toBeDefined()
          expect(result.output.length).toBeGreaterThan(0)
          expect(result.title).toContain("Node.js")
        } finally {
          global.fetch = originalFetch
        }
      },
    })
  })

  test("code mode calls the explicitly enabled Exa code-context tool", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const originalFetch = global.fetch
        let requestedUrl = ""
        let requestedBody: any
        global.fetch = mock(async (input, init) => {
          requestedUrl = String(input)
          requestedBody = JSON.parse(String(init?.body))
          return new Response(
            'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"Bun serve docs"}]}}\n\n',
            { status: 200 },
          )
        }) as any

        try {
          const result = await websearch.execute(
            { query: "Bun.serve API examples", mode: "code", tokensNum: 3000 },
            ctx,
          )
          expect(requestedUrl).toContain("/mcp?tools=get_code_context_exa")
          expect(requestedBody.params.name).toBe("get_code_context_exa")
          expect(requestedBody.params.arguments).toEqual({ query: "Bun.serve API examples", tokensNum: 3000 })
          expect(result.output).toBe("Bun serve docs")
          expect(result.metadata.mode).toBe("code")
        } finally {
          global.fetch = originalFetch
        }
      },
    })
  })

  test("surfaces MCP errors instead of reporting empty results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const websearch = await WebSearchTool.init()
        const originalFetch = global.fetch
        global.fetch = mock(
          async () =>
            new Response('data: {"jsonrpc":"2.0","error":{"code":-32602,"message":"Tool not found"}}\n\n', {
              status: 200,
            }),
        ) as any

        try {
          await expect(websearch.execute({ query: "broken", mode: "code" }, ctx)).rejects.toThrow(
            "Exa MCP error (-32602): Tool not found",
          )
        } finally {
          global.fetch = originalFetch
        }
      },
    })
  })
})
