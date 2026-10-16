import type { Locator, Page } from "playwright"
import { Identifier } from "@/core/id/id"
import { Tool } from "../tool"
import type { BrowserParameters } from "./schema"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_INPUT_SEQUENCE_ATTACHMENT_BYTES,
  MAX_INPUT_SEQUENCE_CAPTURES,
  MAX_INPUT_SEQUENCE_DURATION,
} from "./schema"
import { resolvePoint, safeName } from "./validation"

export type BrowserAttachment = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime: string
  filename?: string
  url: string
}

export type ActionResult = {
  output: string
  metadata?: Record<string, unknown>
  attachments?: BrowserAttachment[]
}

export type HeldInputs = {
  keys: Set<string>
  buttons: Set<"left" | "right" | "middle">
}

function screenshotAttachment(buffer: Buffer, name: string | undefined, ctx: Tool.Context): BrowserAttachment {
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    filename: `${safeName(name, `checkpoint-${Date.now()}`)}.png`,
    url: `data:image/png;base64,${buffer.toString("base64")}`,
  }
}

export async function runInputSequence(
  page: Page,
  locator: Locator | undefined,
  params: BrowserParameters,
  ctx: Tool.Context,
  flowInputs?: HeldInputs,
): Promise<ActionResult> {
  const sequence = params.sequence
  if (!sequence?.length) throw new Error("sequence is required for input_sequence")
  const duration = sequence.reduce((total, event) => {
    if (event.type === "wait" || event.type === "advance") return total + event.duration
    if (event.type === "press" || event.type === "mouse_click") return total + (event.delay ?? 0)
    return total
  }, 0)
  if (duration > MAX_INPUT_SEQUENCE_DURATION)
    throw new Error(`input_sequence timing exceeds ${MAX_INPUT_SEQUENCE_DURATION}ms`)
  const captureCount = sequence.filter((event) => event.type === "capture").length
  if (captureCount > MAX_INPUT_SEQUENCE_CAPTURES)
    throw new Error(`input_sequence supports at most ${MAX_INPUT_SEQUENCE_CAPTURES} capture events`)

  const heldKeys = new Set<string>()
  const heldButtons = new Set<"left" | "right" | "middle">()
  const attachments: BrowserAttachment[] = []
  const lines: string[] = []
  let attachmentBytes = 0
  let completed = false
  const point = (event: { x?: number; y?: number }) =>
    resolvePoint(page, locator, { x: event.x, y: event.y, coordinateMode: params.coordinateMode })

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
          flowInputs?.keys.add(event.key)
          break
        case "key_up":
          await page.keyboard.up(event.key)
          heldKeys.delete(event.key)
          flowInputs?.keys.delete(event.key)
          break
        case "press":
          await page.keyboard.press(event.key, { delay: event.delay })
          break
        case "mouse_move": {
          const p = await point(event)
          await page.mouse.move(p.x, p.y, { steps: event.steps })
          break
        }
        case "mouse_down": {
          const button = event.button ?? "left"
          await page.mouse.down({ button, clickCount: event.clickCount })
          heldButtons.add(button)
          flowInputs?.buttons.add(button)
          break
        }
        case "mouse_up": {
          const button = event.button ?? "left"
          await page.mouse.up({ button, clickCount: event.clickCount })
          heldButtons.delete(button)
          flowInputs?.buttons.delete(button)
          break
        }
        case "mouse_click": {
          const p = await point(event)
          await page.mouse.click(p.x, p.y, {
            button: event.button ?? "left",
            clickCount: event.clickCount,
            delay: event.delay,
          })
          break
        }
        case "tap": {
          const p = await point(event)
          await page.touchscreen.tap(p.x, p.y)
          break
        }
        case "wheel":
          await page.mouse.wheel(event.deltaX ?? 0, event.deltaY ?? 0)
          break
        case "capture": {
          const buffer = locator ? await locator.screenshot() : await page.screenshot()
          if (buffer.byteLength > MAX_ATTACHMENT_BYTES)
            throw new Error(`Checkpoint ${index + 1} exceeds the screenshot attachment limit`)
          attachmentBytes += buffer.byteLength
          if (attachmentBytes > MAX_INPUT_SEQUENCE_ATTACHMENT_BYTES)
            throw new Error("input_sequence checkpoint attachments exceed the combined 40 MiB limit")
          attachments.push(screenshotAttachment(buffer, event.name ?? `checkpoint-${index + 1}`, ctx))
          break
        }
      }
      lines.push(`${index + 1}. ${event.type}`)
    }
    completed = true
  } finally {
    if ((params.releaseAtEnd ?? true) || !completed) {
      for (const key of [...heldKeys].reverse()) {
        await page.keyboard.up(key).catch(() => {})
        flowInputs?.keys.delete(key)
      }
      for (const button of [...heldButtons].reverse()) {
        await page.mouse.up({ button }).catch(() => {})
        flowInputs?.buttons.delete(button)
      }
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
