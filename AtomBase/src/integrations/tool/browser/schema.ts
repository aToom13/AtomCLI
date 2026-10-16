import z from "zod"
import { BrowserTarget } from "../browser-target"
import { pointMode, targetRequired } from "./validation"

export const MAX_BROWSER_OUTPUT = 100_000
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const DEFAULT_TIMEOUT = 30_000
export const MAX_FLOW_STEPS = 20
export const MAX_INPUT_SEQUENCE_EVENTS = 200
export const MAX_INPUT_SEQUENCE_DURATION = 120_000
export const MAX_INPUT_SEQUENCE_CAPTURES = 10
export const MAX_INPUT_SEQUENCE_ATTACHMENT_BYTES = 40 * 1024 * 1024

export const Action = z.enum([
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
  "fill",
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

export const Cookie = z.object({
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

export const InputSequenceEvent = z.discriminatedUnion("type", [
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

export const BrowserParameters = z
  .object({
    action: Action.describe(
      "Browser action; assert uses assertion and expected/target, evaluate uses script for JavaScript observation",
    ),
    ...BrowserTarget.Fields,
    url: z.string().max(8_192).optional().describe("Absolute URL for navigation or tab creation"),
    script: z
      .string()
      .max(100_000)
      .optional()
      .describe("JavaScript expression for evaluate; for example document.title or (() => 42)()"),
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
    destination: BrowserTarget.Info.optional().describe(
      "Element destination for dragTo. Use input_sequence for pixel-offset window dragging or resizing.",
    ),
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
      .optional()
      .describe('Assertion to evaluate, for example "text" with expected "Saved" and selector "#status"'),
    expected: z.string().max(100_000).optional().describe("Expected string for URL, text, or value assertions"),
    expectedCount: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Expected number of matching elements for count assertions"),
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
    steps: z
      .array(z.object({ action: Action.exclude(["flow"]) }).passthrough())
      .max(MAX_FLOW_STEPS)
      .optional()
      .describe("Ordered browser actions; each step uses action and the corresponding browser parameters above"),
    sequence: z
      .array(InputSequenceEvent)
      .max(MAX_INPUT_SEQUENCE_EVENTS)
      .optional()
      .describe(
        "Timed keyboard/mouse/capture events. mouse_click requires viewport x/y or an element target; mouse_down/up use the current pointer position.",
      ),
    releaseAtEnd: z.boolean().optional().describe("Release held keys/buttons after input_sequence (default: true)"),
    clockOperation: z
      .enum(["install", "pause", "run_for", "fast_forward", "resume"])
      .optional()
      .describe(
        "Install before game navigation, pause after load, then run_for to advance timers and animation frames",
      ),
    duration: z
      .number()
      .int()
      .min(0)
      .max(MAX_INPUT_SEQUENCE_DURATION)
      .optional()
      .describe(
        "Milliseconds to wait or advance the browser clock; wait also checks any supplied condition after this delay",
      ),
    clockTime: z.union([z.number(), z.string().max(200)]).optional(),
  })
  .superRefine((input, ctx) => {
    try {
      targetRequired(input)
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message })
    }
    if ((input.action === "type" || input.action === "fill") && input.text === undefined)
      ctx.addIssue({ code: "custom", path: ["text"], message: `text is required for ${input.action}` })
    if (input.action === "assert") {
      if (input.assertion === undefined) {
        ctx.addIssue({ code: "custom", path: ["assertion"], message: "assertion is required for assert" })
      } else {
        if (input.assertion !== "url" && !BrowserTarget.has(input)) {
          ctx.addIssue({ code: "custom", message: `An element target is required for ${input.assertion} assertion` })
        }
        if (["url", "text", "value"].includes(input.assertion) && input.expected === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["expected"],
            message: `expected is required for ${input.assertion} assertion`,
          })
        }
        if (input.assertion === "count" && input.expectedCount === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["expectedCount"],
            message: "expectedCount is required for count assertion",
          })
        }
      }
    }
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
    const destination = input.destination ?? (input.targetSelector ? { selector: input.targetSelector } : undefined)
    if (input.action === "drag" && (!destination || !BrowserTarget.has(destination))) {
      ctx.addIssue({ code: "custom", path: ["destination"], message: "destination is required for drag" })
    }
    if (input.action === "input_sequence")
      input.sequence?.forEach((event, index) => {
        if (event.type !== "mouse_move" && event.type !== "mouse_click") return
        try {
          pointMode({ x: event.x, y: event.y, coordinateMode: input.coordinateMode }, BrowserTarget.has(input))
        } catch (error) {
          ctx.addIssue({ code: "custom", path: ["sequence", index], message: (error as Error).message })
        }
      })
  })

export type BrowserParameters = z.infer<typeof BrowserParameters>
