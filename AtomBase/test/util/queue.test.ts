import { describe, expect, test } from "bun:test"
import { AsyncQueue, work } from "@/util/util/queue"

describe("util.queue", () => {
  describe("AsyncQueue", () => {
    test("push adds item to queue", async () => {
      const queue = new AsyncQueue<string>()
      queue.push("hello")

      const result = await queue.next()
      expect(result).toBe("hello")
    })

    test("next waits for item when queue is empty", async () => {
      const queue = new AsyncQueue<string>()

      const promise = queue.next()
      queue.push("world")

      const result = await promise
      expect(result).toBe("world")
    })

    test("maintains order of multiple items", async () => {
      const queue = new AsyncQueue<number>()
      queue.push(1)
      queue.push(2)
      queue.push(3)

      expect(await queue.next()).toBe(1)
      expect(await queue.next()).toBe(2)
      expect(await queue.next()).toBe(3)
    })

    test("handles interleaved push and next", async () => {
      const queue = new AsyncQueue<string>()

      const p1 = queue.next()
      queue.push("a")
      const p2 = queue.next()
      queue.push("b")

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe("a")
      expect(r2).toBe("b")
    })

    test("works with async iterator", async () => {
      const queue = new AsyncQueue<string>()
      queue.push("first")
      queue.push("second")
      queue.push("third")

      const results: string[] = []
      for await (const item of queue) {
        results.push(item)
        if (results.length >= 3) break
      }

      expect(results).toEqual(["first", "second", "third"])
    })
  })

  describe("work", () => {
    test("processes all items with given concurrency", async () => {
      const results: number[] = []
      const items = [1, 2, 3, 4, 5]

      await work(2, items, async (item) => {
        results.push(item)
      })

      expect(results.sort()).toEqual([1, 2, 3, 4, 5])
    })

    test("respects concurrency limit", async () => {
      let running = 0
      let maxRunning = 0
      const items = [1, 2, 3, 4]

      await work(2, items, async (_) => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await new Promise((r) => setTimeout(r, 10))
        running--
      })

      expect(maxRunning).toBe(2)
    })

    test("handles empty array", async () => {
      const results: number[] = []

      await work(2, [], async (item) => {
        results.push(item)
      })

      expect(results).toEqual([])
    })

    test("handles errors in worker function", async () => {
      const items = [1, 2, 3]

      await expect(
        work(2, items, async (item) => {
          if (item === 2) throw new Error("test error")
        }),
      ).rejects.toThrow("test error")
    })
  })
})
