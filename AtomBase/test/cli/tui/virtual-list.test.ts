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

    VirtualWindow.pruneMeasurements(cache, [
      "layout\u0000message-1",
      "layout\u0000message-2",
      "layout\u0000message-3",
    ])

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
})
