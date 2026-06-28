import { BusEvent } from "@/core/bus/bus-event"
import z from "zod"

export namespace FileEvent {
  export const Edited = BusEvent.define(
    "file.edited",
    z.object({
      file: z.string(),
    }),
  )

  export const Changed = BusEvent.define(
    "file.changed",
    z.object({
      paths: z.array(z.string()),
    }),
  )

  export const Created = BusEvent.define(
    "file.created",
    z.object({
      paths: z.array(z.string()),
    }),
  )

  export const Deleted = BusEvent.define(
    "file.deleted",
    z.object({
      paths: z.array(z.string()),
    }),
  )
}
