import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { Log } from "../../util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const SystemRoute = new Hono()
    .post(
        "/log",
        describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
                200: {
                    description: "Log entry written successfully",
                    content: {
                        "application/json": {
                            schema: resolver(z.boolean()),
                        },
                    },
                },
                ...errors(400),
            },
        }),
        validator(
            "json",
            z.object({
                service: z.string().meta({ description: "Service name for the log entry" }),
                level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
                message: z.string().meta({ description: "Log message" }),
                extra: z
                    .record(z.string(), z.any())
                    .optional()
                    .meta({ description: "Additional metadata for the log entry" }),
            }),
        ),
        async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
                case "debug":
                    logger.debug(message, extra)
                    break
                case "info":
                    logger.info(message, extra)
                    break
                case "error":
                    logger.error(message, extra)
                    break
                case "warn":
                    logger.warn(message, extra)
                    break
            }

            return c.json(true)
        },
    )
    .get(
        "/event",
        describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
                200: {
                    description: "Event stream",
                    content: {
                        "text/event-stream": {
                            schema: resolver(BusEvent.payloads()),
                        },
                    },
                },
            },
        }),
        async (c) => {
            log.info("event connected")
            return streamSSE(c, async (stream) => {
                stream.writeSSE({
                    data: JSON.stringify({
                        type: "server.connected",
                        properties: {},
                    }),
                })
                const unsub = Bus.subscribeAll(async (event) => {
                    await stream.writeSSE({
                        data: JSON.stringify(event),
                    })
                    if (event.type === Bus.InstanceDisposed.type) {
                        stream.close()
                    }
                })

                // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
                const heartbeat = setInterval(() => {
                    stream.writeSSE({
                        data: JSON.stringify({
                            type: "server.heartbeat",
                            properties: {},
                        }),
                    })
                }, 30000)

                stream.onAbort(() => {
                    clearInterval(heartbeat)
                    unsub()
                })
            })
        },
    )
