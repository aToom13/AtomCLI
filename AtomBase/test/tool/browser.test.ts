import { describe, expect, test, mock } from "bun:test"
import { BrowserTool } from "../../src/tool/browser"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Browser } from "../../src/browser"

const ctx = {
    sessionID: "test",
    messageID: "",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => { },
    ask: async () => { },
}

describe("tool.browser integration", () => {
    test("tool definition is correct", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const tool = await BrowserTool.init()
                expect(tool.description).toBeDefined()
                expect(tool.parameters).toBeDefined()
            },
        })
    })

    test("validates missing parameters", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const tool = await BrowserTool.init()

                // Mock Browser.getPage to prevent actual browser launch
                const originalGetPage = Browser.getPage
                Browser.getPage = mock(async () => ({} as any))

                try {
                    // Navigate without URL
                    try {
                        await tool.execute({ action: "navigate" } as any, ctx)
                    } catch (e) {
                        expect((e as Error).message).toContain("URL is required")
                    }

                    // Click without selector
                    try {
                        await tool.execute({ action: "click" } as any, ctx)
                    } catch (e) {
                        expect((e as Error).message).toContain("Selector is required")
                    }
                } finally {
                    Browser.getPage = originalGetPage
                }
            },
        })
    })

    // Mocking Browser interactions to avoid launching real browser
    test("calls browser manager for actions", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const tool = await BrowserTool.init()

                // Mock Browser.getPage
                const mockPage = {
                    goto: mock(async () => { }),
                    click: mock(async () => { }),
                    title: mock(async () => "Mock Page"),
                    url: mock(() => "http://mock.com"),
                }

                const originalGetPage = Browser.getPage
                Browser.getPage = mock(async () => mockPage as any)

                try {
                    await tool.execute({ action: "navigate", url: "http://example.com" }, ctx)
                    expect(mockPage.goto).toHaveBeenCalled()

                    await tool.execute({ action: "click", selector: "#btn" }, ctx)
                    expect(mockPage.click).toHaveBeenCalled()
                } finally {
                    Browser.getPage = originalGetPage
                }
            },
        })
    })
})
