import { describe, expect, test } from "bun:test"
import { EventReplay } from "@/server/event-replay"
import { GlobalBus } from "@/core/bus/global"

describe("server event replay", () => {
  test("assigns monotonic sequence IDs and replays missed events", async () => {
    EventReplay.initialize()
    const before = EventReplay.current()
    GlobalBus.emit("event", { directory: "test", payload: { type: "test.one", properties: {} } } as any)
    GlobalBus.emit("event", { directory: "test", payload: { type: "test.two", properties: {} } } as any)
    const replay = EventReplay.after(before)
    expect(replay.map((entry) => entry.sequence)).toEqual([before + 1, before + 2])
    expect(replay.map((entry) => entry.event.payload.type)).toEqual(["test.one", "test.two"])
  })
})
