import { describe, expect, test } from "bun:test"
import { DialogLayout } from "@tui/ui/dialog"
import { DialogSelectLayout } from "@tui/ui/dialog-select"

describe("responsive dialog layout", () => {
  test("keeps centered dialogs inside the terminal", () => {
    expect(DialogLayout.maxHeight(1)).toBe(1)
    expect(DialogLayout.maxHeight(20)).toBe(18)
    expect(DialogLayout.maxHeight(40)).toBe(38)
  })

  test("always reserves a usable list viewport", () => {
    expect(DialogSelectLayout.listHeight(100, 16)).toBe(2)
    expect(DialogSelectLayout.listHeight(100, 24)).toBe(6)
    expect(DialogSelectLayout.listHeight(3, 40)).toBe(3)
  })

  test("scrolls down when the highlighted row passes the viewport", () => {
    expect(
      DialogSelectLayout.visibleScrollTop({
        scrollTop: 4,
        viewportTop: 10,
        viewportHeight: 6,
        targetTop: 17,
        targetHeight: 1,
      }),
    ).toBe(6)
  })

  test("keeps culled zero-height rows inside the viewport", () => {
    expect(
      DialogSelectLayout.visibleScrollTop({
        scrollTop: 4,
        viewportTop: 10,
        viewportHeight: 6,
        targetTop: 16,
        targetHeight: 0,
      }),
    ).toBe(5)
  })

  test("scrolls up and clamps at the start", () => {
    expect(
      DialogSelectLayout.visibleScrollTop({
        scrollTop: 2,
        viewportTop: 10,
        viewportHeight: 6,
        targetTop: 7,
        targetHeight: 1,
      }),
    ).toBe(0)
  })

  test("does not move when the highlighted row is visible", () => {
    expect(
      DialogSelectLayout.visibleScrollTop({
        scrollTop: 4,
        viewportTop: 10,
        viewportHeight: 6,
        targetTop: 13,
        targetHeight: 1,
      }),
    ).toBe(4)
  })
})
