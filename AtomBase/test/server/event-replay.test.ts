import { describe, expect, test } from "bun:test"
import "../preload"
import { EventReplay } from "@/server/event-replay"
import { GlobalBus } from "@/core/bus/global"

describe("server event replay", () => {
  test("assigns monotonic sequence IDs and replays missed events", async () => {
    EventReplay.initialize()
    const before = EventReplay.current()
    GlobalBus.emit("event", { directory: "test", payload: { type: "test.one", properties: {} } } as any)
    GlobalBus.emit("event", { directory: "test", payload: { type: "test.two", properties: {} } } as any)
    const replay = EventReplay.after(before.sequence)
    expect(replay.map((entry) => entry.sequence)).toEqual([before.sequence + 1, before.sequence + 2])
    expect(replay.map((entry) => entry.event.payload.type)).toEqual(["test.one", "test.two"])
    expect(EventReplay.replay(before)).toMatchObject({ replay: true, entries: replay })
  })

  test("uses process epochs and reports legacy, future and bounded-buffer cursors as resync", () => {
    EventReplay.initialize()
    const before = EventReplay.current()
    expect(EventReplay.parseCursor(String(before.sequence))).toBe("legacy")
    expect(EventReplay.replay("legacy")).toMatchObject({ replay: false, reason: "legacy_cursor" })
    expect(EventReplay.replay({ epoch: "another-process", sequence: before.sequence })).toMatchObject({
      replay: false,
      reason: "epoch_changed",
    })
    expect(EventReplay.replay({ epoch: before.epoch, sequence: before.sequence + 1 })).toMatchObject({
      replay: false,
      reason: "cursor_ahead",
    })
    for (let index = 0; index < 501; index++) {
      GlobalBus.emit("event", {
        directory: "bounded-replay",
        payload: { type: "test.bounded", properties: { index } },
      } as any)
    }
    expect(EventReplay.replay(before)).toMatchObject({ replay: false, reason: "buffer_gap" })
  })
})
