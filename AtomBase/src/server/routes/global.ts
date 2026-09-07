import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { streamSSE } from "hono/streaming"
import { BusEvent } from "@/core/bus/bus-event"
import { GlobalBus } from "@/core/bus/global"
import { Instance } from "@/services/project/instance"
import { Installation } from "@/services/installation"
import { Log } from "@/util/util/log"
import { EventReplay } from "../event-replay"
import { SseQueue } from "../sse-queue"

const log = Log.create({ service: "server.global" })
const MAX_PENDING_EVENTS = 256
const MAX_PENDING_BYTES = 2 * 1024 * 1024

export const GlobalRoute = new Hono()
  .get(
    "/health",
    describeRoute({
      summary: "Get health",
      description: "Get health information about the AtomCLI server.",
      operationId: "global.health",
      responses: {
        200: {
          description: "Health information",
          content: {
            "application/json": {
              schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({ healthy: true, version: Installation.VERSION })
    },
  )
  .get(
    "/event",
    describeRoute({
      summary: "Get global events",
      description: "Subscribe to global events from the AtomCLI system using server-sent events.",
      operationId: "global.event",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z
                  .object({
                    sequence: z.number().int().nonnegative(),
                    directory: z.string(),
                    payload: BusEvent.payloads(),
                  })
                  .meta({ ref: "GlobalEvent" }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      EventReplay.initialize()
      const requestedCursor = EventReplay.parseCursor(c.req.header("last-event-id"))
      log.info("global event connected")
      return streamSSE(c, async (stream) => {
        let closed = false
        let replaying = true
        let pendingBytes = 0
        let heartbeat: ReturnType<typeof setInterval> | undefined
        let unsubscribe = () => {}
        let resolveDone = () => {}
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve
        })
        const finish = () => {
          if (closed) return
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          unsubscribe()
          writer.stop()
          try {
            stream.close()
          } catch {}
          resolveDone()
          log.info("global event disconnected")
        }
        const writer = SseQueue.create<{ id: string; data: string }>({
          write: (value) => stream.writeSSE(value),
          bytes: (value) => new TextEncoder().encode(value.data).byteLength,
          failed: finish,
        })
        const write = (entry: { sequence: number; event: any }, epoch: string) =>
          writer.push({
            id: `${epoch}:${entry.sequence}`,
            data: JSON.stringify({ ...entry.event, epoch, sequence: entry.sequence }),
          })
        const pending: Array<{ sequence: number; event: any; bytes: number }> = []
        const overflow = () => {
          const cursor = EventReplay.current()
          writer.push({
            id: `${cursor.epoch}:${cursor.sequence}`,
            data: JSON.stringify({
              directory: "global",
              epoch: cursor.epoch,
              sequence: cursor.sequence,
              payload: {
                type: "server.resync_required",
                properties: { reason: "client_overflow", ...cursor },
              },
            }),
          })
          void writer.flush().finally(finish)
        }
        async function handler(entry: EventReplay.Entry) {
          if (replaying) {
            const bytes = new TextEncoder().encode(JSON.stringify(entry.event)).byteLength
            if (pending.length + 1 > MAX_PENDING_EVENTS || pendingBytes + bytes > MAX_PENDING_BYTES) {
              overflow()
              return
            }
            pending.push({ ...entry, bytes })
            pendingBytes += bytes
            return
          }
          const cursor = EventReplay.current()
          write(entry, cursor.epoch)
        }
        unsubscribe = EventReplay.subscribe(handler)
        stream.onAbort(finish)
        try {
          const replay = EventReplay.replay(requestedCursor)
          let replayedThrough = replay.cursor.sequence
          if (replay.replay) {
            replayedThrough =
              requestedCursor && requestedCursor !== "legacy" ? requestedCursor.sequence : replay.cursor.sequence
            for (const entry of replay.entries) {
              replayedThrough = Math.max(replayedThrough, entry.sequence)
              if (!write(entry, replay.cursor.epoch)) break
            }
          } else if ("reason" in replay) {
            writer.push({
              id: `${replay.cursor.epoch}:${replay.cursor.sequence}`,
              data: JSON.stringify({
                directory: "global",
                epoch: replay.cursor.epoch,
                sequence: replay.cursor.sequence,
                payload: {
                  type: "server.resync_required",
                  properties: { reason: replay.reason, ...replay.cursor },
                },
              }),
            })
          }
          replaying = false
          for (const entry of pending) {
            if (entry.sequence <= replayedThrough) continue
            replayedThrough = entry.sequence
            if (!write(entry, replay.cursor.epoch)) break
          }
          pending.length = 0
          pendingBytes = 0
          const connected = EventReplay.current()
          writer.push({
            id: `${connected.epoch}:${connected.sequence}`,
            data: JSON.stringify({
              directory: "global",
              epoch: connected.epoch,
              sequence: connected.sequence,
              payload: { type: "server.connected", properties: connected },
            }),
          })
          await writer.flush()
          if (closed) return
          heartbeat = setInterval(() => {
            const cursor = EventReplay.current()
            writer.push({
              id: `${cursor.epoch}:${cursor.sequence}`,
              data: JSON.stringify({
                directory: "global",
                epoch: cursor.epoch,
                sequence: cursor.sequence,
                payload: { type: "server.heartbeat", properties: cursor },
              }),
            })
          }, 30000)
          await done
        } finally {
          finish()
        }
      })
    },
  )
  .post(
    "/dispose",
    describeRoute({
      summary: "Dispose instance",
      description: "Clean up and dispose all AtomCLI instances, releasing all resources.",
      operationId: "global.dispose",
      responses: {
        200: {
          description: "Global disposed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    async (c) => {
      await Instance.disposeAll()
      GlobalBus.emit("event", {
        directory: "global",
        payload: { type: "global.disposed", properties: {} },
      })
      return c.json(true)
    },
  )
