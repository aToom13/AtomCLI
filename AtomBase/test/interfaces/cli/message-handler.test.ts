import "../../preload"
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { handleMessageEvent } from "@tui/context/handlers/message"

function message(id: string, role: "user" | "assistant" = "user") {
  return { id, sessionID: "session", role, time: { created: Number(id.replace(/\D/g, "")) || 0 } }
}

describe("TUI message event cache", () => {
  test("a user ACK removes only its matching optimistic message", () => {
    const [store, setStore] = createStore<any>({
      message: { session: [] },
      optimistic_message: { session: [message("message-1"), message("message-2")] },
      part: { "message-1": [], "message-2": [] },
      delivery: {
        "message-1": { state: "sending", updatedAt: 0 },
        "message-2": { state: "sending", updatedAt: 0 },
      },
    })

    handleMessageEvent({ type: "message.updated", properties: { info: message("message-1") } }, store, setStore)

    expect(store.optimistic_message.session.map((item: any) => item.id)).toEqual(["message-2"])
    expect(store.message.session.map((item: any) => item.id)).toEqual(["message-1"])
    expect(store.delivery["message-1"].state).toBe("sent")
    expect(store.delivery["message-2"].state).toBe("sending")
  })

  test("eviction and removal also release the matching part cache", () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(`message-${String(index).padStart(3, "0")}`))
    const [store, setStore] = createStore<any>({
      message: { session: messages },
      optimistic_message: { session: [] },
      part: Object.fromEntries(messages.map((item) => [item.id, [{ id: `part-${item.id}` }]])),
      delivery: Object.fromEntries(messages.map((item) => [item.id, { state: "sent", updatedAt: 0 }])),
    })

    handleMessageEvent(
      { type: "message.updated", properties: { info: message("message-999", "assistant") } },
      store,
      setStore,
    )
    expect(store.message.session).toHaveLength(100)
    expect(store.part["message-000"]).toBeUndefined()
    expect(store.delivery["message-000"]).toBeUndefined()
    expect(store.part["message-999"]).toBeUndefined()

    handleMessageEvent(
      { type: "message.removed", properties: { sessionID: "session", messageID: "message-050" } },
      store,
      setStore,
    )
    expect(store.message.session.some((item: any) => item.id === "message-050")).toBe(false)
    expect(store.part["message-050"]).toBeUndefined()
    expect(store.delivery["message-050"]).toBeUndefined()
  })
})
