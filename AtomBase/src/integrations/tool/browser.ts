import fs from "fs/promises"
import path from "path"
import z from "zod"
import type { Locator, Page } from "playwright"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Browser } from "../browser"
import { BrowserSnapshot } from "./browser-snapshot"
import { BrowserTarget } from "./browser-target"
import { assertExternalDirectory } from "./external-directory"
import { Tool } from "./tool"

const MAX_BROWSER_OUTPUT = 100_000
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const DEFAULT_TIMEOUT = 30_000
const MAX_FLOW_STEPS = 20
const MAX_INPUT_SEQUENCE_EVENTS = 200
const MAX_INPUT_SEQUENCE_DURATION = 120_000
const MAX_INPUT_SEQUENCE_CAPTURES = 10
const MAX_INPUT_SEQUENCE_ATTACHMENT_BYTES = 40 * 1024 * 1024

const Action = z.enum([
  "navigate",
  "click",
  "tap",
  "mouse",
  "key_down",
  "key_up",
  "input_sequence",
  "box",
  "clock",
  "type",
  "press",
  "clear",
  "read",
  "snapshot",
  "snapshot_diff",
  "accessibility",
  "network",
  "wait",
  "screenshot",
  "scroll",
  "drag",
  "hover",
  "focus",
  "select_option",
  "check",
  "uncheck",
  "set_files",
  "assert",
  "evaluate",
  "console_logs",
  "back",
  "forward",
  "reload",
  "tabs",
  "switch_tab",
  "new_tab",
  "close_tab",
  "dialog",
  "download",
  "emulate",
  "cookies",
  "storage",
  "trace_start",
  "trace_stop",
  "flow",
  "close",
])

const Cookie = z.object({
  name: z.string().max(1_000),
  value: z.string().max(100_000),
  url: z.string().max(8_192).optional(),
  domain: z.string().max(1_000).optional(),
  path: z.string().max(4_096).optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
})

const InputSequenceEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("wait"), duration: z.number().int().min(0).max(30_000) }),
  z.object({ type: z.literal("advance"), duration: z.number().int().min(0).max(30_000) }),
  z.object({ type: z.literal("key_down"), key: z.string().min(1).max(100) }),
  z.object({ type: z.literal("key_up"), key: z.string().min(1).max(100) }),
  z.object({
    type: z.literal("press"),
    key: z.string().min(1).max(100),
    delay: z.number().int().min(0).max(10_000).optional(),
  }),
  z.object({
    type: z.literal("mouse_move"),
    x: z.number().min(-100_000).max(100_000).optional(),
    y: z.number().min(-100_000).max(100_000).optional(),
    steps: z.number().int().min(1).max(1_000).optional(),
  }),
  z.object({
    type: z.literal("mouse_down"),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    type: z.literal("mouse_up"),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().min(1).max(3).optional(),
  }),
  z.object({
    type: z.literal("mouse_click"),
    x: z.number().min(-100_000).max(100_000).optional(),
    y: z.number().min(-100_000).max(100_000).optional(),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().min(1).max(3).optional(),
    delay: z.number().int().min(0).max(10_000).optional(),
  }),
  z.object({
    type: z.literal("tap"),
    x: z.number().min(-100_000).max(100_000).optional(),
    y: z.number().min(-100_000).max(100_000).optional(),
  }),
  z.object({
    type: z.literal("wheel"),
    deltaX: z.number().min(-100_000).max(100_000).optional(),
    deltaY: z.number().min(-100_000).max(100_000).optional(),
  }),
  z.object({ type: z.literal("capture"), name: z.string().max(200).optional() }),
])

