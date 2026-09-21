import { describe, expect, test } from "bun:test"
import { VirtualWindow } from "@tui/component/virtual-list"

function uniformPrefix(count: number, height: number) {
  return Array.from({ length: count + 1 }, (_, index) => index * height)
}

describe("VirtualWindow", () => {
  test("keeps a non-empty tail when ScrollBox reports a stale oversized offset", () => {
    const range = VirtualWindow.range(uniformPrefix(100, 10), 100_000, 20, 100, 5)

    expect(range).toEqual({ start: 95, end: 99, total: 100 })
  })

  test("selects the visible rows with bounded overscan", () => {
    const range = VirtualWindow.range(uniformPrefix(100, 10), 350, 30, 100, 2)

    expect(range).toEqual({ start: 33, end: 39, total: 100 })
  })

  test("preserves existing measurements when rows are appended", () => {
    const cache = new Map([
      ["layout\u0000message-1", 12],
      ["layout\u0000message-2", 18],
    ])

    VirtualWindow.pruneMeasurements(cache, ["layout\u0000message-1", "layout\u0000message-2", "layout\u0000message-3"])

    expect([...cache.entries()]).toEqual([
      ["layout\u0000message-1", 12],
      ["layout\u0000message-2", 18],
    ])
  })

  test("drops measurements from a previous wrapping layout", () => {
    const cache = new Map([
      ["wide\u0000message-1", 8],
      ["narrow\u0000message-1", 14],
    ])

    VirtualWindow.pruneMeasurements(cache, ["narrow\u0000message-1"])

    expect([...cache.entries()]).toEqual([["narrow\u0000message-1", 14]])
  })

  test("preserves a manual anchor while 500 streaming messages append", () => {
    const before = uniformPrefix(5_000, 4)
    const after = uniformPrefix(5_500, 4)
    const scrollTop = 2_000 * 4 + 2
    const anchor = VirtualWindow.anchor(before, scrollTop, 5_000)

    expect(anchor).toEqual({ index: 2_000, offset: 2 })
    expect(VirtualWindow.restoreAnchor(after, anchor, 40, 5_500)).toBe(scrollTop)
  })

  test("keeps the same message line when earlier content grows", () => {
    const before = [0, 4, 8, 12, 16]
    const after = [0, 4, 12, 16, 20, 24]
    const anchor = VirtualWindow.anchor(before, 13, 4)

    expect(anchor).toEqual({ index: 3, offset: 1 })
    expect(VirtualWindow.restoreAnchor(after, anchor, 4, 5)).toBe(17)
  })

  test("tail detection survives terminal resize", () => {
    const totalHeight = 20_000
    expect(VirtualWindow.isAtTail(totalHeight - 40, 40, totalHeight)).toBe(true)
    expect(VirtualWindow.isAtTail(totalHeight - 40, 30, totalHeight)).toBe(false)
    expect(VirtualWindow.restoreAnchor([0, totalHeight], { index: 0, offset: totalHeight }, 30, 1)).toBe(
      totalHeight - 30,
    )
  })

  test("detects tail with bounded tolerance when scrolling down near the bottom", () => {
    const totalHeight = 1_000
    const viewportHeight = 40
    const maxScroll = totalHeight - viewportHeight // 960

    // Exactly at bottom
    expect(VirtualWindow.isAtTail(960, viewportHeight, totalHeight)).toBe(true)
    // Within tolerance from scroll wheel/terminal step
    expect(VirtualWindow.isAtTail(958, viewportHeight, totalHeight)).toBe(true)
    expect(VirtualWindow.isAtTail(957, viewportHeight, totalHeight)).toBe(true)
    // Farther above bottom
    expect(VirtualWindow.isAtTail(956, viewportHeight, totalHeight)).toBe(false)
  })
})
