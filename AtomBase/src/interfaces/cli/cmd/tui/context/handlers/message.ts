import { produce, type SetStoreFunction } from "solid-js/store"
import { Binary } from "@atomcli/util/binary"

const MAX_CACHED_MESSAGES = 100

export function handleMessageEvent(event: any, store: any, setStore: SetStoreFunction<any>) {
  switch (event.type) {
    case "message.updated": {
      const info = event.properties.info
      setStore(
        produce((draft: any) => {
          if (info.role === "user") {
            const optimistic = draft.optimistic_message[info.sessionID] ?? []
            const acknowledged = Binary.search(optimistic, info.id, (message: any) => message.id)
            if (acknowledged.found) optimistic.splice(acknowledged.index, 1)
            const delivery = draft.delivery?.[info.id]
            if (delivery) {
              delivery.state = "sent"
              delivery.error = undefined
              delivery.updatedAt = Date.now()
            }
          }

          const messages = draft.message[info.sessionID]
          if (!messages) {
            draft.message[info.sessionID] = [info]
            return
          }
          const result = Binary.search(messages, info.id, (message: any) => message.id)
          if (result.found) {
            messages[result.index] = info
            return
          }
          messages.splice(result.index, 0, info)
          while (messages.length > MAX_CACHED_MESSAGES) {
            const evicted = messages.shift()
            if (evicted) delete draft.part[evicted.id]
            if (evicted && draft.delivery) delete draft.delivery[evicted.id]
          }
        }),
      )
      break
    }
    case "message.removed": {
      const { sessionID, messageID } = event.properties
      const messages = store.message[sessionID]
      if (!messages) break
      const result = Binary.search(messages, messageID, (message: any) => message.id)
      if (!result.found) break
      setStore(
        produce((draft: any) => {
          draft.message[sessionID].splice(result.index, 1)
          delete draft.part[messageID]
          if (draft.delivery) delete draft.delivery[messageID]
        }),
      )
      break
    }
  }
}
