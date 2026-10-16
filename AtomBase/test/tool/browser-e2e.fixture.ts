import "../preload"
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Browser } from "@/integrations/browser"
import { BrowserTool } from "@/integrations/tool/browser"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

import { AgentEval } from "@/core/eval/harness"

import { Identifier } from "@/core/id/id"

import { Session } from "@/core/session"

import { SessionPrompt } from "@/core/session/prompt"

import { SessionProcessor } from "@/core/session/processor"

import { Provider } from "@/integrations/provider/provider"

import { ExecutionRuntime } from "@/core/execution/runtime"

import { ToolRuntime } from "@/integrations/tool/runtime"
import { ReviewV2 } from "@/core/verification/review-v2"

const enabled = process.env.ATOMCLI_BROWSER_E2E === "1"
let server: ReturnType<typeof Bun.serve> | undefined
let origin = ""
let testCacheHome: string | undefined

const mainPage = `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Browser fixture</title></head>
  <body>
    <h1>Account setup</h1>
    <label>Email <input name="email" placeholder="name@example.com" required></label>
    <label>Plan <select name="plan"><option value="free">Free</option><option value="pro">Pro</option></select></label>
    <label><input type="checkbox" name="subscribe"> Subscribe</label>
    <label>Upload <input type="file" name="upload"></label>
    <button id="save">Save</button>
    <button id="game-launch" style="display:grid" onclick="this.dataset.clicked='yes'"><span>&#128665;</span><span>Drift City</span></button>
    <button id="prompt">Prompt</button>
    <a href="/popup" target="_blank">Open popup</a>
    <a href="/download">Download report</a>
    <div id="status">Idle</div>
    <iframe src="/frame"></iframe>
    <div id="shadow-host"></div>
    <script>
      document.querySelector('#shadow-host').attachShadow({mode: 'open'}).innerHTML = '<button aria-label="Shadow action">Shadow button</button>'
      document.querySelector('#save').addEventListener('click', () => {
        document.querySelector('#status').textContent = 'Saved'
        console.log('account saved')
        fetch('/api').catch(() => {})
      })
      document.querySelector('#prompt').addEventListener('click', () => {
        document.querySelector('#status').textContent = prompt('Display name?', 'Ada') || 'dismissed'
      })
    </script>
  </body>
</html>`

const gamePage = `<!doctype html>
<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canvas game fixture</title></head>
  <body>
    <h1>Canvas game</h1>
    <canvas id="game" width="320" height="180" tabindex="0" style="box-sizing:border-box;width:320px;height:180px;border:1px solid black"></canvas>
    <output id="state"></output>
    <button id="reset">Reset</button>
    <script>
      const canvas = document.querySelector('#game')
      const context = canvas.getContext('2d')
      const keys = new Set()
      const state = window.gameState = { x: 20, y: 90, frames: 0, clicks: 0, lastClick: null, keys: [] }
      document.querySelector('#reset').addEventListener('click', () => {
        keys.clear()
        Object.assign(state, { x: 20, y: 90, clicks: 0, lastClick: null, keys: [] })
        draw()
      })
      addEventListener('keydown', event => { keys.add(event.key); state.keys = [...keys] })
      addEventListener('keyup', event => { keys.delete(event.key); state.keys = [...keys] })
      canvas.addEventListener('click', event => {
        const box = canvas.getBoundingClientRect()
        state.clicks++
        state.lastClick = {
          x: Math.round((event.clientX - box.left) * canvas.width / box.width),
          y: Math.round((event.clientY - box.top) * canvas.height / box.height)
        }
      })
      function draw() {
        context.fillStyle = '#101827'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#40e0d0'
        context.fillRect(state.x, state.y, 12, 12)
        document.querySelector('#state').textContent = JSON.stringify(state)
      }
      function frame() {
        if (keys.has('ArrowRight')) state.x += 4
        if (keys.has('ArrowLeft')) state.x -= 4
        if (keys.has('ArrowUp')) state.y -= 3
        if (keys.has('ArrowDown')) state.y += 3
        state.frames++
        draw()
        requestAnimationFrame(frame)
      }
      draw()
      requestAnimationFrame(frame)
    </script>
  </body>
</html>`

