import type { APIEvent } from "@solidjs/start/server"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { cors } from "hono/cors"
import z from "zod"
import { CompanionAuth } from "@atomcli/companion"

/**
 * POST /companion/pair
 *
 * Registers a mobile device's public key after validating the pairing token.
 * The pairing token is issued by `atomcli serve --companion` and displayed
 * as a QR code. It is single-use and expires after 5 minutes.
 *
 * Request body:
 *   { pairing_token: string, public_key: string, device_name: string }
 *
 * Response (200):
 *   { status: "ok", device_name: string }
 *
 * Response (401):
 *   { error: "invalid_token" }
 */

const app = new Hono().basePath("/companion").use(cors())

app.post(
    "/pair",
    describeRoute({
        summary: "Pair a mobile device",
        description:
            "Validates the one-time pairing token and registers the device's ED25519 public key. " +
            "After pairing, the device can connect via /companion/ws.",
        operationId: "companion.pair",
        responses: {
            200: {
                description: "Device paired successfully",
                content: {
                    "application/json": {
                        schema: resolver(
                            z.object({
                                status: z.literal("ok"),
                                device_name: z.string(),
                            }),
                        ),
                    },
                },
            },
            401: {
                description: "Invalid or expired pairing token",
                content: {
                    "application/json": {
                        schema: resolver(z.object({ error: z.string() })),
                    },
                },
            },
        },
    }),
    validator(
        "json",
        z.object({
            pairing_token: z.string().min(1),
            public_key: z.string().min(1).describe("Raw 32-byte ED25519 public key, Base64-encoded"),
            device_name: z.string().min(1).max(100),
        }),
    ),
    async (c) => {
        const body = c.req.valid("json")

        const valid = CompanionAuth.consumeToken(body.pairing_token)
        if (!valid) {
            return c.json({ error: "invalid_token" }, 401)
        }

        CompanionAuth.registerDevice(body.device_name, body.public_key)

        return c.json({ status: "ok" as const, device_name: body.device_name })
    },
)

/** List paired devices (for debug/admin; should be gated in production). */
app.get(
    "/devices",
    describeRoute({
        summary: "List paired devices",
        operationId: "companion.devices",
        responses: {
            200: {
                description: "List of paired devices",
                content: {
                    "application/json": {
                        schema: resolver(
                            z.array(
                                z.object({
                                    deviceName: z.string(),
                                    pairedAt: z.number(),
                                }),
                            ),
                        ),
                    },
                },
            },
        },
    }),
    (c) => {
        return c.json(
            CompanionAuth.listDevices().map((d) => ({
                deviceName: d.deviceName,
                pairedAt: d.pairedAt,
            })),
        )
    },
)

export function GET(event: APIEvent) {
    return app.fetch(event.request)
}

export function POST(event: APIEvent) {
    return app.fetch(event.request)
}
