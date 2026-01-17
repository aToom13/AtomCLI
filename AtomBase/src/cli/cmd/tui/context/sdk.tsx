import { createAtomcliClient, type Event } from "@atomcli/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount } from "solid-js"
import { TuiEvent } from "../event"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
}

// Extract TuiEvent types for emitter typing
type TuiEventTypes = {
  [K in keyof typeof TuiEvent as (typeof TuiEvent)[K] extends { type: string } ? (typeof TuiEvent)[K]["type"] : never]:
  (typeof TuiEvent)[K] extends { type: string; properties: infer P }
  ? { type: (typeof TuiEvent)[K]["type"]; properties: import("zod").infer<P & import("zod").ZodType> }
  : never
}

// Combined event types: SDK events + TuiEvents
type AllEventTypes = {
  [key in Event["type"]]: Extract<Event, { type: key }>
} & {
  // TuiEvent types - use 'any' to allow proper type inference in sync.tsx
  [key: string]: { type: string; properties: any }
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string; directory?: string; fetch?: typeof fetch; events?: EventSource }) => {
    const abort = new AbortController()
    const sdk = createAtomcliClient({
      baseUrl: props.url,
      signal: abort.signal,
      directory: props.directory,
      fetch: props.fetch,
    })

    const emitter = createGlobalEmitter<AllEventTypes>()

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    onMount(async () => {
      // If an event source is provided, use it instead of SSE
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        return
      }

      // Fall back to SSE
      while (true) {
        if (abort.signal.aborted) break
        const events = await sdk.event.subscribe(
          {},
          {
            signal: abort.signal,
          },
        )

        for await (const event of events.stream) {
          handleEvent(event)
        }

        // Flush any remaining events
        if (timer) clearTimeout(timer)
        if (queue.length > 0) {
          flush()
        }
      }
    })

    onCleanup(() => {
      abort.abort()
      if (timer) clearTimeout(timer)
    })

    return { client: sdk, event: emitter, url: props.url }
  },
})
