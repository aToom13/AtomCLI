const MAX_PENDING_EVENTS = 256
const MAX_PENDING_BYTES = 2 * 1024 * 1024

export namespace SseQueue {
  export function create<T>(input: {
    write(value: T): Promise<unknown>
    bytes(value: T): number
    failed(error: unknown): void
  }) {
    let tail = Promise.resolve()
    let pendingEvents = 0
    let pendingBytes = 0
    let stopped = false

    return {
      push(value: T) {
        if (stopped) return false
        const bytes = input.bytes(value)
        if (pendingEvents + 1 > MAX_PENDING_EVENTS || pendingBytes + bytes > MAX_PENDING_BYTES) {
          stopped = true
          input.failed(new Error("SSE client queue exceeded its bounded capacity"))
          return false
        }
        pendingEvents++
        pendingBytes += bytes
        tail = tail
          .then(() => input.write(value))
          .then(() => {})
          .catch((error) => {
            if (stopped) return
            stopped = true
            input.failed(error)
          })
          .finally(() => {
            pendingEvents--
            pendingBytes -= bytes
          })
        return true
      },
      async flush() {
        await tail
      },
      stop() {
        stopped = true
      },
      pending() {
        return { events: pendingEvents, bytes: pendingBytes }
      },
    }
  }
}
