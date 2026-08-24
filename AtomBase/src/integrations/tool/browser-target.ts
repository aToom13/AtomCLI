import z from "zod"
import type { Locator, Page } from "playwright"

export namespace BrowserTarget {
  export const Role = z.enum([
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "marquee",
    "math",
    "meter",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem",
  ])

  export const Fields = {
    selector: z.string().max(4096).optional().describe("CSS selector for the target element"),
    ref: z
      .string()
      .regex(/^e\d+$/)
      .optional()
      .describe("Stable element reference returned by snapshot, for example e12"),
    role: Role.optional().describe("Accessible role used to locate the element"),
    accessibleName: z.string().max(1_000).optional().describe("Accessible name used together with role"),
    label: z.string().max(1_000).optional().describe("Associated form label used to locate the element"),
    placeholder: z.string().max(1_000).optional().describe("Placeholder used to locate the element"),
    testId: z.string().max(1_000).optional().describe("data-testid value used to locate the element"),
    targetText: z.string().max(10_000).optional().describe("Visible text used to locate the element"),
    frameUrl: z
      .string()
      .max(8192)
      .optional()
      .describe("Limit the target to a child iframe whose URL contains this value; the main page is never matched"),
    exact: z.boolean().optional().describe("Use exact semantic text/name matching (default: false)"),
  }

  export const Info = z.object(Fields).superRefine((input, ctx) => {
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
  export type Info = z.infer<typeof Info>

  export function has(input: Info) {
    return !!(
      input.ref ||
      input.selector ||
      input.role ||
      input.label ||
      input.placeholder ||
      input.testId ||
      input.targetText
    )
  }

  export async function locator(page: Page, input: Info): Promise<Locator> {
    const frames = input.frameUrl
      ? page.frames().filter((candidate) => candidate !== page.mainFrame() && candidate.url().includes(input.frameUrl!))
      : []
    if (frames.length > 1) {
      throw new Error(
        `${frames.length} child iframe URLs contain ${JSON.stringify(input.frameUrl)}; use a more specific frameUrl`,
      )
    }
    const root = input.frameUrl ? frames[0] : page
    if (!root) {
      const available = page
        .frames()
        .filter((candidate) => candidate !== page.mainFrame())
        .map((candidate) => candidate.url())
      throw new Error(
        `No child iframe URL contains ${JSON.stringify(input.frameUrl)}${available.length ? `; available iframe URLs: ${available.join(", ")}` : "; the page has no child iframes"}`,
      )
    }
    if (input.ref) return root.locator(`[data-atomcli-ref="${input.ref}"]`)
    if (input.selector) return root.locator(input.selector)
    if (input.role) {
      return root.getByRole(input.role, {
        name: input.accessibleName,
        exact: input.exact ?? false,
      })
    }
    if (input.label) return root.getByLabel(input.label, { exact: input.exact ?? false })
    if (input.placeholder) return root.getByPlaceholder(input.placeholder, { exact: input.exact ?? false })
    if (input.testId) return root.getByTestId(input.testId)
    if (input.targetText) return root.getByText(input.targetText, { exact: input.exact ?? false })
    throw new Error("An element target is required (ref, selector, role, label, placeholder, testId, or targetText)")
  }

  export function description(input: Info) {
    const frame = input.frameUrl ? ` frame=${JSON.stringify(input.frameUrl)}` : ""
    if (input.ref) return `ref=${input.ref}${frame}`
    if (input.selector) return `${input.selector}${frame}`
    if (input.role)
      return `role=${input.role}${input.accessibleName ? ` name=${JSON.stringify(input.accessibleName)}` : ""}${frame}`
    if (input.label) return `label=${JSON.stringify(input.label)}${frame}`
    if (input.placeholder) return `placeholder=${JSON.stringify(input.placeholder)}${frame}`
    if (input.testId) return `testId=${JSON.stringify(input.testId)}${frame}`
    if (input.targetText) return `text=${JSON.stringify(input.targetText)}${frame}`
    return input.frameUrl ? `frame=${JSON.stringify(input.frameUrl)}` : "page"
  }
}