const BrowserParameters = z
  .object({
    action: Action.describe("Browser action to perform"),
    ...BrowserTarget.Fields,
    url: z.string().max(8_192).optional().describe("Absolute URL for navigation or tab creation"),
    script: z
      .string()
      .max(100_000)
      .optional()
      .describe("JavaScript expression for evaluate; invoke function expressions, for example (() => 42)()"),
    text: z.string().max(100_000).optional().describe("Text to enter or wait for"),
    key: z.string().max(100).optional().describe("Keyboard key such as Enter, ControlOrMeta+C, or ArrowDown"),
    mouseAction: z.enum(["move", "click", "down", "up", "wheel", "tap"]).optional(),
    x: z.number().min(-100_000).max(100_000).optional().describe("Pointer X coordinate"),
    y: z.number().min(-100_000).max(100_000).optional().describe("Pointer Y coordinate"),
    coordinateMode: z
      .enum(["viewport", "element", "normalized"])
      .optional()
      .describe("Coordinates are viewport pixels, target-relative pixels, or normalized 0..1 within the target"),
    deltaX: z.number().min(-100_000).max(100_000).optional(),
    deltaY: z.number().min(-100_000).max(100_000).optional(),
    pointerSteps: z.number().int().min(1).max(1_000).optional().describe("Intermediate steps for mouse movement"),
    delay: z.number().min(0).max(5_000).optional().describe("Delay between input events in milliseconds"),
    timeout: z.number().int().min(100).max(120_000).optional(),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
    loadState: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    maxElements: z.number().int().min(1).max(500).optional(),
    scope: z.string().max(4_096).optional().describe("Limit snapshot to this CSS selector in each frame"),
    tabIndex: z.number().int().min(0).max(1_000).optional(),
    tabId: z
      .string()
      .regex(/^tab-\d+$/)
      .optional()
      .describe("Stable tab ID returned by tabs"),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().min(1).max(3).optional(),
    force: z.boolean().optional(),
    modifiers: z
      .array(z.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))
      .max(5)
      .optional(),
    direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional(),
    amount: z.number().min(1).max(100_000).optional(),
    destination: BrowserTarget.Info.optional().describe("Semantic destination target for drag"),
    targetSelector: z.string().max(4_096).optional().describe("Legacy CSS destination for drag"),
    name: z.string().max(200).optional().describe("Safe output name without extension"),
    workdir: z.string().max(4_096).optional(),
    fullPage: z.boolean().optional(),
    save: z
      .boolean()
      .optional()
      .describe("Save screenshot to .screenshots in addition to attaching it (default: true)"),
    returnSnapshot: z.boolean().optional().describe("Append a fresh semantic snapshot after the action"),
    assertion: z
      .enum([
        "visible",
        "hidden",
        "enabled",
        "disabled",
        "checked",
        "unchecked",
        "selected",
        "text",
        "value",
        "url",
        "count",
      ])
      .optional(),
    expected: z.string().max(100_000).optional(),
    expectedCount: z.number().int().min(0).optional(),
    optionValues: z.array(z.string().max(10_000)).max(100).optional(),
    files: z.array(z.string().max(4_096)).max(100).optional(),
    expectPopup: z.boolean().optional().describe("Wait for and switch to a popup opened by click"),
    dialogAction: z.enum(["accept", "dismiss"]).optional(),
    promptText: z.string().max(100_000).optional(),
    device: z.string().max(200).optional(),
    width: z.number().int().min(100).max(10_000).optional(),
    height: z.number().int().min(100).max(10_000).optional(),
    locale: z.string().max(100).optional(),
    timezoneId: z.string().max(200).optional(),
    colorScheme: z.enum(["dark", "light", "no-preference"]).optional(),
    offline: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(100_000).optional(),
    reset: z.boolean().optional(),
    cookieOperation: z.enum(["list", "set", "clear"]).optional(),
    cookies: z.array(Cookie).max(100).optional(),
    urls: z.array(z.string().max(8_192)).max(100).optional(),
    storageOperation: z.enum(["list", "clear"]).optional(),
    includeValues: z
      .boolean()
      .optional()
      .describe("Include sensitive cookie/storage values when listing (default: false, values are redacted)"),
    since: z.number().int().min(0).optional().describe("Return events with IDs newer than this cursor"),
    limit: z.number().int().min(1).max(500).optional(),
    cursorOnly: z.boolean().optional().describe("Return only the current event cursor without listing events"),
    level: z.string().max(100).optional(),
    urlPattern: z.string().max(2_000).optional(),
    status: z.number().int().min(100).max(599).optional(),
    failedOnly: z.boolean().optional(),
    resourceType: z.string().max(100).optional(),
    clearEvents: z.boolean().optional(),
    steps: z.array(z.record(z.string(), z.unknown())).max(MAX_FLOW_STEPS).optional(),
    sequence: z
      .array(InputSequenceEvent)
      .max(MAX_INPUT_SEQUENCE_EVENTS)
      .optional()
      .describe("Timed keyboard/mouse/touch/capture events executed in one low-latency call"),
    releaseAtEnd: z.boolean().optional().describe("Release held keys/buttons after input_sequence (default: true)"),
    clockOperation: z
      .enum(["install", "pause", "run_for", "fast_forward", "resume"])
      .optional()
      .describe(
        "Install before game navigation, pause after load, then run_for to advance timers and animation frames",
      ),
    duration: z.number().int().min(0).max(MAX_INPUT_SEQUENCE_DURATION).optional(),
    clockTime: z.union([z.number(), z.string().max(200)]).optional(),
  })
  .superRefine((input, ctx) => {
    const targets = [
      input.ref,
      input.selector,
      input.role,
      input.label,
      input.placeholder,
      input.testId,
      input.targetText,
    ]
    if (targets.filter((value) => value !== undefined).length > 1) {
      ctx.addIssue({ code: "custom", message: "Use exactly one element target strategy" })
    }
    if (input.accessibleName !== undefined && input.role === undefined) {
      ctx.addIssue({ code: "custom", path: ["accessibleName"], message: "accessibleName requires role" })
    }
  })