beforeAll(() => {
  if (!enabled) return
  // Playwright follows XDG_CACHE_HOME on Linux. The preload intentionally points
  // it at an empty test cache, while the browser installed by CI/developers is
  // in the platform-default cache. Browser application state remains isolated
  // because Global paths were initialized by preload before this hook.
  testCacheHome = process.env.XDG_CACHE_HOME
  delete process.env.XDG_CACHE_HOME
  Browser.resetPlaywrightCheck()
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/popup")
        return new Response("<title>Popup</title><h1>Popup page</h1>", { headers: { "content-type": "text/html" } })
      if (url.pathname === "/frame")
        return new Response("<button aria-label='Frame action'>Frame button</button>", {
          headers: { "content-type": "text/html" },
        })
      if (url.pathname === "/download") {
        return new Response("downloaded", {
          headers: { "content-disposition": 'attachment; filename="report.txt"', "content-type": "text/plain" },
        })
      }
      if (url.pathname === "/api") return Response.json({ ok: true })
      if (url.pathname === "/game") return new Response(gamePage, { headers: { "content-type": "text/html" } })
      return new Response(mainPage, { headers: { "content-type": "text/html" } })
    },
  })
  origin = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  if (!enabled) return
  await Browser.close()
  server?.stop(true)
  if (testCacheHome) process.env.XDG_CACHE_HOME = testCacheHome
})

