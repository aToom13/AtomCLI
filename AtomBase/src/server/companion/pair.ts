import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { CompanionAuth, CompanionIdentity, MobileBridge } from "@atomcli/companion"
import { Instance } from "@/services/project/instance"

/**
 * HTTP companion pair endpoint (for AtomBase server).
 * Mirrors the same logic in enterprise's /companion/pair for completeness.
 */
export const CompanionPairRoute = new Hono().post(
  "/companion/pair",
  describeRoute({
    summary: "Pair a mobile device",
    operationId: "companion.pair",
    responses: {
      200: {
        description: "Device paired",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                status: z.literal("ok"),
                device_id: z.string(),
                machine_id: z.string().uuid(),
                machine_name: z.string(),
                process_id: z.string().uuid(),
                bridge_id: z.string().uuid(),
                project_directory: z.string(),
              }),
            ),
          },
        },
      },
      401: {
        description: "Invalid token",
        content: { "application/json": { schema: resolver(z.object({ error: z.string() })) } },
      },
    },
  }),
  validator(
    "json",
    z.object({
      pairing_token: z.string().min(1),
      public_key: z.string().min(1),
      device_name: z.string().min(1).max(100),
      device_id: z.string().min(1).max(128).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid("json")
    const valid = CompanionAuth.consumeToken(body.pairing_token)
    if (!valid) return c.json({ error: "invalid_token" }, 401)
    const device = CompanionAuth.registerDevice(body.device_name, body.public_key, body.device_id)
    const machine = CompanionIdentity.machine()
    return c.json({
      status: "ok" as const,
      device_id: device.deviceId ?? device.deviceName,
      machine_id: machine.machineId,
      machine_name: machine.machineName,
      process_id: CompanionIdentity.processId(),
      bridge_id: MobileBridge.bridgeId(),
      project_directory: Instance.directory,
    })
  },
)
