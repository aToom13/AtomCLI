import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Info, Part } from "./types"

export const MessageEvents = {
    Updated: BusEvent.define(
        "message.updated",
        z.object({
            info: Info,
        }),
    ),
    Removed: BusEvent.define(
        "message.removed",
        z.object({
            sessionID: z.string(),
            messageID: z.string(),
        }),
    ),
    PartUpdated: BusEvent.define(
        "message.part.updated",
        z.object({
            part: Part,
            delta: z.string().optional(),
        }),
    ),
    PartRemoved: BusEvent.define(
        "message.part.removed",
        z.object({
            sessionID: z.string(),
            messageID: z.string(),
            partID: z.string(),
        }),
    ),
}