describe("tool.browser real Chromium", () => {
  afterEach(async () => {
    if (enabled) await Browser.close()
  })

  test.skipIf(!enabled)("physical movement waits on a goal and failed evidence releases input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const ctx = {
          sessionID: "browser-observed-input-e2e",
          messageID: "observed-message",
          callID: "observed-call",
          agent: "build",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        }
        const result = await tool.execute(
          {
            action: "flow",
            steps: [
              { action: "navigate", url: `${origin}/game` },
              { action: "key_down", key: "ArrowRight" },
              {
                action: "evaluate",
                script:
                  "new Promise((resolve, reject) => { const end = performance.now() + 4000; function poll() { if (window.gameState.x >= 80) return resolve(window.gameState.x); if (performance.now() >= end) return reject(new Error('Movement target not reached')); setTimeout(poll, 16); } poll(); })",
              },
              { action: "key_up", key: "ArrowRight" },
            ],
          },
          ctx,
        )
        expect(result.metadata.status).not.toBe("failed")
        const page = await Browser.getPage()
        expect(await page.evaluate(() => (window as any).gameState.x)).toBeGreaterThanOrEqual(80)
        expect(await page.evaluate(() => (window as any).gameState.keys)).toEqual([])
        const failed = await tool.execute(
          {
            action: "flow",
            steps: [
              { action: "key_down", key: "ArrowRight" },
              { action: "evaluate", script: "Promise.reject(new Error('Goal not reached'))" },
              { action: "key_up", key: "ArrowRight" },
            ],
          },
          ctx,
        )
        expect(failed.metadata.status).toBe("failed")
        expect(await page.evaluate(() => (window as any).gameState.keys)).toEqual([])
        const stopped = await page.evaluate(() => (window as any).gameState.x)
        await page.waitForTimeout(100)
        expect(await page.evaluate(() => (window as any).gameState.x)).toBe(stopped)
      },
    })
  })

  test.skipIf(!enabled)("wait honors elapsed time, target text and cancellation", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BrowserTool.init()
        const ctx = {
          sessionID: "browser-wait-e2e",
          messageID: "wait-message",
          callID: "wait-call",
          agent: "build",
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        }
        await tool.execute({ action: "navigate", url: origin }, ctx)
        const flow = await tool.execute(
          {
            action: "flow",
            steps: [
              {
                action: "evaluate",
                script:
                  "window.waitStarted = performance.now(); document.querySelector('#status').textContent = 'pending'; setTimeout(() => document.querySelector('#status').textContent = 'expired (1).', 800)",
              },
              { action: "wait", duration: 1000 },
              {
                action: "evaluate",
                script:
                  "if (performance.now() - window.waitStarted < 1000) throw new Error('Duration ignored'); if (document.querySelector('#status').textContent !== 'expired (1).') throw new Error('Timer has not expired')",
              },
              {
                action: "evaluate",
                script:
                  "document.querySelector('#status').textContent = 'pending'; setTimeout(() => document.querySelector('#status').textContent = 'expired (1).', 250)",
              },
              { action: "wait", selector: "#status", text: "expired (1).", exact: true, timeout: 2000 },
              { action: "assert", selector: "#status", assertion: "text", expected: "expired (1).", exact: true },
              { action: "wait", duration: 10, selector: "#status", text: "expired (1).", exact: true },
            ],
          },
          ctx,
        )
        expect(flow.metadata.failed).not.toBe(true)
        expect(flow.output).toContain("Step 7: wait")
        const controller = new AbortController()
        const started = performance.now()
        const timer = setTimeout(() => controller.abort(new Error("wait cancelled")), 50)
        try {
          await expect(
            tool.execute({ action: "wait", duration: 3000 }, { ...ctx, abort: controller.signal }),
          ).rejects.toThrow("Browser action 'wait' was aborted")
          expect(performance.now() - started).toBeLessThan(2000)
        } finally {
          clearTimeout(timer)
        }
      },
    })
  })

  test.skipIf(!enabled)(
    "controls a complete local UI workflow",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Browser.close()
          const tool = await BrowserTool.init()
          const baseCtx = {
            sessionID: "browser-e2e",
            messageID: "message-e2e",
            callID: "call-e2e",
            agent: "build",
            abort: new AbortController().signal,
            metadata: () => {},
            ask: async () => {},
          }

          const navigation = await tool.execute({ action: "navigate", url: origin }, baseCtx)
          const mainTabId = navigation.metadata.tabId as string
          const snapshot = await tool.execute({ action: "snapshot" }, baseCtx)
          expect(snapshot.output).toContain("Account setup")
          expect(snapshot.output).toContain("Frame action")
          expect(snapshot.output).toContain("Shadow action")
          expect(snapshot.output).toContain("box=")
          expect(snapshot.metadata.frameCount).toBe(2)
          const clickPage = await Browser.getPage()
          expect(snapshot.output).toContain('button "🚙 Drift City"')
          await tool.execute({ action: "click", role: "button", accessibleName: "🚙 Drift City" }, baseCtx)
          expect(await clickPage.locator("#game-launch").getAttribute("data-clicked")).toBe("yes")
          await clickPage.evaluate(() => {
            const surface = document.createElement("canvas")
            surface.id = "pointer-surface"
            Object.assign(surface.style, {
              position: "fixed",
              left: "400px",
              top: "200px",
              width: "80px",
              height: "80px",
              zIndex: "2147483647",
            })
            surface.addEventListener("click", () => void surface.requestPointerLock())
            document.body.append(surface)
          })
          try {
            await clickPage.locator("#pointer-surface").click()
            await clickPage.waitForFunction(() => document.pointerLockElement !== null)
            const blocked = await tool.execute({ action: "click", selector: "#save", timeout: 1200 }, baseCtx)
            expect(blocked.metadata.status).toBe("failed")
            expect(blocked.output).toContain("intercepts pointer events")
            expect(blocked.output).toContain("performing click action")
            expect(await clickPage.locator("#status").textContent()).toBe("Idle")
          } finally {
            await clickPage.evaluate(() => document.exitPointerLock())
            await clickPage.waitForFunction(() => document.pointerLockElement === null)
            await clickPage.locator("#pointer-surface").evaluate((element) => element.remove())
          }
          await tool.execute(
            { action: "click", role: "button", accessibleName: "Frame action", frameUrl: "/frame" },
            baseCtx,
          )

          const flow = await tool.execute(
            {
              action: "flow",
              steps: [
                { action: "fill", label: "Email", text: "ada@example.com" },
                { action: "select_option", label: "Plan", optionValues: ["pro"] },
                { action: "check", label: "Subscribe" },
                { action: "click", role: "button", accessibleName: "Save", returnSnapshot: true },
                { action: "assert", targetText: "Saved", assertion: "visible" },
                { action: "assert", label: "Email", assertion: "value", expected: "ada@example.com", exact: true },
              ],
            },
            baseCtx,
          )
          expect(flow.output).toContain("Step 6: assert")
          await tool.execute({ action: "focus", label: "Email" }, baseCtx)
          const focused = await tool.execute({ action: "evaluate", script: "document.activeElement.name" }, baseCtx)
          expect(focused.output).toBe("email")
          await tool.execute({ action: "uncheck", label: "Subscribe" }, baseCtx)
          await tool.execute({ action: "assert", label: "Subscribe", assertion: "unchecked" }, baseCtx)

          const uploadPath = path.join(tmp.path, "upload.txt")
          await fs.writeFile(uploadPath, "upload")
          await tool.execute({ action: "set_files", label: "Upload", files: ["upload.txt"] }, baseCtx)
          const uploadName = await tool.execute(
            { action: "evaluate", script: `document.querySelector('[name=upload]').files[0].name` },
            baseCtx,
          )
          expect(uploadName.output).toBe("upload.txt")

          await tool.execute({ action: "dialog", dialogAction: "accept", promptText: "Grace" }, baseCtx)
          await tool.execute({ action: "click", role: "button", accessibleName: "Prompt" }, baseCtx)
          const dialog = await tool.execute({ action: "dialog", since: 0 }, baseCtx)
          expect(dialog.output).toContain("accepted")
          expect(dialog.output).toContain("Cursor:")
          await tool.execute({ action: "assert", targetText: "Grace", assertion: "visible" }, baseCtx)

          const download = await tool.execute({ action: "download", targetText: "Download report" }, baseCtx)
          expect(await Bun.file(download.metadata.downloadPath as string).text()).toBe("downloaded")

          const popup = await tool.execute(
            { action: "click", role: "link", accessibleName: "Open popup", expectPopup: true },
            baseCtx,
          )
          const popupId = popup.metadata.tabId as string
          expect(popupId).toMatch(/^tab-\d+$/)
          const tabs = await tool.execute({ action: "tabs" }, baseCtx)
          expect(tabs.output).toContain(popupId)
          await tool.execute({ action: "close_tab", tabId: popupId }, baseCtx)
          const newTab = await tool.execute({ action: "new_tab", url: `${origin}/popup` }, baseCtx)
          expect(newTab.metadata.tabId).toMatch(/^tab-\d+$/)
          await tool.execute({ action: "close_tab", tabId: newTab.metadata.tabId as string }, baseCtx)

          const screenshot = await tool.execute({ action: "screenshot", selector: "body", name: "fixture" }, baseCtx)
          expect(screenshot.attachments?.[0]?.mime).toBe("image/png")
          expect(await Bun.file(screenshot.metadata.screenshotPath as string).exists()).toBe(true)
          const attachmentOnly = await tool.execute(
            { action: "screenshot", selector: "body", name: "attachment-only", save: false },
            baseCtx,
          )
          expect(attachmentOnly.attachments?.[0]?.mime).toBe("image/png")
          expect(attachmentOnly.metadata.screenshotPath).toBeUndefined()

          await tool.execute({ action: "trace_start", name: "fixture" }, baseCtx)
          await tool.execute({ action: "click", role: "button", accessibleName: "Save" }, baseCtx)
          const trace = await tool.execute({ action: "trace_stop", name: "fixture" }, baseCtx)
          expect(await Bun.file(trace.metadata.tracePath as string).exists()).toBe(true)

          const preservedTab = await tool.execute({ action: "new_tab", url: `${origin}/popup` }, baseCtx)
          const preservedTabId = preservedTab.metadata.tabId as string
          await tool.execute({ action: "switch_tab", tabId: mainTabId }, baseCtx)

          await tool.execute(
            {
              action: "emulate",
              width: 777,
              height: 555,
              locale: "tr-TR",
              timezoneId: "Europe/Istanbul",
              colorScheme: "dark",
              latitude: 41.0082,
              longitude: 28.9784,
            },
            baseCtx,
          )
          const emulation = await tool.execute(
            {
              action: "evaluate",
              script: `({width: innerWidth, language: navigator.language, dark: matchMedia('(prefers-color-scheme: dark)').matches, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone})`,
            },
            baseCtx,
          )
          expect(JSON.parse(emulation.output)).toEqual({
            width: 777,
            language: "tr-TR",
            dark: true,
            timezone: "Europe/Istanbul",
          })
          const emulatedTabs = await tool.execute({ action: "tabs" }, baseCtx)
          expect(emulatedTabs.output).toContain(mainTabId)
          expect(emulatedTabs.output).toContain(preservedTabId)
          expect(emulatedTabs.metadata.tabId).toBe(mainTabId)
          const geolocation = await tool.execute(
            {
              action: "evaluate",
              script: `new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => resolve([position.coords.latitude, position.coords.longitude]), reject))`,
            },
            baseCtx,
          )
          expect(JSON.parse(geolocation.output)).toEqual([41.0082, 28.9784])

          await tool.execute({ action: "emulate", reset: true, device: "Pixel 5" }, baseCtx)
          const device = await tool.execute(
            { action: "evaluate", script: `({width: innerWidth, touch: navigator.maxTouchPoints > 0})` },
            baseCtx,
          )
          expect(JSON.parse(device.output)).toEqual({ width: 393, touch: true })
          await tool.execute({ action: "emulate", reset: true }, baseCtx)
          const resetTabs = await tool.execute({ action: "tabs" }, baseCtx)
          expect(resetTabs.output).toContain(mainTabId)
          expect(resetTabs.output).toContain(preservedTabId)
          await tool.execute({ action: "close_tab", tabId: preservedTabId }, baseCtx)
          await tool.execute({ action: "switch_tab", tabId: mainTabId }, baseCtx)

          await tool.execute(
            {
              action: "cookies",
              cookieOperation: "set",
              cookies: [{ name: "fixture", value: "yes", url: origin }],
            },
            baseCtx,
          )
          const cookies = await tool.execute({ action: "cookies", cookieOperation: "list", urls: [origin] }, baseCtx)
          expect(cookies.output).toContain('"fixture"')
          expect(cookies.output).toContain("[REDACTED]")
          expect(cookies.output).not.toContain('"value": "yes"')
          const cookieValues = await tool.execute(
            { action: "cookies", cookieOperation: "list", urls: [origin], includeValues: true },
            baseCtx,
          )
          expect(cookieValues.output).toContain('"value": "yes"')
          const storage = await tool.execute({ action: "storage" }, baseCtx)
          expect(storage.metadata.cookieCount).toBeGreaterThan(0)
          expect(storage.output).toContain("[REDACTED]")
          await tool.execute({ action: "storage", storageOperation: "clear" }, baseCtx)

          await tool.execute({ action: "snapshot" }, baseCtx)
          await tool.execute({ action: "evaluate", script: `document.querySelector('#save').disabled = true` }, baseCtx)
          const diff = await tool.execute({ action: "snapshot_diff" }, baseCtx)
          expect(diff.metadata.added).toBeGreaterThan(0)
          expect(diff.metadata.removed).toBeGreaterThan(0)

          const consoleCursor = await tool.execute({ action: "console_logs", cursorOnly: true }, baseCtx)
          await tool.execute({ action: "evaluate", script: `console.log('cursor checkpoint')` }, baseCtx)
          const consoleEvents = await tool.execute(
            { action: "console_logs", since: consoleCursor.metadata.cursor as number },
            baseCtx,
          )
          expect(consoleEvents.output).toContain("cursor checkpoint")
          expect(consoleEvents.output).toContain("Cursor:")
          const networkCursor = await tool.execute({ action: "network", cursorOnly: true }, baseCtx)
          await tool.execute({ action: "evaluate", script: `fetch('/api').then(response => response.json())` }, baseCtx)
          const networkEvents = await tool.execute(
            { action: "network", since: networkCursor.metadata.cursor as number, resourceType: "fetch" },
            baseCtx,
          )
          expect(networkEvents.output).toContain("/api")
          expect(networkEvents.output).toContain("Cursor:")

          await tool.execute({ action: "emulate", offline: true }, baseCtx)
          const offline = await tool.execute({ action: "evaluate", script: "navigator.onLine" }, baseCtx)
          expect(offline.output).toBe("false")
          await tool.execute({ action: "emulate", reset: true }, baseCtx)

          const page = await Browser.getPage()
          const pauseAt = page.clock.pauseAt.bind(page.clock)
          let delayedPause = false
          const pause = spyOn(page.clock, "pauseAt").mockImplementation(async (time) => {
            if (!delayedPause) {
              delayedPause = true
              await Bun.sleep(50)
            }
            await pauseAt(time)
          })
          let gameSetup
          try {
            gameSetup = await tool.execute(
              {
                action: "flow",
                steps: [
                  { action: "clock", clockOperation: "install" },
                  { action: "navigate", url: `${origin}/game` },
                  { action: "clock", clockOperation: "pause" },
                ],
              },
              baseCtx,
            )
            expect(pause).toHaveBeenCalledTimes(2)
            const pausedTime = await page.evaluate(() => Date.now())
            await Bun.sleep(50)
            expect(await page.evaluate(() => Date.now())).toBe(pausedTime)
          } finally {
            pause.mockRestore()
          }
          expect(gameSetup.output).toContain("Step 3: clock")
          const gameBox = await tool.execute({ action: "box", selector: "#game" }, baseCtx)
          expect((gameBox.metadata.box as { width: number }).width).toBe(320)

          await tool.execute(
            {
              action: "mouse",
              mouseAction: "click",
              selector: "#game",
              coordinateMode: "normalized",
              x: 0.25,
              y: 0.5,
            },
            baseCtx,
          )
          await tool.execute({ action: "key_down", key: "ArrowRight", selector: "#game" }, baseCtx)
          await tool.execute({ action: "clock", clockOperation: "run_for", duration: 64 }, baseCtx)
          await tool.execute({ action: "key_up", key: "ArrowRight" }, baseCtx)

          const gameSequence = await tool.execute(
            {
              action: "input_sequence",
              selector: "#game",
              coordinateMode: "element",
              sequence: [
                { type: "key_down", key: "ArrowRight" },
                { type: "key_down", key: "ArrowUp" },
                { type: "advance", duration: 160 },
                { type: "capture", name: "game-moving" },
                { type: "key_up", key: "ArrowUp" },
                { type: "key_up", key: "ArrowRight" },
                { type: "mouse_click", x: 100, y: 50 },
                { type: "capture", name: "game-clicked" },
              ],
            },
            baseCtx,
          )
          expect(gameSequence.attachments).toHaveLength(2)
          expect(gameSequence.metadata.captureCount).toBe(2)
          const gameState = await tool.execute({ action: "evaluate", script: `window.gameState` }, baseCtx)
          const parsedGameState = JSON.parse(gameState.output)
          expect(parsedGameState).toMatchObject({ clicks: 2, keys: [] })
          expect(Math.abs(parsedGameState.lastClick.x - 100)).toBeLessThanOrEqual(1)
          expect(Math.abs(parsedGameState.lastClick.y - 50)).toBeLessThanOrEqual(1)
          expect(parsedGameState.x).toBeGreaterThan(20)
          expect(parsedGameState.y).toBeLessThan(90)

          await tool.execute(
            {
              action: "input_sequence",
              sequence: [
                { type: "key_down", key: "ArrowLeft" },
                { type: "advance", duration: 16 },
              ],
            },
            baseCtx,
          )
          const releasedKeys = await tool.execute({ action: "evaluate", script: `window.gameState.keys` }, baseCtx)
          expect(JSON.parse(releasedKeys.output)).toEqual([])
          await tool.execute({ action: "click", selector: "#reset" }, baseCtx)
          const resetState = await tool.execute(
            { action: "evaluate", script: `({ reset: window.gameState.x === 20 && window.gameState.y === 90 })` },
            baseCtx,
          )
          expect(JSON.parse(resetState.output).reset).toBe(true)
          await tool.execute({ action: "clock", clockOperation: "fast_forward", duration: 10 }, baseCtx)
          await tool.execute({ action: "clock", clockOperation: "resume" }, baseCtx)

          const controller = new AbortController()
          setTimeout(() => controller.abort(), 50)
          await expect(
            tool.execute(
              { action: "wait", selector: "#never-exists", timeout: 30_000 },
              { ...baseCtx, abort: controller.signal },
            ),
          ).rejects.toThrow("was aborted")
        },
      })
    },
    120_000,
  )
})

