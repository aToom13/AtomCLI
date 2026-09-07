import { afterEach, describe, expect, test } from "bun:test"
import "../preload"
import { EventReplay } from "@/server/event-replay"
import { Server } from "@/server/server"

const servers: Array<ReturnType<typeof Server.listen>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

describe("SSE lifecycle", () => {
  test("removes the global replay subscriber when the client aborts", async () => {
    EventReplay.initialize()
    const baseline = EventReplay.subscriberCount()
    const server = Server.listen({ hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const controller = new AbortController()
    const response = await fetch(`http://127.0.0.1:${server.port}/global/event`, {
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(EventReplay.subscriberCount()).toBe(baseline + 1)

    controller.abort()
    await reader.cancel().catch(() => {})
    for (let attempt = 0; attempt < 50 && EventReplay.subscriberCount() !== baseline; attempt++) {
      await Bun.sleep(10)
    }
    expect(EventReplay.subscriberCount()).toBe(baseline)
  })
})
