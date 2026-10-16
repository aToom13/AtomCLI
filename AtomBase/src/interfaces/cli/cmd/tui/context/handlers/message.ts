import { produce, type SetStoreFunction } from "solid-js/store"
import { handlePartEvent } from "./part"

function compareMessages(a: any, b: any) {
  return a.time.created - b.time.created || a.id.localeCompare(b.id)
}

export function handleMessageEvent(event: any, _store: any, setStore: SetStoreFunction<any>) {
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
        }),
      )
      break
    }
    case "message.removed": {
      const { sessionID, messageID } = event.properties
      setStore(
        produce((draft: any) => {
          const messages = draft.message[sessionID]
          const index = messages?.findIndex((message: any) => message.id === messageID) ?? -1
          if (index >= 0) messages.splice(index, 1)
          const optimistic = draft.optimistic_message?.[sessionID]
          const optimisticIndex = optimistic?.findIndex((message: any) => message.id === messageID) ?? -1
          if (optimisticIndex >= 0) optimistic.splice(optimisticIndex, 1)
          delete draft.part[messageID]
          if (draft.delivery) delete draft.delivery[messageID]
        }),
      )
      break
    }
  }
}

export function applyMessageSnapshot(
  sessionID: string,
  snapshot: { info: any; parts: any[] }[],
  events: any[],
  store: any,
  setStore: SetStoreFunction<any>,
) {
  setStore(
    produce((draft: any) => {
      const currentIDs = new Set(snapshot.map((item) => item.info.id))
      for (const message of draft.message[sessionID] ?? []) {
        if (currentIDs.has(message.id)) continue
        delete draft.part[message.id]
        if (draft.delivery) delete draft.delivery[message.id]
      }
      draft.message[sessionID] = snapshot.map((item) => item.info)
      for (const item of snapshot) draft.part[item.info.id] = item.parts
    }),
  )
  for (const event of events) {
    if (event.type.startsWith("message.part.")) handlePartEvent(event, store, setStore)
    else handleMessageEvent(event, store, setStore)
  }
}
