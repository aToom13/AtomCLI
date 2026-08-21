import { describe, expect, test } from "bun:test"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Storage } from "@/core/storage/storage"
import { SessionPrompt } from "@/core/session/prompt"
import { tmpdir } from "../fixture/fixture"

describe("session patch memory safety", () => {
  test("can stream model history without parsing operational patch manifests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          agent: "agent",
          model: { providerID: "atomcli", modelID: "deepseek-v4-flash-free" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: message.id,
          type: "text",
          text: "continue",
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: message.id,
          type: "patch",
          hash: "before",
          after: "after",
          total: 20_000,
          truncated: true,
          files: Array.from({ length: 20_000 }, (_, index) => `${tmp.path}/generated/${index}.txt`),
        })

        const reorderedPartID = Identifier.ascending("part")
        await Storage.write(["part", message.id, reorderedPartID], {
          id: reorderedPartID,
          sessionID: session.id,
          messageID: message.id,
          files: Array.from({ length: 20_000 }, (_, index) => `${tmp.path}/legacy/${index}.txt`),
          type: "patch",
          hash: "legacy-before",
        })

        const filtered = await Session.messages({ sessionID: session.id, excludePatches: true })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].parts.map((part) => part.type)).toEqual(["text"])
        expect(await SessionPrompt._internals.lastModel(session.id)).toEqual({
          providerID: "atomcli",
          modelID: "deepseek-v4-flash-free",
        })

        const complete = await Session.messages({ sessionID: session.id })
        expect(complete[0].parts.filter((part) => part.type === "patch")).toHaveLength(2)
        await Session.remove(session.id)
      },
    })
  })
})
