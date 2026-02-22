import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@atomcli/util/binary"

export function handleSessionEvent(
    event: any,
    store: any,
    setStore: SetStoreFunction<any>
) {
    switch (event.type) {
        case "session.deleted": {
            const result = Binary.search(store.session, event.properties.info.id, (s: any) => s.id)
            if (result.found) {
                setStore(
                    "session",
                    produce((draft: any[]) => {
                        draft.splice(result.index, 1)
                    }),
                )
            }
            break
        }
        case "session.updated": {
            const result = Binary.search(store.session, event.properties.info.id, (s: any) => s.id)
            if (result.found) {
                setStore("session", result.index, reconcile(event.properties.info))
                break
            }
            setStore(
                "session",
                produce((draft: any[]) => {
                    draft.splice(result.index, 0, event.properties.info)
                }),
            )
            break
        }
        case "session.diff":
            setStore("session_diff", event.properties.sessionID, event.properties.diff)
            break
        case "session.status":
            setStore("session_status", event.properties.sessionID, event.properties.status)
            break
    }
}
