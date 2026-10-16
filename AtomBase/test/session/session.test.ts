import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "@/core/session"
import { Bus } from "@/core/bus"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { Storage } from "@/core/storage/storage"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("lists and opens sessions only from the active directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const current = await Session.create({ title: "current directory" })
        const foreign = await Session.createNext({
          directory: path.join(projectRoot, "other-directory"),
          title: "foreign",
        })

        const listed = [] as Session.Info[]
        for await (const session of Session.list()) listed.push(session)
        expect(listed.map((session) => session.id)).toContain(current.id)
        expect(listed.map((session) => session.id)).not.toContain(foreign.id)
        await expect(Session.get(foreign.id)).rejects.toMatchObject({ name: "NotFoundError" })

        await Session.remove(current.id)
        await Storage.remove(["session", current.projectID, foreign.id])
      },
    })
  })

  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })
})
