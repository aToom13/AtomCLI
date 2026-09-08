import { produce, type SetStoreFunction } from "solid-js/store"

const MAX_CACHED_MESSAGES = 100

function compareMessages(a: any, b: any) {
  return a.time.created - b.time.created || a.id.localeCompare(b.id)
}

export function handleMessageEvent(event: any, store: any, setStore: SetStoreFunction<any>) {
  switch (event.type) {
    case "message.updated": {
      const info = event.properties.info
      setStore(
        produce((draft: any) => {
          if (info.role === "user") {
            const optimistic = draft.optimistic_message[info.sessionID] ?? []
            const acknowledged = optimistic.findIndex((message: any) => message.id === info.id)
            if (acknowledged >= 0) optimistic.splice(acknowledged, 1)
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
          const index = messages.findIndex((message: any) => message.id === info.id)
          if (index >= 0) messages[index] = info
          else messages.push(info)
          messages.sort(compareMessages)
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
      const index = messages.findIndex((message: any) => message.id === messageID)
      if (index < 0) break
      setStore(
        produce((draft: any) => {
          draft.message[sessionID].splice(index, 1)
          delete draft.part[messageID]
          if (draft.delivery) delete draft.delivery[messageID]
        }),
      )
      break
    }
  }
}
