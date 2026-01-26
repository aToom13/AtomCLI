import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export namespace FileEvent {
    export const Edited = BusEvent.define(
        "file.edited",
        z.object({
            file: z.string(),
        }),
    )
}
