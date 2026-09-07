import "../../preload"
import { describe, expect, test } from "bun:test"
import { Pty } from "@/interfaces/pty"

describe("PTY subscriber cleanup", () => {
  test("closes every subscriber and clears the set when a PTY terminates", () => {
    const closed: string[] = []
    const subscribers = new Set([
      { close: () => closed.push("first") },
      {
        close: () => {
          closed.push("second")
          throw new Error("already closed")
        },
      },
      { close: () => closed.push("third") },
    ])

    Pty._internals.closeSubscribers({ subscribers: subscribers as any })

    expect(closed).toEqual(["first", "second", "third"])
    expect(subscribers.size).toBe(0)
  })
})
