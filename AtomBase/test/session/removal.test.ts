import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { SessionReplay } from "@/core/session/replay"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"

const projectRoot = path.join(__dirname, "../..")

describe("session tree removal", () => {
  test("removes descendant messages, parts, replay and session-scoped records", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(Instance.project.id).not.toContain("\0")
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        const messageID = Identifier.ascending("message")
        const message = {
          id: messageID,
          sessionID: child.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        } as const
        const part = {
          id: Identifier.ascending("part"),
          sessionID: child.id,
          messageID,
          type: "text",
          text: "child transcript",
        } as const
        await Session.updateMessage(message)
        await Session.updatePart(part)
        await SessionReplay.record({
          sessionID: child.id,
          system: [],
          messages: [],
          tools: [],
          route: { providerID: "test", modelID: "fixture", agent: "build" },
          pluginTransforms: [],
          injectedContext: [],
        })
        await SessionReplay.append({
          type: "tool.call",
          sessionID: child.id,
          callID: "call-1",
          tool: "fixture",
          args: {},
        })
        await Storage.write(["todo", child.id], [])
        await Storage.write(["session_diff", child.id], [])
        await Storage.write(["compaction_transaction", child.id, "tx-1"], { status: "running" })

        await Session.remove(parent.id)

        expect(await Storage.list(["message", child.id])).toEqual([])
        expect(await Storage.list(["part", messageID])).toEqual([])
        expect(await Storage.list(["request", child.id])).toEqual([])
        expect(await Storage.list(["session_event", child.id])).toEqual([])
        expect(await Storage.list(["compaction_transaction", child.id])).toEqual([])
        await expect(Session.get(child.id)).rejects.toThrow()
        await expect(Storage.read(["todo", child.id])).rejects.toThrow()
        await expect(Storage.read(["session_diff", child.id])).rejects.toThrow()
        expect(await Storage.sessionGuard(child.id)).toMatchObject({ tombstone: true, generation: 2 })

        await expect(Session.updateMessage(message)).rejects.toThrow("Session is deleted")
        await expect(Session.updatePart(part)).rejects.toThrow("Session is deleted")
        await expect(Session.removeMessage({ sessionID: child.id, messageID })).rejects.toThrow("Session is deleted")
        await expect(Session.removePart({ sessionID: child.id, messageID, partID: part.id })).rejects.toThrow(
          "Session is deleted",
        )
        expect(await Storage.list(["message", child.id])).toEqual([])
        expect(await Storage.list(["part", messageID])).toEqual([])
      },
    })
  })
})