type BrowserParameters = z.infer<typeof BrowserParameters>
type BrowserAttachment = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
}
type ActionResult = {
  output: string
  metadata?: Record<string, unknown>
  attachments?: BrowserAttachment[]
}

function timeout(params: BrowserParameters) {
  return params.timeout ?? DEFAULT_TIMEOUT
}

function targetRequired(params: BrowserParameters) {
  if (!BrowserTarget.has(params)) throw new Error(`An element target is required for ${params.action}`)
}

function validateURL(value: string | undefined) {
  if (!value) throw new Error("URL is required")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("A valid absolute URL is required")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser navigation supports only http:// and https:// URLs")
  }
  return url
}

function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[^a-zA-Z0-9-_]/g, "_")
}

function redactSensitiveValues(value: unknown, key?: string): unknown {
  if (key === "value") return "[REDACTED]"
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValues(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitiveValues(entryValue, entryKey)]),
    )
  }
  return value
}

async function resolvePoint(
  page: Page,
  locator: Locator | undefined,
  input: {
    x?: number
    y?: number
    coordinateMode?: "viewport" | "element" | "normalized"
  },
) {
  const mode = input.coordinateMode ?? (locator ? "element" : "viewport")
  if (mode === "viewport") {
    if (input.x === undefined || input.y === undefined) {
      throw new Error("x and y are required for viewport coordinates")
    }
    return { x: input.x, y: input.y, mode }
  }
  if (!locator) throw new Error(`${mode} coordinates require an element target`)
  const box = await locator.boundingBox()
  if (!box) throw new Error("The coordinate target has no visible bounding box")
  if (mode === "normalized") {
    const x = input.x ?? 0.5
    const y = input.y ?? 0.5
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error("normalized x and y coordinates must be between 0 and 1")
    }
    return { x: box.x + box.width * x, y: box.y + box.height * y, mode, box }
  }
  return {
    x: box.x + (input.x ?? box.width / 2),
    y: box.y + (input.y ?? box.height / 2),
    mode,
    box,
  }
}

function screenshotAttachment(buffer: Buffer, name: string | undefined, ctx: Tool.Context): BrowserAttachment {
  const filename = `${safeName(name, `checkpoint-${Date.now()}`)}.png`
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    filename,
    url: `data:image/png;base64,${buffer.toString("base64")}`,
  }
}

