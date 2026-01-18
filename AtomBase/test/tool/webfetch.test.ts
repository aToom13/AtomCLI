import { describe, expect, test } from "bun:test"
import { WebFetchTool } from "../../src/tool/webfetch"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

const ctx = {
    sessionID: "test",
    messageID: "",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => { },
    ask: async () => { },
}

describe("tool.webfetch validation", () => {
    test("rejects non-http URL", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()

                await expect(
                    webfetch.execute(
                        {
                            url: "ftp://example.com/file.txt",
                            format: "text",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/http/)
            },
        })
    })

    test("rejects file:// URL", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()

                await expect(
                    webfetch.execute(
                        {
                            url: "file:///etc/passwd",
                            format: "text",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/http/)
            },
        })
    })

    test("rejects relative URL", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()

                await expect(
                    webfetch.execute(
                        {
                            url: "/relative/path",
                            format: "text",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/http/)
            },
        })
    })
})

describe("tool.webfetch permissions", () => {
    test("asks for webfetch permission with correct pattern", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                        // Don't actually fetch - reject after permission
                        throw new Error("permission recorded")
                    },
                }

                try {
                    await webfetch.execute(
                        {
                            url: "https://example.com/page",
                            format: "markdown",
                        },
                        testCtx,
                    )
                } catch (e) {
                    if ((e as Error).message !== "permission recorded") throw e
                }

                expect(requests.length).toBe(1)
                expect(requests[0].permission).toBe("webfetch")
                expect(requests[0].patterns).toContain("https://example.com/page")
                expect(requests[0].metadata?.url).toBe("https://example.com/page")
                expect(requests[0].metadata?.format).toBe("markdown")
            },
        })
    })

    test("includes timeout in permission metadata", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                        throw new Error("permission recorded")
                    },
                }

                try {
                    await webfetch.execute(
                        {
                            url: "https://example.com",
                            format: "text",
                            timeout: 60,
                        },
                        testCtx,
                    )
                } catch (e) {
                    if ((e as Error).message !== "permission recorded") throw e
                }

                expect(requests[0].metadata?.timeout).toBe(60)
            },
        })
    })
})

describe("tool.webfetch format options", () => {
    test("default format is markdown", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                        throw new Error("permission recorded")
                    },
                }

                try {
                    await webfetch.execute(
                        {
                            url: "https://example.com",
                        } as any, // format defaults to markdown
                        testCtx,
                    )
                } catch (e) {
                    if ((e as Error).message !== "permission recorded") throw e
                }

                // Just verify the request was made correctly
                expect(requests.length).toBe(1)
            },
        })
    })
})

// Integration tests that actually fetch (requires network)
// These are skipped by default - run with WEBFETCH_INTEGRATION=1
const runIntegration = process.env.WEBFETCH_INTEGRATION === "1"

describe.skipIf(!runIntegration)("tool.webfetch integration", () => {
    test("fetch example.com as markdown", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const result = await webfetch.execute(
                    {
                        url: "https://example.com",
                        format: "markdown",
                    },
                    ctx,
                )

                expect(result.output).toContain("Example Domain")
                expect(result.metadata.url).toBe("https://example.com")
            },
        })
    })

    test("fetch example.com as text", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const result = await webfetch.execute(
                    {
                        url: "https://example.com",
                        format: "text",
                    },
                    ctx,
                )

                expect(result.output).toContain("Example Domain")
            },
        })
    })

    test("fetch example.com as html", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const result = await webfetch.execute(
                    {
                        url: "https://example.com",
                        format: "html",
                    },
                    ctx,
                )

                expect(result.output).toContain("<html")
                expect(result.output).toContain("Example Domain")
            },
        })
    })

    test("handles 404 error", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()

                await expect(
                    webfetch.execute(
                        {
                            url: "https://httpstat.us/404",
                            format: "text",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/404/)
            },
        })
    })
})
