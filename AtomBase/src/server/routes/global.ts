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

const log = Log.create({ service: "server.global" })

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
                                z.object({
                                    sequence: z.number().int().nonnegative(),
                                    directory: z.string(),
                                    payload: BusEvent.payloads(),
                                }).meta({ ref: "GlobalEvent" }),
                            ),
                        },
                    },
                },
            },
        }),
        async (c) => {
            EventReplay.initialize()
            const requestedSequence = Number.parseInt(c.req.header("last-event-id") ?? "0", 10)
            const lastSequence = Number.isSafeInteger(requestedSequence) && requestedSequence >= 0 ? requestedSequence : 0
            log.info("global event connected")
            return streamSSE(c, async (stream) => {
                let writes = Promise.resolve()
                let replaying = true
                let replayedThrough = lastSequence
                const pending: Array<{ sequence: number; event: any }> = []
                const write = (entry: { sequence: number; event: any }) => {
                    writes = writes.then(() => stream.writeSSE({
                        id: String(entry.sequence),
                        data: JSON.stringify({ ...entry.event, sequence: entry.sequence }),
                    }))
                }
                async function handler(entry: { sequence: number; event: any }) {
                    if (replaying) {
                        pending.push(entry)
                        return
                    }
                    write(entry)
                }
                const unsubscribe = EventReplay.subscribe(handler)
                for (const entry of EventReplay.after(lastSequence)) {
                    replayedThrough = Math.max(replayedThrough, entry.sequence)
                    write(entry)
                }
                replaying = false
                for (const entry of pending) {
                    if (entry.sequence <= replayedThrough) continue
                    replayedThrough = entry.sequence
                    write(entry)
                }
                const connectedSequence = EventReplay.current()
                write({
                    sequence: connectedSequence,
                    event: { directory: "global", payload: { type: "server.connected", properties: {} } },
                })
                await writes
                const heartbeat = setInterval(() => {
                    const sequence = EventReplay.current()
                    write({ sequence, event: { directory: "global", payload: { type: "server.heartbeat", properties: {} } } })
                }, 30000)
                await new Promise<void>((resolve) => {
                    stream.onAbort(() => {
                        clearInterval(heartbeat)
                        unsubscribe()
                        resolve()
                        log.info("global event disconnected")
                    })
                })
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
