import fs from "fs/promises"
import path from "path"
import type { Locator, Page } from "playwright"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Browser } from "../browser"
import { BrowserSnapshot } from "./browser-snapshot"
import { BrowserTarget } from "./browser-target"
import { ToolRuntime } from "./runtime"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"
import { runInputSequence, type ActionResult, type BrowserAttachment, type HeldInputs } from "./browser/input-sequence"
import { BrowserParameters, MAX_ATTACHMENT_BYTES, MAX_BROWSER_OUTPUT } from "./browser/schema"
import { redactSensitiveValues, resolvePoint, safeName, timeout, validateURL } from "./browser/validation"

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Browser action aborted"))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}

async function snapshotResult(page: Page, params: BrowserParameters, diff = false): Promise<ActionResult> {
  const snapshot = await BrowserSnapshot.capture(page, { maxElements: params.maxElements, scope: params.scope })
  if (diff) {
    const changes = BrowserSnapshot.diff(page, snapshot)
    const lines = [
      changes.baseline ? "No earlier snapshot existed; saved the current page as the baseline." : "# Snapshot diff",
    ]
    if (changes.added.length)
      lines.push("", "## Added or changed", ...changes.added.map((item) => `- ${JSON.stringify(item)}`))
    if (changes.removed.length)
      lines.push("", "## Removed or changed", ...changes.removed.map((item) => `- ${JSON.stringify(item)}`))
    if (!changes.baseline && !changes.added.length && !changes.removed.length)
      lines.push("", "No semantic changes detected.")
    return {
      output: lines.join("\n").slice(0, MAX_BROWSER_OUTPUT),
      metadata: { added: changes.added.length, removed: changes.removed.length, baseline: changes.baseline },
    }
  }
  BrowserSnapshot.remember(page, snapshot)
  return {
    output: BrowserSnapshot.format(snapshot).slice(0, MAX_BROWSER_OUTPUT),
    metadata: {
      elementCount: snapshot.interactive.length,
      headingCount: snapshot.headings.length,
      frameCount: snapshot.frameCount,
    },
  }
}

