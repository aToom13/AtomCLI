import "../preload"
import { describe, expect, test, mock } from "bun:test"
import { BrowserTool } from "@/integrations/tool/browser"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Browser } from "@/integrations/browser"
import "./browser-e2e.fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
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
        Browser.getPage = mock(async () => ({}) as any)

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
            expect((e as Error).message).toContain("element target is required")
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
        const click = mock(async () => {})
        const mockPage = {
          goto: mock(async () => {}),
          locator: mock(() => ({ click })),
          title: mock(async () => "Mock Page"),
          url: mock(() => "http://mock.com"),
        }

        const originalGetPage = Browser.getPage
        Browser.getPage = mock(async () => mockPage as any)

        const originalAvailable = Browser.isPlaywrightAvailable
        Browser.isPlaywrightAvailable = mock(async () => true)

        try {
          await tool.execute({ action: "navigate", url: "http://example.com" }, ctx)
          expect(mockPage.goto).toHaveBeenCalled()

          await tool.execute({ action: "click", selector: "#btn" }, ctx)
          expect(click).toHaveBeenCalled()

          await tool.execute({ action: "click", ref: "e7" }, ctx)
          expect(mockPage.locator).toHaveBeenLastCalledWith('[data-atomcli-ref="e7"]')
        } finally {
          Browser.getPage = originalGetPage
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })
  test("reports install hint when playwright is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()

        const originalAvailable = Browser.isPlaywrightAvailable
        const originalHint = Browser.getInstallHint
        Browser.isPlaywrightAvailable = mock(async () => false)
        Browser.getInstallHint = mock(() => "bun add -g playwright && bunx playwright install chromium")

        try {
          const result = await tool.execute({ action: "navigate", url: "http://example.com" } as any, ctx)
          expect(result.title).toContain("Not Available")
          expect(result.output).toContain("bun add -g playwright")
        } finally {
          Browser.isPlaywrightAvailable = originalAvailable
          Browser.getInstallHint = originalHint
        }
      },
    })
  })

  test("keeps console and network utility reads permissionless", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const noPermissionCtx = {
          ...ctx,
          ask: async () => {
            throw new Error("permission should not be requested")
          },
        }
        await expect(tool.execute({ action: "console_logs" }, noPermissionCtx)).resolves.toBeDefined()
        await expect(tool.execute({ action: "network" }, noPermissionCtx)).resolves.toBeDefined()
      },
    })
  })

  test("returns a concise semantic page snapshot", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const frame = {
          evaluate: mock(async () => ({
            headings: [{ level: "h1", text: "Dashboard" }],
            interactive: [{ type: "button", label: "Save", ref: "e1", inViewport: true }],
            text: "Welcome to the dashboard",
          })),
          url: mock(() => "http://example.com/dashboard"),
        }
        const mockPage = {
          frames: mock(() => [frame]),
          mainFrame: mock(() => frame),
          title: mock(async () => "Dashboard"),
          url: mock(() => "http://example.com/dashboard"),
        }
        const originalGetPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        Browser.getPage = mock(async () => mockPage as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        try {
          const result = await tool.execute({ action: "snapshot" }, ctx)
          expect(result.output).toContain("h1: Dashboard")
          expect(result.output).toContain('[ref=e1] button "Save"')
          expect(result.metadata?.elementCount).toBe(1)
        } finally {
          Browser.getPage = originalGetPage
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })

  test("waits for selectors and can list or switch tabs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const waitFor = mock(async () => {})
        const selectedPage = {
          locator: mock(() => ({ waitFor })),
          title: mock(async () => "Second tab"),
          url: mock(() => "http://example.com/two"),
        }
        const originalGetPage = Browser.getPage
        const originalSelectTab = Browser.selectTab
        const originalGetTabs = Browser.getTabs
        const originalAvailable = Browser.isPlaywrightAvailable
        Browser.getPage = mock(async () => selectedPage as any)
        Browser.selectTab = mock(async () => selectedPage as any)
        Browser.getTabs = mock(async () => [
          { index: 0, id: "tab-1", title: "First", url: "http://example.com/one", active: true },
          { index: 1, id: "tab-2", title: "Second", url: "http://example.com/two", active: false },
        ])
        Browser.isPlaywrightAvailable = mock(async () => true)
        try {
          await tool.execute({ action: "wait", selector: "#ready", timeout: 1_000 }, ctx)
          expect(waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 1_000, signal: ctx.abort })

          const tabs = await tool.execute({ action: "tabs" }, ctx)
          expect(tabs.output).toContain("→ [tab-1] [0] First")
          expect(tabs.metadata?.count).toBe(2)

          const switched = await tool.execute({ action: "switch_tab", tabIndex: 1 }, ctx)
          expect(Browser.selectTab).toHaveBeenCalledWith(1)
          expect(switched.output).toContain("Switched to tab-")
        } finally {
          Browser.getPage = originalGetPage
          Browser.selectTab = originalSelectTab
          Browser.getTabs = originalGetTabs
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })

  test("fills text atomically, supports sequential typing, and awaits async JavaScript", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const fill = mock(async () => {})
        const pressSequentially = mock(async () => {})
        const mockPage = {
          locator: mock(() => ({ fill, pressSequentially })),
          evaluate: mock(async (fn: (args: any) => unknown, args: any) => await fn(args)),
          title: mock(async () => "Macro page"),
          url: mock(() => "http://example.com/macro"),
        }
        const originalGetPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        Browser.getPage = mock(async () => mockPage as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        try {
          const filled = await tool.execute({ action: "type", selector: "#name", text: "Ada" }, ctx)
          expect(fill).toHaveBeenCalledWith("Ada", expect.objectContaining({ signal: ctx.abort }))
          expect(filled.metadata?.inputMode).toBe("fill")

          const typed = await tool.execute({ action: "type", selector: "#game", text: "wasd", delay: 25 }, ctx)
          expect(pressSequentially).toHaveBeenCalledWith(
            "wasd",
            expect.objectContaining({ delay: 25, signal: ctx.abort }),
          )
          expect(typed.metadata?.inputMode).toBe("sequential")

          const evaluated = await tool.execute(
            {
              action: "evaluate",
              script: `(async () => ({ macro: "ok", steps: 3 }))()`,
            },
            ctx,
          )
          expect(evaluated.output).toBe('{"macro":"ok","steps":3}')
        } finally {
          Browser.getPage = originalGetPage
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })
})