for (const chromium of [false, true])
  (chromium && process.env.ATOMCLI_BROWSER_E2E !== "1" ? test.skip : test)(
    `a message during ${chromium ? "Chromium navigation" : "running browser work"} settles and continues the same execution`,
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ title: "Streaming amendment test" })
          const provider = (await Provider.getProvider("atomcli"))!
          const model = Object.values(provider.models).find(
            (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
          )!
          const user = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            agent: "agent",
            model: { providerID: model.providerID, modelID: model.id },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: "Selam",
          })
          const executions: string[] = []
          const users: string[] = []
          const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({
            allowAuxiliarySummaries: false,
          } as never)
          const processor = spyOn(SessionProcessor, "create").mockImplementation(
            (input) =>
              ({
                message: input.assistantMessage,
                partFromToolCall: () => undefined,
                async process(stream) {
                  executions.push(stream.execution.executionID)
                  users.push(stream.user.id)
                  if (executions.length === 1) {
                    let release: () => void
                    let began: () => void
                    const started = new Promise<void>((resolve) => {
                      began = resolve
                    })
                    const pending = new Promise<void>((resolve) => {
                      release = resolve
                    })
                    const server = chromium
                      ? Bun.serve({
                          hostname: "127.0.0.1",
                          port: 0,
                          async fetch() {
                            began()
                            await pending
                            return new Response(
                              "<!doctype html><title>Steering fixture</title><h1>Navigation completed</h1>",
                              {
                                headers: { "content-type": "text/html" },
                              },
                            )
                          },
                        })
                      : undefined
                    const context = {
                      sessionID: session.id,
                      messageID: input.assistantMessage.id,
                      callID: "browser-steered",
                      agent: "agent",
                      abort: stream.abort,
                      extra: { execution: stream.execution },
                      metadata() {},
                      async ask() {},
                    }
                    const work = ToolRuntime.execute({
                      tool: "browser",
                      args: {
                        action: "navigate" as const,
                        url: server ? `http://127.0.0.1:${server.port}` : "http://localhost:4096",
                      },
                      mutating: true,
                      context,
                      execute: async (args) => {
                        if (chromium) return (await BrowserTool.init()).execute(args, context)
                        began()
                        await pending
                        return { title: "Browser navigation", output: "Navigation completed", metadata: {} }
                      },
                    })
                    try {
                      await Promise.race([
                        started,
                        work.then((result) => {
                          throw new Error(`Navigation finished before request arrived: ${result.output}`)
                        }),
                      ])
                      await SessionPrompt.prompt({
                        sessionID: session.id,
                        model: { providerID: model.providerID, modelID: model.id },
                        parts: [{ type: "text", text: "Selam tekrar" }],
                      })
                      expect(stream.abort.aborted).toBe(false)
                      release()
                      const result = await work
                      expect(result.output).toContain(chromium ? "Navigated to" : "Navigation completed")
                      if (chromium)
                        expect(await (await Browser.getPage()).locator("h1").textContent()).toBe("Navigation completed")
                      expect(ExecutionRuntime.view(stream.execution.executionID)?.unknownWork).toEqual([])
                    } finally {
                      release()
                      await work.catch(() => {})
                      server?.stop(true)
                      if (chromium) await Browser.close()
                    }
                  }
                  input.assistantMessage.finish = "stop"
                  return { status: "stop" }
                },
              }) as never,
          )
          try {
            await SessionPrompt.loop(session.id)
            expect(executions).toHaveLength(2)
            expect(executions[1]).toBe(executions[0])
            expect(users[1]).not.toBe(users[0])
            expect(ExecutionRuntime.view(executions[0])?.outcome).not.toBe("cancelled")
          } finally {
            processor.mockRestore()
            policy.mockRestore()
          }
        },
      })
    },
  )
