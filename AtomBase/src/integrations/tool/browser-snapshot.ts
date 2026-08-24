import type { Page } from "playwright"

const MAX_SNAPSHOT_TEXT = 20_000

type Heading = { level: string; text: string; frameUrl?: string }
type Interactive = {
  type: string
  ref: string
  label: string
  href?: string
  value?: string
  checked?: boolean
  disabled?: boolean
  selected?: boolean
  expanded?: boolean
  contentEditable?: boolean
  validationMessage?: string
  box?: { x: number; y: number; width: number; height: number }
  inViewport: boolean
  frameUrl?: string
}

export type BrowserSnapshotResult = {
  headings: Heading[]
  interactive: Interactive[]
  text: string
  frameCount: number
}

const previous = new WeakMap<Page, Set<string>>()

export namespace BrowserSnapshot {
  export async function capture(
    page: Page,
    options?: { maxElements?: number; scope?: string },
  ): Promise<BrowserSnapshotResult> {
    const maximum = options?.maxElements ?? 100
    const frames = page.frames()
    const result: BrowserSnapshotResult = { headings: [], interactive: [], text: "", frameCount: frames.length }
    let remaining = maximum

    for (const [frameIndex, frame] of frames.entries()) {
      if (remaining <= 0) break
      const evaluation = frame.evaluate(
        ({ maximum, scope, refBase, maxText }) => {
          const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim()
          const root = scope ? document.querySelector(scope) : document.body
          if (!root) return { headings: [], interactive: [], text: "" }
          const visible = (element: Element) => {
            const node = element as HTMLElement
            const style = window.getComputedStyle(node)
            const box = node.getBoundingClientRect()
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity || "1") > 0 &&
              box.width > 0 &&
              box.height > 0
            )
          }
          const deepElements = (parent: Element | ShadowRoot) => {
            const output: Element[] = []
            for (const element of parent.querySelectorAll("*")) {
              output.push(element)
              if (element.shadowRoot) output.push(...deepElements(element.shadowRoot))
            }
            return output
          }
          const elements = [root, ...deepElements(root)]
          const headings = elements
            .filter((element) => /^H[1-6]$/.test(element.tagName) && visible(element))
            .slice(0, 100)
            .map((element) => ({ level: element.tagName.toLowerCase(), text: clean(element.textContent) }))
            .filter((item) => item.text)
          const interactiveSelector = [
            "a[href]",
            "button",
            "input",
            "select",
            "textarea",
            "summary",
            "[contenteditable]",
            '[role="button"]',
            '[role="link"]',
            '[role="textbox"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="tab"]',
            '[role="combobox"]',
            '[role="listbox"]',
            '[role="option"]',
            '[role="menuitem"]',
            '[role="menuitemcheckbox"]',
            '[role="menuitemradio"]',
            '[role="switch"]',
            '[role="slider"]',
            '[role="spinbutton"]',
            '[role="scrollbar"]',
            '[role="treeitem"]',
            '[role="gridcell"]',
            "[tabindex]",
          ].join(",")
          const win = window as any
          win.__atomcliRefCounter = Math.max(win.__atomcliRefCounter || 0, refBase)
          win.__atomcliRefMap = win.__atomcliRefMap || new WeakMap()
          const refMap = win.__atomcliRefMap as WeakMap<Element, string>
          const usedRefs = new Set(
            elements
              .map((element) => element.getAttribute("data-atomcli-ref"))
              .filter((value): value is string => !!value),
          )
          const interactive = elements
            .filter((element) => element.matches(interactiveSelector) && visible(element))
            .slice(0, maximum)
            .map((element) => {
              const node = element as HTMLInputElement
              let ref = refMap.get(node)
              if (!ref) {
                do ref = `e${++win.__atomcliRefCounter}`
                while (usedRefs.has(ref))
                usedRefs.add(ref)
                refMap.set(node, ref)
                node.setAttribute("data-atomcli-ref", ref)
              }
              const labelledBy = node.getAttribute("aria-labelledby")
              const labelledText = labelledBy
                ? labelledBy
                    .split(/\s+/)
                    .map((id) => clean(document.getElementById(id)?.textContent))
                    .filter(Boolean)
                    .join(" ")
                : ""
              const label = clean(
                node.getAttribute("aria-label") ||
                  labelledText ||
                  node.labels?.[0]?.textContent ||
                  node.textContent ||
                  node.getAttribute("placeholder") ||
                  node.getAttribute("alt") ||
                  node.getAttribute("name"),
              )
              const box = node.getBoundingClientRect()
              const type = node.getAttribute("role") || node.getAttribute("type") || node.tagName.toLowerCase()
              return {
                type,
                ref,
                label,
                href: node instanceof HTMLAnchorElement ? node.href : undefined,
                value: "value" in node && typeof node.value === "string" ? node.value.slice(0, 2_000) : undefined,
                checked: element instanceof HTMLInputElement ? element.checked : undefined,
                disabled:
                  ("disabled" in element && Boolean((element as HTMLInputElement).disabled)) ||
                  element.getAttribute("aria-disabled") === "true",
                selected: element instanceof HTMLOptionElement ? element.selected : undefined,
                expanded: node.hasAttribute("aria-expanded")
                  ? node.getAttribute("aria-expanded") === "true"
                  : undefined,
                contentEditable: node.isContentEditable || undefined,
                validationMessage:
                  "validationMessage" in node && typeof node.validationMessage === "string" && node.validationMessage
                    ? node.validationMessage.slice(0, 2_000)
                    : undefined,
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                inViewport:
                  box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth,
              }
            })
          return {
            headings,
            interactive,
            text: clean((root as HTMLElement).innerText ?? root.textContent).slice(0, maxText),
          }
        },
        { maximum: remaining, scope: options?.scope, refBase: frameIndex * 100_000, maxText: MAX_SNAPSHOT_TEXT },
      )
      const frameResult = frame === page.mainFrame() ? await evaluation : await evaluation.catch(() => undefined)
      if (!frameResult) continue
      const frameUrl = frame === page.mainFrame() ? undefined : frame.url().slice(0, 8_192)
      result.headings.push(...frameResult.headings.map((item) => ({ ...item, frameUrl })))
      result.interactive.push(...frameResult.interactive.map((item) => ({ ...item, frameUrl })))
      remaining -= frameResult.interactive.length
      if (frameResult.text && result.text.length < MAX_SNAPSHOT_TEXT) {
        const prefix = frameUrl ? `[iframe ${frameUrl}]\n` : ""
        result.text += `${result.text ? "\n" : ""}${prefix}${frameResult.text}`
        result.text = result.text.slice(0, MAX_SNAPSHOT_TEXT)
      }
    }
    return result
  }

  function signature(item: Interactive) {
    return JSON.stringify({
      frameUrl: item.frameUrl,
      ref: item.ref,
      type: item.type,
      label: item.label,
      value: item.value,
      checked: item.checked,
      disabled: item.disabled,
      selected: item.selected,
      expanded: item.expanded,
      validationMessage: item.validationMessage,
    })
  }

  export function diff(page: Page, snapshot: BrowserSnapshotResult) {
    const current = new Set(snapshot.interactive.map(signature))
    const before = previous.get(page) ?? new Set<string>()
    previous.set(page, current)
    return {
      added: [...current].filter((item) => !before.has(item)).map((item) => JSON.parse(item) as Interactive),
      removed: [...before].filter((item) => !current.has(item)).map((item) => JSON.parse(item) as Interactive),
      baseline: before.size === 0,
    }
  }

  export function remember(page: Page, snapshot: BrowserSnapshotResult) {
    previous.set(page, new Set(snapshot.interactive.map(signature)))
  }

  export function format(snapshot: BrowserSnapshotResult) {
    const lines = ["# Visible page snapshot"]
    if (snapshot.headings.length > 0) {
      lines.push(
        "",
        "## Headings",
        ...snapshot.headings.map(
          (item) => `- ${item.level}: ${item.text}${item.frameUrl ? ` [frame=${item.frameUrl}]` : ""}`,
        ),
      )
    }
    if (snapshot.interactive.length > 0) {
      lines.push(
        "",
        "## Interactive elements",
        ...snapshot.interactive.map((item) => {
          const state = [
            item.value ? `value=${JSON.stringify(item.value)}` : "",
            item.checked !== undefined ? `checked=${item.checked}` : "",
            item.disabled ? "disabled" : "",
            item.selected ? "selected" : "",
            item.expanded !== undefined ? `expanded=${item.expanded}` : "",
            item.validationMessage ? `validation=${JSON.stringify(item.validationMessage)}` : "",
            item.inViewport ? "in-viewport" : "below-viewport",
            item.box
              ? `box=${Math.round(item.box.x)},${Math.round(item.box.y)},${Math.round(item.box.width)}x${Math.round(item.box.height)}`
              : "",
          ].filter(Boolean)
          return `- [ref=${item.ref}] ${item.type}${item.label ? ` ${JSON.stringify(item.label)}` : ""}${state.length ? ` (${state.join(", ")})` : ""}${item.href ? ` — ${item.href}` : ""}${item.frameUrl ? ` [frame=${item.frameUrl}]` : ""}`
        }),
      )
    }
    if (snapshot.text) lines.push("", "## Visible text", snapshot.text)
    return lines.join("\n")
  }
}
