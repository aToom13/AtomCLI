import type { Locator, Page } from "playwright"
import { BrowserTarget } from "../browser-target"
import { ToolNotAppliedError } from "../runtime-error"

export function timeout(params: { timeout?: number }) {
  return params.timeout ?? 30_000
}

export function targetRequired(params: BrowserTarget.Info & { action: string }) {
  if (
    [
      "click",
      "tap",
      "type",
      "fill",
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
    ].includes(params.action) &&
    !BrowserTarget.has(params)
  )
    throw new Error(`An element target is required for ${params.action}`)
}

export function validateURL(value: string | undefined) {
  if (!value) throw new ToolNotAppliedError(new Error("URL is required"))
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ToolNotAppliedError(new Error("A valid absolute URL is required"))
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolNotAppliedError(new Error("Browser navigation supports only http:// and https:// URLs"))
  }
  return url
}

export function safeName(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[^a-zA-Z0-9-_]/g, "_")
}

export function redactSensitiveValues(value: unknown, key?: string): unknown {
  if (key === "value") return "[REDACTED]"
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValues(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitiveValues(entryValue, entryKey)]),
    )
  }
  return value
}

export function pointMode(
  input: {
    x?: number
    y?: number
    coordinateMode?: "viewport" | "element" | "normalized"
  },
  hasTarget: boolean,
) {
  const mode = input.coordinateMode ?? (hasTarget ? "element" : "viewport")
  if (mode === "viewport") {
    if (input.x === undefined || input.y === undefined) {
      throw new Error("x and y are required for viewport coordinates")
    }
  } else if (!hasTarget) throw new Error(`${mode} coordinates require an element target`)
  else if (mode === "normalized") {
    const x = input.x ?? 0.5
    const y = input.y ?? 0.5
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error("normalized x and y coordinates must be between 0 and 1")
    }
  }
  return mode
}

export async function resolvePoint(
  _page: Page,
  locator: Locator | undefined,
  input: { x?: number; y?: number; coordinateMode?: "viewport" | "element" | "normalized" },
) {
  const mode = pointMode(input, !!locator)
  if (mode === "viewport") return { x: input.x, y: input.y, mode }
  const box = await locator.boundingBox()
  if (!box) throw new Error("The coordinate target has no visible bounding box")
  if (mode === "normalized") {
    const x = input.x ?? 0.5
    const y = input.y ?? 0.5
    return { x: box.x + box.width * x, y: box.y + box.height * y, mode, box }
  }
  return {
    x: box.x + (input.x ?? box.width / 2),
    y: box.y + (input.y ?? box.height / 2),
    mode,
    box,
  }
}
