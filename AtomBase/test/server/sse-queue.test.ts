import { describe, expect, test } from "bun:test"
import "../preload"
import { SseQueue } from "@/server/sse-queue"

describe("bounded SSE queue", () => {
  test("fails closed when a slow client accumulates more than 256 events", async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const failures: unknown[] = []
    const queue = SseQueue.create<string>({
      write: () => held,
      bytes: (value) => value.length,
      failed: (error) => failures.push(error),
    })
    for (let index = 0; index < 256; index++) expect(queue.push("event")).toBe(true)
    expect(queue.push("overflow")).toBe(false)
    expect(failures).toHaveLength(1)
    expect(queue.pending()).toEqual({ events: 256, bytes: 256 * "event".length })
    release()
    await queue.flush()
    expect(queue.pending()).toEqual({ events: 0, bytes: 0 })
  })

  test("reports the first write failure and rejects later enqueue attempts", async () => {
    const failures: unknown[] = []
    const queue = SseQueue.create<string>({
      write: async () => {
        throw new Error("disconnected")
      },
      bytes: (value) => value.length,
      failed: (error) => failures.push(error),
    })
    expect(queue.push("first")).toBe(true)
    await queue.flush()
    expect(failures).toHaveLength(1)
    expect(queue.push("late")).toBe(false)
  })
})
