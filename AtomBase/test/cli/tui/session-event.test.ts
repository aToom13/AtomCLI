import "../../preload"
import { expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { handleSessionEvent } from "@tui/context/handlers/session"

test("session status event restores missing store branch without dropping other statuses", () => {
  const [store, setStore] = createStore<{ session_status?: Record<string, { type: string }> }>({
    session_status: undefined,
  })
  handleSessionEvent(
    { type: "session.status", properties: { sessionID: "ses_first", status: { type: "busy" } } },
    store,
    setStore,
  )
  handleSessionEvent(
    { type: "session.status", properties: { sessionID: "ses_second", status: { type: "idle" } } },
    store,
    setStore,
  )
  expect(store.session_status).toEqual({ ses_first: { type: "busy" }, ses_second: { type: "idle" } })
})
