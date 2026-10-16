import "../preload"
import { expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { Session } from "@/core/session"
import { Server } from "@/server/server"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("session API lists and opens sessions only in requested directory", async () => {
  await using tmp = await tmpdir({ git: true })
  const first = path.join(tmp.path, "first")
  const second = path.join(tmp.path, "second")
  await Promise.all([mkdir(first), mkdir(second)])
  const one = await Instance.provide({ directory: first, fn: () => Session.create({ title: "first" }) })
  const two = await Instance.provide({ directory: second, fn: () => Session.create({ title: "second" }) })
  expect(one.projectID).toBe(two.projectID)

  const app = Server.App()
  const status = await app.request(`/session/status?directory=${encodeURIComponent(first)}`)
  expect(status.status).toBe(200)
  const list = await app.request(`/session?directory=${encodeURIComponent(first)}`)
  expect(list.status).toBe(200)
  const listed = ((await list.json()) as Session.Info[]).map((item) => item.id)
  expect(listed).toContain(one.id)
  expect(listed).not.toContain(two.id)

  const foreign = await app.request(`/session/${two.id}?directory=${encodeURIComponent(first)}`)
  expect(foreign.status).toBe(404)
  const foreignMessages = await app.request(`/session/${two.id}/message?directory=${encodeURIComponent(first)}`)
  expect(foreignMessages.status).toBe(404)
  const foreignDelete = await app.request(`/session/${two.id}?directory=${encodeURIComponent(first)}`, {
    method: "DELETE",
  })
  expect(foreignDelete.status).toBe(404)
  const own = await app.request(`/session/${two.id}?directory=${encodeURIComponent(second)}`)
  expect(own.status).toBe(200)

  const selectForeign = await app.request(`/tui/select-session?directory=${encodeURIComponent(first)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID: two.id }),
  })
  expect(selectForeign.status).toBe(404)

  await Instance.provide({ directory: first, fn: () => Session.remove(one.id) })
  await Instance.provide({ directory: second, fn: () => Session.remove(two.id) })
})
