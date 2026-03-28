import { describe, it, expect } from "bun:test"
import { formatDate } from "./date"

describe("date utils", () => {
  it("formats date correctly", () => {
    const date = new Date("2026-02-16T14:30:00")
    const result = formatDate(date)
    expect(result).toBe("16.02.2026 14:30")
  })

  it("pads single digit day and month with zero", () => {
    const date = new Date("2026-01-05T09:05:00")
    const result = formatDate(date)
    expect(result).toBe("05.01.2026 09:05")
  })
})
