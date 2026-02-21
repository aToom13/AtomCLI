import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { streamSSE } from "hono/streaming"
import { BusEvent } from "@/core/bus/bus-event"
import { GlobalBus } from "@/core/bus/global"
import { Instance } from "@/services/project/instance"
import { Installation } from "@/services/installation"
import { Log } from "@/util/util/log"

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
            log.info("global event connected")
            return streamSSE(c, async (stream) => {
                stream.writeSSE({
                    data: JSON.stringify({
                        payload: { type: "server.connected", properties: {} },
                    }),
                })
                async function handler(event: any) {
                    await stream.writeSSE({ data: JSON.stringify(event) })
                }
                GlobalBus.on("event", handler)
                const heartbeat = setInterval(() => {
                    stream.writeSSE({
                        data: JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } }),
                    })
                }, 30000)
                await new Promise<void>((resolve) => {
                    stream.onAbort(() => {
                        clearInterval(heartbeat)
                        GlobalBus.off("event", handler)
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
