import "../../preload"
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { applyMessageSnapshot, handleMessageEvent } from "@tui/context/handlers/message"

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

  test("keeps old messages after updates and releases parts only on removal", () => {
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
    expect(store.message.session).toHaveLength(101)
    expect(store.message.session[0].id).toBe("message-000")
    expect(store.part["message-000"]).toBeDefined()
    expect(store.delivery["message-000"]).toBeDefined()
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

  test("removal clears orphaned parts and delivery before message history loads", () => {
    const [store, setStore] = createStore<any>({
      message: {},
      optimistic_message: { session: [message("message-1")] },
      part: { "message-1": [{ id: "part-1" }] },
      delivery: { "message-1": { state: "sending", updatedAt: 0 } },
    })

    handleMessageEvent(
      { type: "message.removed", properties: { sessionID: "session", messageID: "message-1" } },
      store,
      setStore,
    )

    expect(store.part["message-1"]).toBeUndefined()
    expect(store.delivery["message-1"]).toBeUndefined()
    expect(store.optimistic_message.session).toHaveLength(0)
  })

  test("replays live updates and removals over a late history response", () => {
    const [store, setStore] = createStore<any>({
      message: {},
      optimistic_message: {},
      part: {},
      delivery: {},
    })
    const updated = { ...message("message-2", "assistant"), time: { created: 2, completed: 3 } }
    const events = [
      { type: "message.updated", properties: { info: updated } },
      { type: "message.part.updated", properties: { part: { id: "part-2", messageID: "message-2", text: "new" } } },
      { type: "message.removed", properties: { sessionID: "session", messageID: "message-3" } },
      { type: "message.part.removed", properties: { messageID: "message-1", partID: "part-1" } },
    ]
    const snapshot = [
      { info: message("message-1"), parts: [{ id: "part-1", messageID: "message-1" }] },
      { info: message("message-2", "assistant"), parts: [{ id: "part-2", messageID: "message-2", text: "old" }] },
      { info: message("message-3"), parts: [] },
    ]

    applyMessageSnapshot("session", snapshot, events, store, setStore)

    expect(store.message.session.map((item: any) => item.id)).toEqual(["message-1", "message-2"])
    expect(store.message.session[1].time.completed).toBe(3)
    expect(store.part["message-1"]).toEqual([])
    expect(store.part["message-2"][0].text).toBe("new")
    expect(store.part["message-3"]).toBeUndefined()
  })

  test("reconnect snapshot releases data for messages deleted while offline", () => {
    const [store, setStore] = createStore<any>({
      message: { session: [message("message-1"), message("message-2")] },
      optimistic_message: { session: [message("message-3")] },
      part: { "message-1": [{ id: "part-1" }], "message-2": [{ id: "part-2" }], "message-3": [] },
      delivery: { "message-1": { state: "sent" }, "message-2": { state: "sent" }, "message-3": { state: "sending" } },
    })

    applyMessageSnapshot("session", [{ info: message("message-1"), parts: [{ id: "part-1" }] }], [], store, setStore)

    expect(store.message.session.map((item: any) => item.id)).toEqual(["message-1"])
    expect(store.part["message-2"]).toBeUndefined()
    expect(store.delivery["message-2"]).toBeUndefined()
    expect(store.part["message-3"]).toBeDefined()
    expect(store.delivery["message-3"]).toBeDefined()
  })

  test("places a delayed cancellation beside the turn it cancelled", () => {
    const oldUser = message("message-1")
    const cancellation = { ...message("msg_cancel_hash", "assistant"), time: { created: 2 } }
    const nextUser = { ...message("message-3"), time: { created: 3 } }
    const [store, setStore] = createStore<any>({
      message: { session: [oldUser, nextUser] },
      optimistic_message: { session: [] },
      part: {},
      delivery: {},
    })

    handleMessageEvent({ type: "message.updated", properties: { info: cancellation } }, store, setStore)

    expect(store.message.session.map((item: any) => item.id)).toEqual([oldUser.id, cancellation.id, nextUser.id])
  })
})
