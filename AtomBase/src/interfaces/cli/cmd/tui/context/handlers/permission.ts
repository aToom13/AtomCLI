import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@atomcli/util/binary"

export function handlePermissionEvent(
    event: any,
    store: any,
    setStore: SetStoreFunction<any>
) {
    switch (event.type) {
        case "permission.asked": {
            const request = event.properties
            const requests = store.permission[request.sessionID]
            if (!requests) {
                setStore("permission", request.sessionID, [request])
                break
            }
            const match = Binary.search(requests, request.id, (r: any) => r.id)
            if (match.found) {
                setStore("permission", request.sessionID, match.index, reconcile(request))
                break
            }
            setStore(
                "permission",
                request.sessionID,
                produce((draft: any[]) => {
                    draft.splice(match.index, 0, request)
                }),
            )
            break
        }
        case "permission.replied": {
            const requests = store.permission[event.properties.sessionID]
            if (!requests) break
            const match = Binary.search(requests, event.properties.requestID, (r: any) => r.id)
            if (!match.found) break
            setStore(
                "permission",
                event.properties.sessionID,
                produce((draft: any[]) => {
                    draft.splice(match.index, 1)
                }),
            )
            break
        }
        case "question.asked": {
            const request = event.properties
            const requests = store.question[request.sessionID]
            if (!requests) {
                setStore("question", request.sessionID, [request])
                break
            }
            const match = Binary.search(requests, request.id, (r: any) => r.id)
            if (match.found) {
                setStore("question", request.sessionID, match.index, reconcile(request))
                break
            }
            setStore(
                "question",
                request.sessionID,
                produce((draft: any[]) => {
                    draft.splice(match.index, 0, request)
                }),
            )
            break
        }
        case "question.replied":
        case "question.rejected": {
            const requests = store.question[event.properties.sessionID]
            if (!requests) break
            const match = Binary.search(requests, event.properties.requestID, (r: any) => r.id)
            if (!match.found) break
            setStore(
                "question",
                event.properties.sessionID,
                produce((draft: any[]) => {
                    draft.splice(match.index, 1)
                }),
            )
            break
        }
    }
}
