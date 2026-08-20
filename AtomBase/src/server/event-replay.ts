import { GlobalBus } from "@/core/bus/global"

export namespace EventReplay {
  const MAX_EVENTS = 500
  const events: Array<{ sequence: number; event: any }> = []
  const subscribers = new Set<(entry: { sequence: number; event: any }) => void | Promise<void>>()
  let sequence = 0
  let initialized = false

  export function initialize() {
    if (initialized) return
    initialized = true
    GlobalBus.on("event", (event) => {
      const entry = { sequence: ++sequence, event }
      events.push(entry)
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
      for (const subscriber of subscribers) void subscriber(entry)
    })
  }

  export function after(lastSequence: number) {
    return events.filter((entry) => entry.sequence > lastSequence)
  }

  export function subscribe(handler: (entry: { sequence: number; event: any }) => void | Promise<void>) {
    subscribers.add(handler)
    return () => subscribers.delete(handler)
  }

  export function current() {
    return sequence
  }
}