async function runInputSequence(
  page: Page,
  locator: Locator | undefined,
  params: BrowserParameters,
  ctx: Tool.Context,
): Promise<ActionResult> {
  const sequence = params.sequence
  if (!sequence?.length) throw new Error("sequence is required for input_sequence")
  const duration = sequence.reduce((total, event) => {
    if (event.type === "wait" || event.type === "advance") return total + event.duration
    if (event.type === "press" || event.type === "mouse_click") return total + (event.delay ?? 0)
    return total
  }, 0)
  if (duration > MAX_INPUT_SEQUENCE_DURATION) {
    throw new Error(`input_sequence timing exceeds ${MAX_INPUT_SEQUENCE_DURATION}ms`)
  }
  const captureCount = sequence.filter((event) => event.type === "capture").length
  if (captureCount > MAX_INPUT_SEQUENCE_CAPTURES) {
    throw new Error(`input_sequence supports at most ${MAX_INPUT_SEQUENCE_CAPTURES} capture events`)
  }

  const heldKeys = new Set<string>()
  const heldButtons = new Set<"left" | "right" | "middle">()
  const attachments: BrowserAttachment[] = []
  const lines: string[] = []
  let attachmentBytes = 0
  let completed = false
  const point = (event: { x?: number; y?: number }) =>
    resolvePoint(page, locator, {
      x: event.x,
      y: event.y,
      coordinateMode: params.coordinateMode,
    })

  try {
    for (const [index, event] of sequence.entries()) {
      ctx.abort.throwIfAborted()
      switch (event.type) {
        case "wait":
          await withAbort(Bun.sleep(event.duration), ctx.abort)
          break
        case "advance":
          await withAbort(page.clock.runFor(event.duration), ctx.abort)
          break
        case "key_down":
          await page.keyboard.down(event.key)
          heldKeys.add(event.key)
          break
        case "key_up":
          await page.keyboard.up(event.key)
          heldKeys.delete(event.key)
          break
        case "press":
          await page.keyboard.press(event.key, { delay: event.delay })
          break
        case "mouse_move": {
          const resolved = await point(event)
          await page.mouse.move(resolved.x, resolved.y, { steps: event.steps })
          break
        }
        case "mouse_down": {
          const button = event.button ?? "left"
          await page.mouse.down({ button, clickCount: event.clickCount })
          heldButtons.add(button)
          break
        }
        case "mouse_up": {
          const button = event.button ?? "left"
          await page.mouse.up({ button, clickCount: event.clickCount })
          heldButtons.delete(button)
          break
        }
        case "mouse_click": {
          const resolved = await point(event)
          await page.mouse.click(resolved.x, resolved.y, {
            button: event.button ?? "left",
            clickCount: event.clickCount,
            delay: event.delay,
          })
          break
        }
        case "tap": {
          const resolved = await point(event)
          await page.touchscreen.tap(resolved.x, resolved.y)
          break
        }
        case "wheel":
          await page.mouse.wheel(event.deltaX ?? 0, event.deltaY ?? 0)
          break
        case "capture": {
          const buffer = locator ? await locator.screenshot() : await page.screenshot()
          if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
            throw new Error(`Checkpoint ${index + 1} exceeds the screenshot attachment limit`)
          }
          attachmentBytes += buffer.byteLength
          if (attachmentBytes > MAX_INPUT_SEQUENCE_ATTACHMENT_BYTES) {
            throw new Error("input_sequence checkpoint attachments exceed the combined 40 MiB limit")
          }
          attachments.push(screenshotAttachment(buffer, event.name ?? `checkpoint-${index + 1}`, ctx))
          break
        }
      }
      lines.push(`${index + 1}. ${event.type}`)
    }
    completed = true
  } finally {
    if ((params.releaseAtEnd ?? true) || !completed) {
      for (const key of [...heldKeys].reverse()) await page.keyboard.up(key).catch(() => {})
      for (const button of [...heldButtons].reverse()) await page.mouse.up({ button }).catch(() => {})
    }
  }

  return {
    output: `Executed ${sequence.length} timed input event(s).\n${lines.join("\n")}`,
    metadata: {
      eventCount: sequence.length,
      timedDuration: duration,
      captureCount: attachments.length,
      releasedAtEnd: params.releaseAtEnd ?? true,
    },
    attachments,
  }
}

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

