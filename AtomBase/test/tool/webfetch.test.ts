import { describe, expect, test } from "bun:test"
import { WebFetchSecurity, WebFetchTool } from "@/integrations/tool/webfetch"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "@/util/permission/next"

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
    test("rejects embedded URL credentials and IPv4-mapped IPv6", async () => {
        expect(() => WebFetchSecurity.validate("https://user:secret@example.com/")).toThrow(/Credentials/)
        expect(() => WebFetchSecurity.validate("http://[::ffff:127.0.0.1]/")).toThrow(/private IP/)
    })

    test("rejects a hostname if any DNS answer is private or reserved", async () => {
        await expect(
            WebFetchSecurity.resolvePublicAddresses(
                new URL("https://example.com"),
                AbortSignal.any([]),
                async () => [
                    { address: "93.184.216.34", family: 4 },
                    { address: "10.0.0.7", family: 4 },
                ],
            ),
        ).rejects.toThrow(/private or reserved/)
    })

    test("includes DNS resolution in the request abort boundary", async () => {
        const controller = new AbortController()
        const resolution = WebFetchSecurity.resolvePublicAddresses(
            new URL("https://example.com"),
            controller.signal,
            () => new Promise(() => {}),
        )
        controller.abort(new Error("dns timeout"))
        await expect(resolution).rejects.toThrow("dns timeout")
    })

    test("pins the connection to the validated IP while preserving Host and TLS SNI", async () => {
        let requestedUrl: URL | undefined
        let requestedInit: any
        const response = await WebFetchSecurity.fetchPinned(
            new URL("https://example.com:8443/path?q=1"),
            { signal: AbortSignal.any([]), headers: { Accept: "text/plain" } },
            async () => [{ address: "93.184.216.34", family: 4 }],
            async (input, init) => {
                requestedUrl = new URL(input instanceof Request ? input.url : input)
                requestedInit = init
                return new Response("ok")
            },
        )

        expect(await response.text()).toBe("ok")
        expect(requestedUrl?.toString()).toBe("https://93.184.216.34:8443/path?q=1")
        expect(new Headers(requestedInit.headers).get("host")).toBe("example.com:8443")
        expect(requestedInit.tls.serverName).toBe("example.com")
        expect(requestedInit.keepalive).toBe(false)
    })

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

    test("rejects private network addresses", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                await expect(
                    webfetch.execute({ url: "http://127.0.0.1/private", format: "text" }, ctx),
                ).rejects.toThrow(/private IP/)
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
                            url: "https://93.184.216.34",
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
                            url: "https://93.184.216.34",
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

import { mock } from "bun:test"

describe("tool.webfetch integration", () => {
    test("fetch example.com as markdown", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()

                const originalFetch = global.fetch
                global.fetch = mock(async () => new Response("<html><body><h1>Example Domain</h1></body></html>", { status: 200 })) as any

                try {
                    const result = await webfetch.execute(
                        {
                            url: "https://93.184.216.34",
                            format: "markdown",
                        },
                        ctx,
                    )

                    expect(result.output).toContain("Example Domain")
                } finally {
                    global.fetch = originalFetch
                }
            },
        })
    })

    test("fetch example.com as text", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const originalFetch = global.fetch
                global.fetch = mock(async () => new Response("Example Domain", { status: 200 })) as any
                try {
                    const result = await webfetch.execute(
                        {
                            url: "https://93.184.216.34",
                            format: "text",
                        },
                        ctx,
                    )

                    expect(result.output).toContain("Example Domain")
                } finally {
                    global.fetch = originalFetch
                }
            },
        })
    })

    test("fetch example.com as html", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const originalFetch = global.fetch
                global.fetch = mock(async () => new Response("<html><body><h1>Example Domain</h1></body></html>", { status: 200 })) as any
                try {
                    const result = await webfetch.execute(
                        {
                            url: "https://93.184.216.34",
                            format: "html",
                        },
                        ctx,
                    )

                    expect(result.output).toContain("<html")
                    expect(result.output).toContain("Example Domain")
                } finally {
                    global.fetch = originalFetch
                }
            },
        })
    })

    test("handles 404 error", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const originalFetch = global.fetch
                global.fetch = mock(async () => new Response("Not Found", { status: 404 })) as any
                try {
                    await expect(
                        webfetch.execute(
                            {
                                url: "https://93.184.216.34/404",
                                format: "text",
                            },
                            ctx,
                        ),
                    ).rejects.toThrow(/404/)
                } finally {
                    global.fetch = originalFetch
                }
            },
        })
    })

    test("cancels response bodies on rejected status and content type", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const webfetch = await WebFetchTool.init()
                const originalFetch = global.fetch
                let cancellations = 0
                global.fetch = mock(async (_input: any, init?: RequestInit) => {
                    const status = new Headers(init?.headers).get("x-test-status") === "error" ? 500 : 200
                    return new Response(
                        new ReadableStream({
                            pull() {},
                            cancel() {
                                cancellations++
                            },
                        }),
                        { status, headers: { "content-type": status === 200 ? "application/octet-stream" : "text/plain" } },
                    )
                }) as any

                try {
                    await expect(
                        webfetch.execute({ url: "https://93.184.216.34/error", format: "text" }, {
                            ...ctx,
                            ask: async () => {},
                        }),
                    ).rejects.toThrow(/content type/)
                    expect(cancellations).toBe(1)

                    global.fetch = mock(async () =>
                        new Response(
                            new ReadableStream({
                                pull() {},
                                cancel() {
                                    cancellations++
                                },
                            }),
                            { status: 500, headers: { "content-type": "text/plain" } },
                        ),
                    ) as any
                    await expect(
                        webfetch.execute({ url: "https://93.184.216.34/error", format: "text" }, ctx),
                    ).rejects.toThrow(/500/)
                    expect(cancellations).toBe(2)
                } finally {
                    global.fetch = originalFetch
                }
            },
        })
    })
})
