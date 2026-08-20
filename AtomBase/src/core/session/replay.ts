import { createHash } from "node:crypto"
import z from "zod"
import { Storage } from "@/core/storage/storage"

export namespace SessionReplay {
  export const Envelope = z.object({
    requestID: z.string(),
    sessionID: z.string(),
    timestamp: z.number().int(),
    systemHash: z.string(),
    system: z.array(z.string()),
    messages: z.array(z.any()),
    tools: z.array(z.object({ id: z.string(), description: z.string().optional(), schema: z.any().optional() })),
    route: z.object({ providerID: z.string(), modelID: z.string(), agent: z.string() }),
    pluginTransforms: z.array(z.string()),
    compactionCheckpoint: z.string().optional(),
    injectedContext: z.array(z.string()).default([]),
  })
  export type Envelope = z.infer<typeof Envelope>

  export const Event = z.discriminatedUnion("type", [
    z.object({
      id: z.string(),
      type: z.literal("tool.call"),
      timestamp: z.number().int(),
      sessionID: z.string(),
      callID: z.string(),
      tool: z.string(),
      args: z.any(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("tool.result"),
      timestamp: z.number().int(),
      sessionID: z.string(),
      callID: z.string(),
      tool: z.string(),
      result: z.any(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("tool.error"),
      timestamp: z.number().int(),
      sessionID: z.string(),
      callID: z.string(),
      tool: z.string(),
      error: z.string(),
    }),
  ])
  export type Event = z.infer<typeof Event>

  function json<T>(value: T): T {
    const seen = new WeakSet<object>()
    return JSON.parse(
      JSON.stringify(value, (_key, current) => {
        if (typeof current === "bigint") return current.toString()
        if (typeof current === "function") return undefined
        if (current instanceof Uint8Array) return { type: "bytes", base64: Buffer.from(current).toString("base64") }
        if (current && typeof current === "object") {
          if (seen.has(current)) return "[Circular]"
          seen.add(current)
        }
        return current
      }),
    )
  }

  export async function record(input: Omit<Envelope, "requestID" | "timestamp" | "systemHash">) {
    const envelope = Envelope.parse({
      ...json(input),
      requestID: `request-${crypto.randomUUID()}`,
      timestamp: Date.now(),
      systemHash: createHash("sha256").update(input.system.join("\n\n")).digest("hex"),
    })
    await Storage.write(["request", input.sessionID, envelope.requestID], envelope)
    return envelope
  }

  export async function get(sessionID: string, requestID: string) {
    return Envelope.parse(await Storage.read(["request", sessionID, requestID]))
  }

  export async function list(sessionID: string) {
    const keys = await Storage.list(["request", sessionID])
    return Promise.all(keys.map((key) => Storage.read<Envelope>(key).then((value) => Envelope.parse(value))))
  }

  export async function renderModelInput(sessionID: string, requestID: string) {
    const envelope = await get(sessionID, requestID)
    return { system: envelope.system, messages: envelope.messages, tools: envelope.tools, route: envelope.route }
  }

  export async function append(event: Record<string, any> & { type: Event["type"]; sessionID: string }) {
    const value = Event.parse({ ...json(event), id: `event-${crypto.randomUUID()}`, timestamp: Date.now() })
    await Storage.write(["session_event", event.sessionID, value.id], value)
    return value
  }
}
