import "../preload"
import { describe, expect, test, mock } from "bun:test"
import { BrowserTool } from "@/integrations/tool/browser"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Browser } from "@/integrations/browser"
import "./browser-e2e.fixture"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { validateURL } from "@/integrations/tool/browser/validation"
import { Session } from "@/core/session"
import type { Tool } from "@/integrations/tool/tool"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Identifier } from "@/core/id/id"

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
  test("condition-based input flows release held keys on failed evidence or abort", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const down = mock(async (_key: string) => {})
        const up = mock(async (_key: string) => {})
        let mode: "success" | "failure" | "abort" = "success"
        const abort = new AbortController()
        const page = {
          keyboard: { down, up },
          evaluate: async () => {
            if (mode === "failure") throw new Error("evaluate: Error: Target not reached")
            if (mode === "abort") abort.abort(new Error("Stopped"))
            return "reached"
          },
          title: async () => "Game",
          url: () => "http://example.com/",
        }
        const originalPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        const originalFocus = Browser.captureFocusRestorer
        Browser.getPage = mock(async () => page as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        Browser.captureFocusRestorer = mock(async () => undefined)
        const steps = [
          { action: "key_down", key: "ArrowRight" },
          { action: "evaluate", script: "await observable goal" },
          { action: "key_up", key: "ArrowRight" },
        ] as const
        try {
          await tool.execute({ action: "flow", steps: [...steps] }, ctx)
          expect(up.mock.calls).toEqual([["ArrowRight"]])
          up.mockClear()
          // A successful hold can intentionally continue into the next tool call.
          await tool.execute({ action: "flow", steps: [steps[0]] }, ctx)
          expect(up).not.toHaveBeenCalled()
          mode = "failure"
          const failed = await tool.execute({ action: "flow", steps: [...steps] }, ctx)
          expect(failed.metadata.status).toBe("failed")
          expect(up.mock.calls).toEqual([["ArrowRight"]])
          up.mockClear()
          mode = "abort"
          await expect(
            tool.execute({ action: "flow", steps: [...steps] }, { ...ctx, abort: abort.signal }),
          ).rejects.toThrow()
          expect(up.mock.calls).toEqual([["ArrowRight"]])
        } finally {
          Browser.getPage = originalPage
          Browser.isPlaywrightAvailable = originalAvailable
          Browser.captureFocusRestorer = originalFocus
        }
      },
    })
  })

  test.each(["failure", "abort"] as const)("flow %s releases nested sequence and pointer holds", async (mode) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const keyUp = mock(async (_key: string) => {})
        const mouseUp = mock(async (_options: unknown) => {})
        let abort = new AbortController()
        const page = {
          keyboard: { down: async () => {}, up: keyUp },
          mouse: { down: async () => {}, up: mouseUp },
          evaluate: async () => {
            if (mode === "failure") throw new Error("evaluate: Error: Target not reached")
            abort.abort(new Error("Stopped at the final step"))
            return "reached"
          },
          title: async () => "Game",
          url: () => "http://example.com/",
        }
        const originalPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        const originalFocus = Browser.captureFocusRestorer
        Browser.getPage = mock(async () => page as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        Browser.captureFocusRestorer = mock(async () => undefined)
        try {
          for (const hold of [
            { action: "mouse", mouseAction: "down", button: "right" },
            {
              action: "input_sequence",
              sequence: [
                { type: "key_down", key: "ArrowRight" },
                { type: "mouse_down", button: "right" },
              ],
              releaseAtEnd: false,
            },
          ] as const) {
            keyUp.mockClear()
            mouseUp.mockClear()
            abort = new AbortController()
            await tool.execute({ action: "flow", steps: [hold] }, ctx)
            expect(keyUp).not.toHaveBeenCalled()
            expect(mouseUp).not.toHaveBeenCalled()
            const execution = tool.execute(
              { action: "flow", steps: [hold, { action: "evaluate", script: "observe goal" }] },
              { ...ctx, abort: abort.signal },
            )
            if (mode === "abort") await expect(execution).rejects.toThrow("aborted")
            else expect((await execution).metadata.status).toBe("failed")
            expect(mouseUp.mock.calls).toEqual([[{ button: "right" }]])
            expect(keyUp.mock.calls).toEqual(hold.action === "input_sequence" ? [["ArrowRight"]] : [])
          }
        } finally {
          Browser.getPage = originalPage
          Browser.isPlaywrightAvailable = originalAvailable
          Browser.captureFocusRestorer = originalFocus
        }
      },
    })
  })

  test.each([
    ["assert", "", false],
    ["evaluate", "evaluate: Error: Resize failed", false],
    ["click", "click: Error: strict mode violation: locator resolved to 3 elements", false],
    ["evaluate", "evaluate: Target page, context or browser has been closed", true],
    ["not-a-browser-action", "Invalid option", false],
    ["missing-action", "Invalid option", false],
    ["malformed-text", "Invalid input", false],
    ["missing-type-target", "An element target is required for type", false],
    ["type", "text is required for type", false],
    ["drag", "destination is required for drag", false],
    ["missing-pointer-coordinates", "x and y are required for viewport coordinates", false],
    [
      "click",
      "click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByTestId('win-calc')\n  - attempting click action\n  - another window intercepts pointer events",
      false,
    ],
    [
      "click",
      "click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#send')\n  - performing click action\n  - waiting for scheduled navigations to finish",
      true,
    ],
    [
      "click",
      "click: Timeout 30000ms exceeded.\nCall log:\n\u001b[2m - waiting for locator('#tasks .task')\u001b[22m\n\u001b[2m - performing click action\u001b[22m\n\u001b[2m - <kbd>A</kbd> intercepts pointer events\u001b[22m\n\u001b[2m - retrying click action\u001b[22m\n\u001b[2m - waiting 500ms\u001b[22m",
      false,
    ],
    [
      "click",
      "click: Timeout 30000ms exceeded.\nCall log:\n - waiting for locator('#tasks .task')\n - performing click action\n - overlay intercepts pointer events\n - retrying click action\n - performing click action",
      true,
    ],
    [
      "click",
      "click: Timeout 30000ms exceeded.\nCall log:\n - waiting for locator('#tasks .task')\n - performing click action\n - overlay intercepts pointer events\n - retrying click action\n - performing click action\n - action done\n - waiting for scheduled navigations to finish",
      true,
    ],
  ])("flow %s failure preserves known effects without inventing proof: %s", async (action, failure, uncertain) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        const tool = await BrowserTool.init()
        const originalPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        const originalFocus = Browser.captureFocusRestorer
        Browser.captureFocusRestorer = mock(async () => undefined)
        let clicks = 0
        Browser.getPage = mock(
          async () =>
            ({
              locator: (selector: string) => ({
                click: async () => {
                  if (selector === "#bad") throw new Error(failure)
                  clicks++
                },
                isVisible: async () => false,
              }),
              evaluate: async () => {
                throw new Error(failure)
              },
            }) as any,
        )
        Browser.isPlaywrightAvailable = mock(async () => true)
        const args = {
          action: "flow",
          steps: [
            { action: "click", selector: "#start" },
            {
              ...(action === "missing-action"
                ? {}
                : {
                    action:
                      action === "missing-type-target"
                        ? "type"
                        : action === "malformed-text"
                          ? "click"
                          : action === "missing-pointer-coordinates"
                            ? "input_sequence"
                            : action,
                  }),
              ...(action === "malformed-text" ? { text: 123 } : {}),
              ...(action === "missing-type-target" ? { text: "message" } : {}),
              ...(action === "missing-pointer-coordinates"
                ? {
                    sequence: [
                      { type: "mouse_move", x: 450, y: 300 },
                      { type: "mouse_click", button: "left" },
                    ],
                  }
                : action === "missing-type-target"
                  ? {}
                  : { selector: "#bad" }),
              assertion: "visible",
              script: "throw Error('Resize failed')",
            },
          ],
        }
        try {
          const attempt = ToolRuntime.execute({
            tool: "browser",
            args,
            context: { ...ctx, sessionID: session.id, messageID, callID: "flow-failure", extra: { execution } },
            effects: tool.effects as (args: any) => Tool.ToolEffects,
            mutating: tool.mutating as (args: any) => boolean,
            execute: (args, context) => tool.execute(args as any, context),
          })
          const schemaFailure = [
            "not-a-browser-action",
            "missing-action",
            "malformed-text",
            "missing-type-target",
            "type",
            "drag",
            "missing-pointer-coordinates",
          ].includes(action)
          if (uncertain || schemaFailure) await expect(attempt).rejects.toThrow(failure)
          else {
            const result = await attempt
            expect(result.metadata.status).toBe("failed")
            expect(result.output).toContain("Clicked")
            expect(result.output).toContain("remain applied")
          }
          expect(clicks).toBe(schemaFailure ? 0 : 1)
          expect(ExecutionRuntime.view(execution.executionID)?.unknownWork).toHaveLength(uncertain ? 1 : 0)
          expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.browserVerificationCalls ?? 0).toBe(0)
        } finally {
          Browser.getPage = originalPage
          Browser.isPlaywrightAvailable = originalAvailable
          Browser.captureFocusRestorer = originalFocus
        }
      },
    })
  })
  test("assertion parameters preflight every flow step before browser access", async () => {
    const originalAvailable = Browser.isPlaywrightAvailable
    const available = (Browser.isPlaywrightAvailable = mock(async () => true))
    const originalPage = Browser.getPage
    const getPage = (Browser.getPage = mock(async () => {
      throw new Error("Browser must not be accessed")
    }))
    const originalFocus = Browser.captureFocusRestorer
    const focus = (Browser.captureFocusRestorer = mock(async () => undefined))
    const tool = await BrowserTool.init()
    try {
      for (const invalid of [
        { action: "assert", script: "true" },
        { action: "assert", assertion: "visible" },
        { action: "assert", assertion: "url" },
        { action: "assert", assertion: "text", selector: "#status" },
        { action: "assert", assertion: "value", selector: "#field" },
        { action: "assert", assertion: "count", selector: ".items" },
      ]) {
        await expect(
          tool.execute(
            {
              action: "flow",
              steps: [{ action: "click", selector: "#increment" }, invalid],
            } as any,
            ctx,
          ),
        ).rejects.toBeInstanceOf(ToolRuntime.NotAppliedError)
      }
      expect(available).not.toHaveBeenCalled()
      expect(getPage).not.toHaveBeenCalled()
      expect(focus).not.toHaveBeenCalled()
    } finally {
      Browser.isPlaywrightAvailable = originalAvailable
      Browser.getPage = originalPage
      Browser.captureFocusRestorer = originalFocus
    }
  })

  test("valid empty and zero assertion expectations pass schema preflight", async () => {
    const { BrowserParameters } = await import("@/integrations/tool/browser/schema")
    expect(BrowserParameters.parse({ action: "assert", assertion: "url", expected: "" }).expected).toBe("")
    expect(
      BrowserParameters.parse({ action: "assert", assertion: "count", selector: ".missing", expectedCount: 0 })
        .expectedCount,
    ).toBe(0)
    expect(
      BrowserParameters.parse({ action: "assert", assertion: "text", selector: "#status", expected: "" }).expected,
    ).toBe("")
  })

  test("runtime assertion failure preserves earlier flow effects and releases held input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const up = mock(async (_key: string) => {})
        const page = {
          keyboard: { down: async () => {}, up },
          locator: () => ({ isVisible: async () => false }),
          title: async () => "Page",
          url: () => "http://example.com/",
        }
        const originalPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        const originalFocus = Browser.captureFocusRestorer
        Browser.getPage = mock(async () => page as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        Browser.captureFocusRestorer = mock(async () => undefined)
        try {
          const result = await tool.execute(
            {
              action: "flow",
              steps: [
                { action: "key_down", key: "ArrowRight" },
                { action: "assert", assertion: "visible", selector: "#status" },
              ],
            },
            ctx,
          )
          expect(result.metadata.status).toBe("failed")
          expect(result.metadata.steps).toHaveLength(2)
          expect(up.mock.calls).toEqual([["ArrowRight"]])
        } finally {
          Browser.getPage = originalPage
          Browser.isPlaywrightAvailable = originalAvailable
          Browser.captureFocusRestorer = originalFocus
        }
      },
    })
  })

  test("invalid URL preflight is not applied and preserves the HTTP-only boundary", () => {
    for (const url of [undefined, "not a URL", "file:///tmp/fixture.html"]) {
      try {
        validateURL(url)
        throw new Error("Unexpected accepted URL")
      } catch (error) {
        expect(error).toBeInstanceOf(ToolRuntime.NotAppliedError)
      }
    }
    expect(validateURL("http://127.0.0.1:8765/").protocol).toBe("http:")
  })
  test("classifies inspection actions as read-only", async () => {
    const tool = await BrowserTool.init()
    const mutating = tool.mutating as (params: any) => boolean
    const effects = tool.effects as (params: any) => Tool.ToolEffects
    expect(effects({ action: "navigate" })).toMatchObject({ workspace: "none", external: "none" })
    expect(effects({ action: "flow", steps: [{ action: "navigate" }, { action: "assert" }] }).workspace).toBe("none")
    expect(effects({ action: "screenshot", save: false }).workspace).toBe("none")
    for (const action of ["screenshot", "trace_stop", "download"]) {
      expect(effects({ action }).workspace).toBe("write")
      expect(effects({ action: "flow", steps: [{ action }] }).workspace).toBe("write")
    }
    expect(mutating({ action: "snapshot" })).toBe(false)
    expect(mutating({ action: "assert" })).toBe(false)
    expect(mutating({ action: "click" })).toBe(true)
    expect(mutating({ action: "screenshot" })).toBe(true)
    expect(mutating({ action: "screenshot", save: false })).toBe(false)
  })

  test("owned children cannot save browser artifacts directly or through flows", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const child = await Session.create({})
        await Session.update(child.id, (draft) => {
          draft.metadata = { workflowOwnership: { root: tmp.path, owns: ["index.html"] } }
        })
        const tool = await BrowserTool.init()
        for (const action of ["screenshot", "trace_stop", "download"] as const) {
          const operation = action === "download" ? { action, selector: "#download" } : { action }
          for (const args of [operation, { action: "flow", steps: [operation] }]) {
            await expect(tool.execute(args as any, { ...ctx, sessionID: child.id })).rejects.toThrow(
              "browser cannot enforce file ownership",
            )
          }
        }
      },
    })
  })

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
        const down = mock(async () => {})
        const up = mock(async () => {})
        const mockPage = {
          mouse: { down, up },
          evaluate: mock(async () => {
            throw new Error("evaluate: TypeError: deliberate assertion failure")
          }),
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
          await tool.execute({ action: "mouse", mouseAction: "down" }, ctx)
          await tool.execute({ action: "mouse", mouseAction: "up" }, ctx)
          expect(down).toHaveBeenCalledTimes(1)
          expect(up).toHaveBeenCalledTimes(1)
          const failed = await tool.execute(
            { action: "evaluate", script: "throw TypeError('deliberate assertion failure')" },
            ctx,
          )
          expect(failed.metadata.status).toBe("failed")
        } finally {
          Browser.getPage = originalGetPage
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })

  test("marks locator wait timeouts as not applied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const click = mock(async () => {
          throw new Error(
            "click: Timeout 120000ms exceeded.\nCall log:\n  - waiting for locator('[data-atomcli-ref=\"e12\"]')",
          )
        })
        const mockPage = {
          locator: mock(() => ({ click })),
          title: mock(async () => "Drive"),
          url: mock(() => "https://drive.google.com/drive/folders/example"),
        }
        const originalGetPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        Browser.getPage = mock(async () => mockPage as any)
        Browser.isPlaywrightAvailable = mock(async () => true)
        try {
          await expect(tool.execute({ action: "click", ref: "e12" }, ctx)).rejects.toBeInstanceOf(
            ToolRuntime.NotAppliedError,
          )
        } finally {
          Browser.getPage = originalGetPage
          Browser.isPlaywrightAvailable = originalAvailable
        }
      },
    })
  })
  test("refused navigation is not applied; a partially applied flow stays uncertain", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const failure = new Error("goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8765/")
        const originalGetPage = Browser.getPage
        const originalAvailable = Browser.isPlaywrightAvailable
        const click = mock(async () => {})
        Browser.getPage = mock(
          async () =>
            ({
              goto: async () => {
                throw failure
              },
              locator: () => ({ click }),
            }) as any,
        )
        Browser.isPlaywrightAvailable = mock(async () => true)
        try {
          await expect(tool.execute({ action: "navigate", url: "http://127.0.0.1:8765/" }, ctx)).rejects.toBeInstanceOf(
            ToolRuntime.NotAppliedError,
          )
          try {
            await tool.execute(
              {
                action: "flow",
                steps: [
                  { action: "click", selector: "#send" },
                  { action: "navigate", url: "http://127.0.0.1:8765/" },
                ],
              },
              ctx,
            )
            throw new Error("Flow unexpectedly passed")
          } catch (error) {
            expect(error).not.toBeInstanceOf(ToolRuntime.NotAppliedError)
            expect(String(error)).toContain("ERR_CONNECTION_REFUSED")
          }
          expect(click).toHaveBeenCalledTimes(1)
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
        const filter = mock((_options: { hasText: string | RegExp }) => ({ waitFor }))
        const selectedPage = {
          locator: mock(() => ({ waitFor, filter })),
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
          await tool.execute({ action: "wait", selector: "#ready", text: "Done (1).", exact: true }, ctx)
          const pattern = filter.mock.calls[0][0].hasText as RegExp
          expect(pattern.test("Done (1).")).toBe(true)
          expect(pattern.test("Done 1x")).toBe(false)
          expect(pattern.test("Almost Done (1).")).toBe(false)

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

          const explicitFill = await tool.execute({ action: "fill", selector: "#name", text: "Grace", delay: 25 }, ctx)
          expect(fill).toHaveBeenLastCalledWith("Grace", expect.objectContaining({ signal: ctx.abort }))
          expect(explicitFill.metadata?.inputMode).toBe("fill")
          expect(pressSequentially).not.toHaveBeenCalled()
          expect(tool.parameters.safeParse({ action: "fill", text: "No target" }).success).toBe(false)
          expect(tool.parameters.safeParse({ action: "fill", selector: "#name" }).success).toBe(false)

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
