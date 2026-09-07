import { GlobalBus } from "@/core/bus/global"

export namespace EventReplay {
  const MAX_EVENTS = 500
  const MAX_BYTES = 2 * 1024 * 1024
  const epoch = crypto.randomUUID()
  const events: Array<{ sequence: number; bytes: number; event: any }> = []
  const subscribers = new Set<(entry: Entry) => void | Promise<void>>()
  let retainedBytes = 0
  let sequence = 0
  let initialized = false

  export type Entry = { sequence: number; event: any }
  export type Cursor = { epoch: string; sequence: number }
  export type Replay =
    | { replay: true; cursor: Cursor; entries: Entry[] }
    | { replay: false; cursor: Cursor; reason: "epoch_changed" | "cursor_ahead" | "buffer_gap" | "legacy_cursor" }

  export function initialize() {
    if (initialized) return
    initialized = true
    GlobalBus.on("event", (event) => {
      const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
      const stored = { sequence: ++sequence, bytes, event }
      events.push(stored)
      retainedBytes += bytes
      while (events.length > MAX_EVENTS || retainedBytes > MAX_BYTES) {
        const removed = events.shift()
        if (!removed) break
        retainedBytes -= removed.bytes
      }
      const entry = { sequence: stored.sequence, event: stored.event }
      for (const subscriber of subscribers) void subscriber(entry)
    })
  }

  export function parseCursor(value: string | undefined): Cursor | "legacy" | undefined {
    if (!value) return
    if (/^\d+$/.test(value)) return "legacy"
    const split = value.lastIndexOf(":")
    if (split <= 0) return "legacy"
    const parsed = Number.parseInt(value.slice(split + 1), 10)
    if (!Number.isSafeInteger(parsed) || parsed < 0) return "legacy"
    return { epoch: value.slice(0, split), sequence: parsed }
  }

  export function replay(cursor?: Cursor | "legacy"): Replay {
    const currentCursor = current()
    if (cursor === "legacy") return { replay: false, cursor: currentCursor, reason: "legacy_cursor" }
    if (!cursor) return { replay: true, cursor: currentCursor, entries: [] }
    if (cursor.epoch !== epoch) return { replay: false, cursor: currentCursor, reason: "epoch_changed" }
    if (cursor.sequence > sequence) return { replay: false, cursor: currentCursor, reason: "cursor_ahead" }
    const oldest = events[0]?.sequence
    if (oldest !== undefined && cursor.sequence < oldest - 1) {
      return { replay: false, cursor: currentCursor, reason: "buffer_gap" }
    }
    return {
      replay: true,
      cursor: currentCursor,
      entries: events
        .filter((entry) => entry.sequence > cursor.sequence)
        .map((entry) => ({ sequence: entry.sequence, event: entry.event })),
    }
  }

  export function after(lastSequence: number) {
    return events
      .filter((entry) => entry.sequence > lastSequence)
      .map((entry) => ({ sequence: entry.sequence, event: entry.event }))
  }

  export function subscribe(handler: (entry: Entry) => void | Promise<void>) {
    subscribers.add(handler)
    return () => subscribers.delete(handler)
  }

  export function current() {
    return { epoch, sequence }
  }

  export function subscriberCount() {
    return subscribers.size
  }
}
