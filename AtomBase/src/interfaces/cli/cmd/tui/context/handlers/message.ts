import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@atomcli/util/binary"


export function handleMessageEvent(
    event: any,
    store: any,
    setStore: SetStoreFunction<any>
) {
    switch (event.type) {
        case "message.updated": {
            // ACK received from server, clear optimistic queues
            if (event.properties.info.role === "user") {
                setStore("optimistic_message", event.properties.info.sessionID, [])
            }
            const messages = store.message[event.properties.info.sessionID]
            if (!messages) {
                setStore("message", event.properties.info.sessionID, [event.properties.info])
                break
            }
            const result = Binary.search(messages, event.properties.info.id, (m: any) => m.id)
            if (result.found) {
                setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
                break
            }
            setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft: any[]) => {
                    draft.splice(result.index, 0, event.properties.info)
                    if (draft.length > 100) draft.shift()
                }),
            )
            break
        }
        case "message.removed": {
            const messages = store.message[event.properties.sessionID]
            if (!messages) break
            const result = Binary.search(messages, event.properties.messageID, (m: any) => m.id)
            if (result.found) {
                setStore(
                    "message",
                    event.properties.sessionID,
                    produce((draft: any[]) => {
                        draft.splice(result.index, 1)
                    }),
                )
            }
            break
        }
    }
}
