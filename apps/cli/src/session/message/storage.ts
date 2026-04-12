import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Identifier } from "../../id/id"
import { Info, Part, WithParts } from "./types"
import z from "zod"

export const parts = fn(Identifier.schema("message"), async (messageID) => {
    const result = [] as Part[]
    for (const item of await Storage.list(["part", messageID])) {
        const read = await Storage.read<Part>(item)
        result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
})

export const get = fn(
    z.object({
        sessionID: Identifier.schema("session"),
        messageID: Identifier.schema("message"),
    }),
    async (input) => {
        return {
            info: await Storage.read<Info>(["message", input.sessionID, input.messageID]),
            parts: await parts(input.messageID),
        } as WithParts
    },
)

export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
    const list = await Array.fromAsync(await Storage.list(["message", sessionID]))
    for (let i = list.length - 1; i >= 0; i--) {
        yield await get({
            sessionID,
            messageID: list[i][2],
        })
    }
})