async function assertAction(page: Page, locator: Locator | undefined, params: BrowserParameters) {
  const assertion = params.assertion
  if (!assertion) throw new Error("assertion is required for assert")
  const exact = params.exact ?? false
  const fail = (actual: unknown, expected: unknown) => {
    throw new Error(
      `Assertion '${assertion}' failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  }
  if (assertion === "url") {
    if (params.expected === undefined) throw new Error("expected is required for URL assertion")
    const actual = page.url()
    if (exact ? actual !== params.expected : !actual.includes(params.expected)) fail(actual, params.expected)
    return `Assertion passed: URL ${exact ? "equals" : "contains"} ${JSON.stringify(params.expected)}`
  }
  if (!locator) throw new Error(`An element target is required for ${assertion} assertion`)
  if (assertion === "visible" || assertion === "hidden") {
    const actual = await locator.isVisible()
    if (actual !== (assertion === "visible")) fail(actual, assertion === "visible")
  } else if (assertion === "enabled" || assertion === "disabled") {
    const actual = await locator.isEnabled()
    if (actual !== (assertion === "enabled")) fail(actual, assertion === "enabled")
  } else if (assertion === "checked" || assertion === "unchecked") {
    const actual = await locator.isChecked()
    if (actual !== (assertion === "checked")) fail(actual, assertion === "checked")
  } else if (assertion === "selected") {
    const actual = await locator.evaluate((element) => (element as HTMLOptionElement).selected === true)
    if (!actual) fail(actual, true)
  } else if (assertion === "text") {
    if (params.expected === undefined) throw new Error("expected is required for text assertion")
    const actual = (await locator.textContent()) ?? ""
    if (exact ? actual !== params.expected : !actual.includes(params.expected)) fail(actual, params.expected)
  } else if (assertion === "value") {
    if (params.expected === undefined) throw new Error("expected is required for value assertion")
    const actual = await locator.inputValue()
    if (exact ? actual !== params.expected : !actual.includes(params.expected)) fail(actual, params.expected)
  } else if (assertion === "count") {
    if (params.expectedCount === undefined) throw new Error("expectedCount is required for count assertion")
    const actual = await locator.count()
    if (actual !== params.expectedCount) fail(actual, params.expectedCount)
  }
  return `Assertion passed: ${assertion} for ${BrowserTarget.description(params)}`
}

async function perform(
  params: BrowserParameters,
  ctx: Tool.Context,
  flowInputs?: Map<Page, HeldInputs>,
): Promise<ActionResult> {
  ctx.abort.throwIfAborted()

  if (params.action === "close") {
    await Browser.close()
    return { output: "Browser closed" }
  }
  if (params.action === "console_logs") {
    const cursor = Browser.getEventCursor()
    if (params.cursorOnly) {
      return { output: `Current browser event cursor: ${cursor}`, metadata: { count: 0, cursor } }
    }
    const events = Browser.getConsoleEvents({
      since: params.since,
      limit: params.limit,
      urlPattern: params.urlPattern,
      level: params.level,
    })
    if (params.clearEvents) Browser.clearEvents("console")
    return {
      output: `${
        events.length
          ? events
              .map(
                (event) =>
                  `[${event.id}] [${event.type}] [${event.pageId}] ${event.text}${event.url ? ` — ${event.url}:${event.line ?? 0}` : ""}`,
              )
              .join("\n")
              .slice(-MAX_BROWSER_OUTPUT)
          : "No matching console events."
      }\n\nCursor: ${cursor}`,
      metadata: { count: events.length, cursor },
    }
  }
  if (params.action === "network") {
    const cursor = Browser.getEventCursor()
    if (params.cursorOnly) {
      return { output: `Current browser event cursor: ${cursor}`, metadata: { count: 0, cursor } }
    }
    const events = Browser.getNetworkEvents({
      since: params.since,
      limit: params.limit,
      urlPattern: params.urlPattern,
      status: params.status,
      failedOnly: params.failedOnly,
      resourceType: params.resourceType,
    })
    if (params.clearEvents) Browser.clearEvents("network")
    return {
      output: `${
        events.length
          ? events
              .map(
                (event) =>
                  `[${event.id}] ${event.method} ${event.status ?? "FAILED"} ${event.resourceType} ${event.url}${event.duration === undefined ? "" : ` ${event.duration}ms`}${event.error ? ` — ${event.error}` : ""}`,
              )
              .join("\n")
              .slice(-MAX_BROWSER_OUTPUT)
          : "No matching network events."
      }\n\nCursor: ${cursor}`,
      metadata: { count: events.length, cursor },
    }
  }
  if (params.action === "dialog") {
    const cursor = Browser.getEventCursor()
    if (params.cursorOnly) {
      return { output: `Current browser event cursor: ${cursor}`, metadata: { count: 0, cursor } }
    }
    if (params.dialogAction) Browser.prepareDialog(params.dialogAction, params.promptText)
    const events = Browser.getDialogEvents({ since: params.since, limit: params.limit })
    return {
      output: `${
        params.dialogAction
          ? `The next browser dialog will be ${params.dialogAction === "accept" ? "accepted" : "dismissed"}.`
          : events.length
            ? events
                .map(
                  (event) =>
                    `[${event.id}] [${event.pageId}] ${event.type} ${JSON.stringify(event.message)} — ${event.action}`,
                )
                .join("\n")
            : "No browser dialogs recorded."
      }\n\nCursor: ${cursor}`,
      metadata: { count: events.length, cursor, prepared: params.dialogAction },
    }
  }
  if (params.action === "tabs") {
    const tabs = await Browser.getTabs()
    return {
      output: tabs.length
        ? tabs
            .map(
              (tab) => `${tab.active ? "→" : " "} [${tab.id}] [${tab.index}] ${tab.title || "Untitled"} — ${tab.url}`,
            )
            .join("\n")
        : "No browser tabs are open.",
      metadata: { count: tabs.length, tabs },
    }
  }
  if (params.action === "switch_tab") {
    if (!params.tabId && params.tabIndex === undefined) throw new Error("tabId or tabIndex is required for switch_tab")
    const page = params.tabId ? await Browser.selectTabById(params.tabId) : await Browser.selectTab(params.tabIndex!)
    return { output: `Switched to ${Browser.getPageId(page)}`, metadata: { tabId: Browser.getPageId(page) } }
  }
  if (params.action === "new_tab") {
    if (params.url) validateURL(params.url)
    const page = await Browser.newTab(params.url, ctx.abort)
    return { output: `Opened ${Browser.getPageId(page)}`, metadata: { tabId: Browser.getPageId(page) } }
  }
  if (params.action === "close_tab") {
    const closed = await Browser.closeTab({ id: params.tabId, index: params.tabIndex })
    return { output: `Closed ${closed.closed}; active tab is ${closed.active}`, metadata: closed }
  }
  if (params.action === "emulate") {
    const page = await Browser.configureEmulation(
      {
        reset: params.reset,
        device: params.device,
        width: params.width,
        height: params.height,
        locale: params.locale,
        timezoneId: params.timezoneId,
        colorScheme: params.colorScheme,
        offline: params.offline,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
      },
      ctx.abort,
    )
    const state = await page.evaluate(() => ({
      online: navigator.onLine,
      language: navigator.language,
      touch: navigator.maxTouchPoints > 0,
      viewport: { width: innerWidth, height: innerHeight },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    }))
    return {
      output: `Browser emulation settings applied (online=${state.online}, viewport=${state.viewport.width}x${state.viewport.height}, touch=${state.touch})`,
      metadata: { tabId: Browser.getPageId(page), ...state },
    }
  }
  if (params.action === "cookies") {
    const operation = params.cookieOperation ?? "list"
    if (operation === "set") {
      if (!params.cookies?.length) throw new Error("cookies is required for cookieOperation=set")
      await Browser.addCookies(params.cookies as any)
      return { output: `Set ${params.cookies.length} cookie(s)`, metadata: { count: params.cookies.length } }
    }
    if (operation === "clear") {
      await Browser.clearCookies()
      return { output: "Browser cookies cleared" }
    }
    const cookies = await Browser.getCookies(params.urls)
    const output = params.includeValues ? cookies : redactSensitiveValues(cookies)
    return {
      output: JSON.stringify(output, null, 2).slice(0, MAX_BROWSER_OUTPUT),
      metadata: { count: cookies.length, valuesRedacted: !params.includeValues },
    }
  }
  if (params.action === "storage") {
    if ((params.storageOperation ?? "list") === "clear") {
      await Browser.clearStorage()
      return { output: "Cookies, local storage, and IndexedDB cleared" }
    }
    const storage = await Browser.getStorageState()
    const output = params.includeValues ? storage : redactSensitiveValues(storage)
    return {
      output: JSON.stringify(output, null, 2).slice(0, MAX_BROWSER_OUTPUT),
      metadata: {
        cookieCount: storage.cookies.length,
        originCount: storage.origins.length,
        valuesRedacted: !params.includeValues,
      },
    }
  }
  if (params.action === "clock") {
    const page = await Browser.getPage()
    const operation = params.clockOperation
    if (!operation) throw new Error("clockOperation is required for clock")
    if (operation === "install") {
      await page.clock.install(params.clockTime === undefined ? undefined : { time: params.clockTime })
    } else if (operation === "pause") {
      const time = params.clockTime ?? (await page.evaluate(() => Date.now()))
      try {
        await page.clock.pauseAt(time)
      } catch (error) {
        // Playwright pauses before rejecting a sampled time overtaken by the round trip.
        if (params.clockTime !== undefined || !String(error).includes("Cannot fast-forward to the past")) throw error
        await page.clock.pauseAt(await page.evaluate(() => Date.now()))
      }
    } else if (operation === "run_for") {
      if (params.duration === undefined) throw new Error("duration is required for clock run_for")
      await page.clock.runFor(params.duration)
    } else if (operation === "fast_forward") {
      if (params.duration === undefined) throw new Error("duration is required for clock fast_forward")
      await page.clock.fastForward(params.duration)
    } else {
      await page.clock.resume()
    }
    return {
      output: `Browser clock operation completed: ${operation}`,
      metadata: { operation, duration: params.duration, clockTime: params.clockTime },
    }
  }
  if (params.action === "trace_start") {
    await Browser.startTrace(params.name)
    return { output: "Browser trace recording started" }
  }
  if (params.action === "trace_stop") {
    const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
    await assertExternalDirectory(ctx, targetWorkdir, { kind: "directory" })
    const traceDir = path.join(targetWorkdir, ".traces")
    await fs.mkdir(traceDir, { recursive: true })
    const filepath = path.join(traceDir, `${safeName(params.name, `trace-${Date.now()}`)}.zip`)
    await Browser.stopTrace(filepath)
    return { output: `Browser trace saved to ${filepath}`, metadata: { tracePath: filepath } }
  }

  if (params.action === "screenshot" && (params.save ?? true)) {
    const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
    await assertExternalDirectory(ctx, targetWorkdir, { kind: "directory" })
  }

  let page = await Browser.getPage()
  const heldInputs = flowInputs
    ? (flowInputs.get(page) ?? { keys: new Set<string>(), buttons: new Set<"left" | "right" | "middle">() })
    : undefined
  if (heldInputs) flowInputs!.set(page, heldInputs)
  if (params.action === "navigate") {
    const url = validateURL(params.url)
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeout(params), signal: ctx.abort })
    const result: ActionResult = { output: `Navigated to ${url}` }
    if (params.returnSnapshot) {
      const snapshot = await snapshotResult(page, params)
      result.output = `${result.output}\n\n${snapshot.output}`.slice(0, MAX_BROWSER_OUTPUT)
      result.metadata = { snapshot: snapshot.metadata }
    }
    return result
  }
  if (params.action === "snapshot") return snapshotResult(page, params)
  if (params.action === "snapshot_diff") return snapshotResult(page, params, true)

  const locator = BrowserTarget.has(params) ? await BrowserTarget.locator(page, params) : undefined
  let result: ActionResult

  switch (params.action) {
    case "click": {
      const click = () =>
        locator!.click({
          button: params.button ?? "left",
          clickCount: params.clickCount ?? 1,
          delay: params.delay,
          force: params.force,
          modifiers: params.modifiers,
          timeout: timeout(params),
          signal: ctx.abort,
        })
      if (params.expectPopup) {
        const [popup] = await Promise.all([
          page.waitForEvent("popup", { timeout: timeout(params), signal: ctx.abort }),
          click(),
        ])
        page = Browser.activatePage(popup)
        result = { output: `Clicked ${BrowserTarget.description(params)} and switched to ${Browser.getPageId(page)}` }
      } else {
        await click()
        result = { output: `Clicked ${BrowserTarget.description(params)}` }
      }
      break
    }
    case "tap":
      await locator!.tap({ force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Tapped ${BrowserTarget.description(params)}` }
      break
    case "mouse": {
      const action = params.mouseAction ?? "click"
      if ((action === "down" || action === "up") && !locator && params.x === undefined && params.y === undefined) {
        await page.mouse[action]({ button: params.button ?? "left", clickCount: params.clickCount })
        if (action === "down") heldInputs?.buttons.add(params.button ?? "left")
        else heldInputs?.buttons.delete(params.button ?? "left")
        result = { output: `Mouse ${action} at the current pointer position` }
        break
      }
      if (action === "wheel") {
        if (locator || params.x !== undefined || params.y !== undefined) {
          const resolved = await resolvePoint(page, locator, params)
          await page.mouse.move(resolved.x, resolved.y, { steps: params.pointerSteps })
        }
        await page.mouse.wheel(params.deltaX ?? 0, params.deltaY ?? 0)
        result = { output: `Mouse wheel moved by (${params.deltaX ?? 0}, ${params.deltaY ?? 0})` }
        break
      }
      const resolved = await resolvePoint(page, locator, params)
      if (action === "move") {
        await page.mouse.move(resolved.x, resolved.y, { steps: params.pointerSteps })
      } else if (action === "click") {
        await page.mouse.click(resolved.x, resolved.y, {
          button: params.button ?? "left",
          clickCount: params.clickCount,
          delay: params.delay,
        })
      } else if (action === "tap") {
        await page.touchscreen.tap(resolved.x, resolved.y)
      } else {
        await page.mouse.move(resolved.x, resolved.y, { steps: params.pointerSteps })
        if (action === "down") {
          await page.mouse.down({ button: params.button ?? "left", clickCount: params.clickCount })
          heldInputs?.buttons.add(params.button ?? "left")
        } else {
          await page.mouse.up({ button: params.button ?? "left", clickCount: params.clickCount })
          heldInputs?.buttons.delete(params.button ?? "left")
        }
      }
      result = {
        output: `Mouse ${action} at (${Math.round(resolved.x)}, ${Math.round(resolved.y)})`,
        metadata: { action, x: resolved.x, y: resolved.y, coordinateMode: resolved.mode, box: resolved.box },
      }
      break
    }
    case "fill":
    case "type":
      if (params.action === "fill" || params.delay === undefined) {
        await locator!.fill(params.text, { force: params.force, timeout: timeout(params), signal: ctx.abort })
        result = { output: `Filled ${BrowserTarget.description(params)}`, metadata: { inputMode: "fill" } }
      } else {
        await locator!.pressSequentially(params.text, {
          delay: params.delay,
          timeout: timeout(params),
          signal: ctx.abort,
        })
        result = { output: `Typed into ${BrowserTarget.description(params)}`, metadata: { inputMode: "sequential" } }
      }
      break
    case "press":
      if (!params.key) throw new Error("key is required for press")
      if (locator) await locator.press(params.key, { delay: params.delay, timeout: timeout(params), signal: ctx.abort })
      else await withAbort(page.keyboard.press(params.key, { delay: params.delay }), ctx.abort)
      result = { output: `Pressed ${params.key}${locator ? ` on ${BrowserTarget.description(params)}` : ""}` }
      break
    case "key_down":
    case "key_up": {
      if (!params.key) throw new Error(`key is required for ${params.action}`)
      if (locator) await locator.focus({ timeout: timeout(params), signal: ctx.abort })
      if (params.action === "key_down") {
        await page.keyboard.down(params.key)
        heldInputs?.keys.add(params.key)
      } else {
        await page.keyboard.up(params.key)
        heldInputs?.keys.delete(params.key)
      }
      result = {
        output: `${params.action === "key_down" ? "Held" : "Released"} ${params.key}${locator ? ` on ${BrowserTarget.description(params)}` : ""}`,
      }
      break
    }
    case "input_sequence":
      result = await runInputSequence(page, locator, params, ctx, heldInputs)
      break
    case "box": {
      const box = await locator!.boundingBox()
      if (!box) throw new Error(`${BrowserTarget.description(params)} has no visible bounding box`)
      result = {
        output: JSON.stringify(box),
        metadata: { box, viewport: page.viewportSize(), target: BrowserTarget.description(params) },
      }
      break
    }
    case "clear":
      await locator!.fill("", { force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Cleared ${BrowserTarget.description(params)}` }
      break
    case "read": {
      const content = locator
        ? await locator.evaluate((element, max) => (element.textContent ?? "").slice(0, max), MAX_BROWSER_OUTPUT)
        : await page.evaluate((max) => document.documentElement.outerHTML.slice(0, max), MAX_BROWSER_OUTPUT)
      result = { output: content || "No content found" }
      break
    }
    case "accessibility": {
      const scope = locator ?? page.locator("body")
      const tree = String(await scope.ariaSnapshot({ timeout: timeout(params), signal: ctx.abort }))
      // ponytail: bounded native form labels; custom controls, frames and contrast need separate inspection.
      const missingLabels = await scope.evaluate((root) => {
        const controls = [root, ...root.querySelectorAll("input,select,textarea")]
          .filter((element) => element.matches("input,select,textarea"))
          .slice(0, 100)
        return controls
          .filter((element) => {
            if (!element.getClientRects().length || element.closest('[aria-hidden="true"],[inert]')) return false
            if (element instanceof HTMLInputElement && /^(hidden|submit|reset|button|image)$/.test(element.type))
              return false
            const label =
              element.getAttribute("aria-label")?.trim() ||
              element.getAttribute("title")?.trim() ||
              (element.getAttribute("aria-labelledby") ?? "")
                .split(/\s+/)
                .some((id) => element.ownerDocument.getElementById(id)?.textContent?.trim()) ||
              Array.from((element as HTMLInputElement).labels ?? []).some((label) => label.textContent?.trim())
            return !label
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}${element instanceof HTMLInputElement ? `[type=${element.type}]` : ""}`,
          )
      })
      result = {
        output: [
          ...(missingLabels.length
            ? [
                `Potential missing form labels (first 100 native controls): ${missingLabels.join(", ")}. No associated text label or non-empty ARIA/title label was found; a placeholder alone is not a persistent label.`,
              ]
            : []),
          tree,
          "This accessibility tree and bounded label check are not a complete accessibility audit.",
        ]
          .join("\n\n")
          .slice(0, MAX_BROWSER_OUTPUT),
        metadata: { format: "aria-snapshot", missingLabels: missingLabels.length },
      }
      break
    }
    case "wait": {
      if (params.duration !== undefined) {
        await withAbort(page.waitForTimeout(params.duration), ctx.abort)
        result = { output: `Waited ${params.duration}ms` }
      }
      if (locator) {
        const target =
          params.text === undefined
            ? locator
            : locator.filter({
                hasText: params.exact
                  ? new RegExp(`^${params.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
                  : params.text,
              })
        await target.waitFor({ state: params.state ?? "visible", timeout: timeout(params), signal: ctx.abort })
        result = {
          output: `Wait condition met: ${BrowserTarget.description(params)} is ${params.state ?? "visible"}${params.text === undefined ? "" : ` with text ${JSON.stringify(params.text)}`}`,
        }
      } else if (params.text !== undefined) {
        await page
          .getByText(params.text, { exact: params.exact ?? false })
          .first()
          .waitFor({ state: params.state ?? "visible", timeout: timeout(params), signal: ctx.abort })
        result = { output: `Wait condition met for text ${JSON.stringify(params.text)}` }
      } else if (params.url) {
        await page.waitForURL(params.url, { timeout: timeout(params), signal: ctx.abort })
        result = { output: `Wait condition met for URL ${params.url}` }
      } else if (params.duration === undefined || params.loadState !== undefined) {
        await page.waitForLoadState(params.loadState ?? "networkidle", { timeout: timeout(params), signal: ctx.abort })
        result = { output: `Page reached ${params.loadState ?? "networkidle"}` }
      }
      break
    }
    case "scroll": {
      if (!params.direction) throw new Error("direction is required for scroll")
      const amount = params.amount ?? 500
      ctx.abort.throwIfAborted()
      if (locator) {
        await locator.evaluate(
          (element, input) => {
            if (input.direction === "top") element.scrollTop = 0
            else if (input.direction === "bottom") element.scrollTop = element.scrollHeight
            else if (input.direction === "up") element.scrollTop -= input.amount
            else if (input.direction === "down") element.scrollTop += input.amount
            else if (input.direction === "left") element.scrollLeft -= input.amount
            else if (input.direction === "right") element.scrollLeft += input.amount
          },
          { direction: params.direction, amount },
        )
      } else if (params.direction === "top" || params.direction === "bottom") {
        await page.evaluate(
          (direction) => window.scrollTo(0, direction === "top" ? 0 : document.body.scrollHeight),
          params.direction,
        )
      } else {
        const x = params.direction === "left" ? -amount : params.direction === "right" ? amount : 0
        const y = params.direction === "up" ? -amount : params.direction === "down" ? amount : 0
        await page.mouse.wheel(x, y)
      }
      result = { output: `Scrolled ${params.direction}` }
      break
    }
    case "drag": {
      const destination =
        params.destination ?? (params.targetSelector ? { selector: params.targetSelector } : undefined)
      const target = await BrowserTarget.locator(page, destination)
      await locator!.dragTo(target, { force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Dragged ${BrowserTarget.description(params)} to ${BrowserTarget.description(destination)}` }
      break
    }
    case "hover":
      await locator!.hover({ force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Hovered ${BrowserTarget.description(params)}` }
      break
    case "focus":
      await locator!.focus({ timeout: timeout(params), signal: ctx.abort })
      result = { output: `Focused ${BrowserTarget.description(params)}` }
      break
    case "select_option": {
      if (!params.optionValues?.length) throw new Error("optionValues is required for select_option")
      const selected = await locator!.selectOption(params.optionValues, {
        force: params.force,
        timeout: timeout(params),
        signal: ctx.abort,
      })
      result = { output: `Selected ${selected.map((value) => JSON.stringify(value)).join(", ")}` }
      break
    }
    case "check":
      await locator!.check({ force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Checked ${BrowserTarget.description(params)}` }
      break
    case "uncheck":
      await locator!.uncheck({ force: params.force, timeout: timeout(params), signal: ctx.abort })
      result = { output: `Unchecked ${BrowserTarget.description(params)}` }
      break
    case "set_files": {
      if (!params.files) throw new Error("files is required for set_files; pass [] to clear the input")
      const files = params.files.map((file) =>
        path.isAbsolute(file) ? path.normalize(file) : path.resolve(Instance.directory, file),
      )
      for (const file of files) await assertExternalDirectory(ctx, file)
      await locator!.setInputFiles(files, { timeout: timeout(params), signal: ctx.abort })
      result = { output: files.length ? `Set ${files.length} input file(s)` : "Cleared input files" }
      break
    }
    case "assert":
      result = { output: await assertAction(page, locator, params), metadata: { assertion: params.assertion } }
      break
    case "screenshot": {
      const shouldSave = params.save ?? true
      const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
      if (params.fullPage && locator) throw new Error("fullPage and an element target cannot be used together")
      let dimensions: { width: number; height: number } | undefined
      if (params.fullPage) {
        dimensions = await page.evaluate(() => ({
          width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
          height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        }))
        if (
          dimensions.width > 32_767 ||
          dimensions.height > 32_767 ||
          dimensions.width * dimensions.height > 25_000_000
        ) {
          throw new Error(`Full-page screenshot is too large (${dimensions.width}x${dimensions.height})`)
        }
      } else if (locator) {
        const box = await locator.boundingBox()
        if (box) dimensions = { width: Math.round(box.width), height: Math.round(box.height) }
      } else {
        dimensions = page.viewportSize() ?? undefined
      }
      const buffer = locator
        ? await locator.screenshot({ timeout: timeout(params), signal: ctx.abort })
        : await page.screenshot({ fullPage: params.fullPage, timeout: timeout(params), signal: ctx.abort })
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Screenshot exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB attachment limit`)
      }
      const filename = `${safeName(params.name, `screenshot-${Date.now()}`)}.png`
      let filepath: string | undefined
      if (shouldSave) {
        const screenshotDir = path.join(targetWorkdir, ".screenshots")
        await fs.mkdir(screenshotDir, { recursive: true })
        filepath = path.join(screenshotDir, filename)
        await fs.writeFile(filepath, buffer)
      }
      result = {
        output: filepath
          ? `Screenshot saved to ${filepath} and attached for visual analysis`
          : "Screenshot attached for visual analysis",
        metadata: { screenshotPath: filepath, bytes: buffer.byteLength, dimensions, element: !!locator },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime: "image/png",
            filename,
            url: `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`,
          },
        ],
      }
      break
    }
    case "download": {
      const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
      await assertExternalDirectory(ctx, targetWorkdir, { kind: "directory" })
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: timeout(params), signal: ctx.abort }),
        locator!.click({ timeout: timeout(params), signal: ctx.abort }),
      ])
      const downloadDir = path.join(targetWorkdir, ".downloads")
      await fs.mkdir(downloadDir, { recursive: true })
      const suggested = path.basename(download.suggestedFilename())
      const filename = params.name ? `${safeName(params.name, "download")}${path.extname(suggested)}` : suggested
      const filepath = path.join(downloadDir, filename)
      await download.saveAs(filepath)
      result = { output: `Download saved to ${filepath}`, metadata: { downloadPath: filepath, filename } }
      break
    }
    case "back":
      await page.goBack({ timeout: timeout(params), signal: ctx.abort })
      result = { output: "Navigated back" }
      break
    case "forward":
      await page.goForward({ timeout: timeout(params), signal: ctx.abort })
      result = { output: "Navigated forward" }
      break
    case "reload":
      await page.reload({ timeout: timeout(params), signal: ctx.abort })
      result = { output: "Reloaded page" }
      break
    case "evaluate": {
      if (!params.script) throw new Error("script is required for evaluate")
      const evaluated = await withAbort(
        page.evaluate(
          async ({ script, max }) => {
            // eslint-disable-next-line no-eval
            const value = await eval(script)
            if (typeof value === "string") return value.slice(0, max)
            try {
              return JSON.stringify(value).slice(0, max)
            } catch {
              return String(value).slice(0, max)
            }
          },
          { script: params.script, max: MAX_BROWSER_OUTPUT },
        ),
        ctx.abort,
      )
      result = { output: String(evaluated) }
      break
    }
    default:
      throw new Error(`Unsupported browser action: ${params.action}`)
  }

  if (params.returnSnapshot) {
    const snapshot = await snapshotResult(page, params)
    result.output = `${result.output}\n\n${snapshot.output}`.slice(0, MAX_BROWSER_OUTPUT)
    result.metadata = { ...result.metadata, snapshot: snapshot.metadata }
  }
  return result
}

function failedBeforeBrowserAction(error: unknown, action: BrowserParameters["action"]) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    (/Timeout \d+ms exceeded/.test(message) &&
      /waiting for (?:locator|getBy\w+)\(/.test(message) &&
      !/performing .* action|action done/.test(message)) ||
    (action === "navigate" && /\bgoto: net::ERR_CONNECTION_REFUSED\b/.test(message))
  )
}

function knownBrowserFailure(error: unknown, action: BrowserParameters["action"]) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    action === "assert" ||
    (action !== "navigate" && failedBeforeBrowserAction(error, action)) ||
    (action === "click" &&
      /Timeout \d+ms exceeded/.test(message) &&
      message.lastIndexOf("intercepts pointer events") > message.lastIndexOf("performing click action") &&
      !/action done|waiting for scheduled navigations/.test(message)) ||
    /strict mode violation/.test(message) ||
    (action === "evaluate" && /evaluate: (?:Error|TypeError|ReferenceError|SyntaxError|RangeError):/.test(message))
  )
}

export const BrowserTool = Tool.define("browser", {
  description: `Control a real Chromium browser with semantic, accessible locators and stable snapshot refs.
Use ref, role+accessibleName, label, placeholder, testId, targetText, or CSS selector to target elements.
fill replaces a field value atomically. type also fills by default; supply delay for physical sequential key input.
Supports navigation, assertions, forms, uploads/downloads, dialogs, popups, stable tabs, screenshots attached for vision,
snapshot diffs, cursor-based console/network events, traces, cookies/storage, device/viewport/locale/timezone/geolocation/offline emulation,
canvas-relative mouse/touch coordinates, held keys, deterministic browser clock control, and timed input sequences with visual checkpoints.
Use action=flow for each acceptance domain: at most 20 steps, interaction followed by assert/evaluate. Split larger suites into bounded flows.
For real-time games, keep reset/start, input_sequence and assert/evaluate in the same flow: simulation continues between calls. input_sequence combines held keys/pointers, timed waits or clock advances, and capture checkpoints.
Navigation supports HTTP/HTTPS only. Serve local artifacts over HTTP; direct-file behavior remains unverified, so do not repeat file:// navigation.
Set returnSnapshot=true after an action to inspect the resulting UI without another call.
The browser stays open between calls. Playwright and Chromium must be installed.`,
  mutating: (params) =>
    (params.action === "screenshot" && params.save !== false) ||
    ![
      "snapshot",
      "snapshot_diff",
      "read",
      "box",
      "accessibility",
      "screenshot",
      "assert",
      "console_logs",
      "network",
      "tabs",
    ].includes(params.action),
  // Browser interaction preserves source verification. Saving files still
  // requires filesystem ownership; owned children can use save=false captures.
  effects: (params) => ({
    workspace: (params.action === "flow" ? (params.steps ?? []) : [params]).some(
      (step) =>
        step.action === "download" ||
        step.action === "trace_stop" ||
        (step.action === "screenshot" && step.save !== false),
    )
      ? "write"
      : "none",
    external: "none",
    reversible: true,
    destructive: false,
    privileged: false,
  }),
  parameters: BrowserParameters,
  async execute(
    params,
    ctx,
  ): Promise<{
    title: string
    metadata: Record<string, unknown>
    output: string
    attachments?: BrowserAttachment[]
  }> {
    let flowSteps: BrowserParameters[] = []
    if (params.action === "flow") {
      try {
        if (!params.steps?.length) throw new Error("steps is required for flow")
        flowSteps = params.steps.map((step) => BrowserParameters.parse(step))
      } catch (error) {
        throw new ToolRuntime.NotAppliedError(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const utilityAction = ["close", "console_logs", "network"].includes(params.action)
    if (!utilityAction) {
      const isAvailable = await Browser.isPlaywrightAvailable()
      if (!isAvailable) {
        Browser.resetPlaywrightCheck()
        if (!(await Browser.isPlaywrightAvailable())) {
          return {
            output: `Browser tool unavailable: Playwright or Chromium is missing.\n\nInstall Chromium with:\n${Browser.getInstallHint()}`,
            title: "Browser: Not Available",
            metadata: { error: "Playwright not installed" },
          }
        }
      }
    }

    if (!utilityAction) {
      let permissionTarget = BrowserTarget.has(params) ? BrowserTarget.description(params) : params.action
      if (params.action === "navigate" || (params.action === "new_tab" && params.url)) {
        permissionTarget = validateURL(params.url).toString()
      }
      await ctx.ask({
        permission: "browser",
        patterns: [`${params.action}:${permissionTarget}`],
        always: [`${params.action}:*`],
        metadata: { action: params.action, target: permissionTarget },
      })
    }

    const restoreFocus = await Browser.captureFocusRestorer()
    const flowInputs = new Map<Page, HeldInputs>()
    let flowCompleted = false
    try {
      if (params.action === "flow") {
        const outputs: string[] = []
        const steps: Array<Record<string, unknown>> = []
        const attachments: BrowserAttachment[] = []
        for (const [index, step] of flowSteps.entries()) {
          ctx.abort.throwIfAborted()
          try {
            const value = await perform(step, ctx, flowInputs)
            outputs.push(`## Step ${index + 1}: ${step.action}\n${value.output}`)
            steps.push({ index, action: step.action, ok: true, metadata: value.metadata })
            if (value.attachments) attachments.push(...value.attachments)
          } catch (error) {
            steps.push({
              index,
              action: step.action,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
            const failure = `Browser flow failed at step ${index + 1} (${step.action}): ${error instanceof Error ? error.message : String(error)}`
            if (!ctx.abort.aborted && knownBrowserFailure(error, step.action)) {
              return {
                title: "Browser: flow failed",
                output: [...outputs, failure, "Earlier successful steps remain applied; do not replay them blindly."]
                  .join("\n\n")
                  .slice(0, MAX_BROWSER_OUTPUT),
                metadata: { status: "failed", error: failure, steps },
                attachments,
              }
            }
            throw new Error(failure)
          }
        }
        ctx.abort.throwIfAborted()
        const page = await Browser.getPage()
        const title = (await page.title()).slice(0, 2_000)
        flowCompleted = true
        return {
          output: outputs.join("\n\n").slice(0, MAX_BROWSER_OUTPUT),
          title: "Browser: flow",
          metadata: {
            steps,
            title,
            url: page.url().slice(0, 8_192),
            tabId: Browser.getPageId(page),
          },
          attachments,
        }
      }

      const result = await perform(params, ctx)
      let page: Page | undefined
      try {
        if (!utilityAction) page = await Browser.getPage()
      } catch {
        page = undefined
      }
      return {
        output: result.output,
        title: `Browser: ${params.action}`,
        metadata: {
          ...result.metadata,
          ...(page
            ? {
                title: (await page.title().catch(() => "")).slice(0, 2_000),
                url: page.url().slice(0, 8_192),
                tabId: Browser.getPageId(page),
              }
            : {}),
        },
        attachments: result.attachments,
      }
    } catch (error) {
      if (ctx.abort.aborted) throw new Error(`Browser action '${params.action}' was aborted`, { cause: error })
      const failure = new Error(
        `Browser action '${params.action}' failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
      if (params.action !== "flow" && failedBeforeBrowserAction(error, params.action)) {
        throw new ToolRuntime.NotAppliedError(failure)
      }
      if (params.action !== "flow" && knownBrowserFailure(error, params.action)) {
        return {
          title: `Browser: ${params.action} failed`,
          output: failure.message,
          metadata: { status: "failed", error: failure.message },
        }
      }
      throw failure
    } finally {
      if (!flowCompleted) {
        for (const [page, inputs] of flowInputs) {
          for (const key of [...inputs.keys].reverse()) await page.keyboard.up(key).catch(() => {})
          for (const button of [...inputs.buttons].reverse()) await page.mouse.up({ button }).catch(() => {})
        }
      }
      await restoreFocus?.()
    }
  },
})
