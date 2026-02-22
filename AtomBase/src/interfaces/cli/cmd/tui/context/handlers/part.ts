import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@atomcli/util/binary"


export function handlePartEvent(
    event: any,
    store: any,
    setStore: SetStoreFunction<any>
) {
    switch (event.type) {
        case "message.part.updated": {
            const parts = store.part[event.properties.part.messageID]
            if (!parts) {
                setStore("part", event.properties.part.messageID, [event.properties.part])
                break
            }
            const result = Binary.search(parts, event.properties.part.id, (p: any) => p.id)
            if (result.found) {
                setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
                break
            }
            setStore(
                "part",
                event.properties.part.messageID,
                produce((draft: any[]) => {
                    draft.splice(result.index, 0, event.properties.part)
                }),
            )
            break
        }

        case "message.part.removed": {
            const parts = store.part[event.properties.messageID]
            if (!parts) break
            const result = Binary.search(parts, event.properties.partID, (p: any) => p.id)
            if (result.found)
                setStore(
                    "part",
                    event.properties.messageID,
                    produce((draft: any[]) => {
                        draft.splice(result.index, 1)
                    }),
                )
            break
        }
    }
}