async function perform(params: BrowserParameters, ctx: Tool.Context): Promise<ActionResult> {
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
      await page.clock.pauseAt(time)
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

  const needsTarget = [
    "click",
    "tap",
    "type",
    "clear",
    "drag",
    "hover",
    "focus",
    "select_option",
    "check",
    "uncheck",
    "set_files",
    "download",
    "box",
  ].includes(params.action)
  if (needsTarget) targetRequired(params)
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
        } else {
          await page.mouse.up({ button: params.button ?? "left", clickCount: params.clickCount })
        }
      }
      result = {
        output: `Mouse ${action} at (${Math.round(resolved.x)}, ${Math.round(resolved.y)})`,
        metadata: { action, x: resolved.x, y: resolved.y, coordinateMode: resolved.mode, box: resolved.box },
      }
      break
    }
    case "type":
      if (params.text === undefined) throw new Error("text is required for type")
      if (params.delay === undefined) {
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
      if (params.action === "key_down") await page.keyboard.down(params.key)
      else await page.keyboard.up(params.key)
      result = {
        output: `${params.action === "key_down" ? "Held" : "Released"} ${params.key}${locator ? ` on ${BrowserTarget.description(params)}` : ""}`,
      }
      break
    }
    case "input_sequence":
      result = await runInputSequence(page, locator, params, ctx)
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
    case "accessibility":
      result = {
        output: String(
          await (locator ?? page.locator("body")).ariaSnapshot({ timeout: timeout(params), signal: ctx.abort }),
        ).slice(0, MAX_BROWSER_OUTPUT),
        metadata: { format: "aria-snapshot" },
      }
      break
    case "wait":
      if (locator) {
        await locator.waitFor({ state: params.state ?? "visible", timeout: timeout(params), signal: ctx.abort })
        result = { output: `Wait condition met: ${BrowserTarget.description(params)} is ${params.state ?? "visible"}` }
      } else if (params.text) {
        await page
          .getByText(params.text, { exact: params.exact ?? false })
          .first()
          .waitFor({ state: params.state ?? "visible", timeout: timeout(params), signal: ctx.abort })
        result = { output: `Wait condition met for text ${JSON.stringify(params.text)}` }
      } else if (params.url) {
        await page.waitForURL(params.url, { timeout: timeout(params), signal: ctx.abort })
        result = { output: `Wait condition met for URL ${params.url}` }
      } else {
        await page.waitForLoadState(params.loadState ?? "networkidle", { timeout: timeout(params), signal: ctx.abort })
        result = { output: `Page reached ${params.loadState ?? "networkidle"}` }
      }
      break
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
      if (!destination || !BrowserTarget.has(destination)) throw new Error("destination is required for drag")
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

export const BrowserTool = Tool.define("browser", {
  description: `Control a real Chromium browser with semantic, accessible locators and stable snapshot refs.
Use ref, role+accessibleName, label, placeholder, testId, targetText, or CSS selector to target elements.
Supports navigation, assertions, forms, uploads/downloads, dialogs, popups, stable tabs, screenshots attached for vision,
snapshot diffs, cursor-based console/network events, traces, cookies/storage, device/viewport/locale/timezone/geolocation/offline emulation,
canvas-relative mouse/touch coordinates, held keys, deterministic browser clock control, and timed input sequences with visual checkpoints.
Use input_sequence for real-time games: combine simultaneous key_down/key_up events with wait or clock-driven advance events and capture checkpoints.
Bounded multi-step flows reduce round trips. Set returnSnapshot=true after an action to inspect the resulting UI without another call.
The browser stays open between calls. Playwright and Chromium must be installed.`,
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
    try {
      if (params.action === "flow") {
        if (!params.steps?.length) throw new Error("steps is required for flow")
        const outputs: string[] = []
        const steps: Array<Record<string, unknown>> = []
        const attachments: BrowserAttachment[] = []
        for (const [index, raw] of params.steps.entries()) {
          ctx.abort.throwIfAborted()
          const step = BrowserParameters.parse(raw)
          if (step.action === "flow") throw new Error("Nested browser flows are not supported")
          try {
            const value = await perform(step, ctx)
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
            throw new Error(
              `Browser flow failed at step ${index + 1} (${step.action}): ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        const page = await Browser.getPage()
        return {
          output: outputs.join("\n\n").slice(0, MAX_BROWSER_OUTPUT),
          title: "Browser: flow",
          metadata: {
            steps,
            title: (await page.title()).slice(0, 2_000),
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
      throw new Error(
        `Browser action '${params.action}' failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    } finally {
      await restoreFocus?.()
    }
  },
})
