import "./preload"
import { expect, test } from "bun:test"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "./fixture/fixture"

test("always approval falls back to the exact reviewed pattern", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = PermissionNext.ask({
        sessionID: "session_mobile_always",
        permission: "bash",
        patterns: ["bun test"],
        always: [],
        metadata: {},
        ruleset: [],
      })
      const pending = await PermissionNext.list()
      expect(pending).toHaveLength(1)

      await PermissionNext.reply({ requestID: pending[0]!.id, reply: "always" })
      await expect(first).resolves.toBeUndefined()

      await expect(
        PermissionNext.ask({
          sessionID: "session_mobile_always_next",
          permission: "bash",
          patterns: ["bun test"],
          always: [],
          metadata: {},
          ruleset: [],
        }),
      ).resolves.toBeUndefined()
    },
  })
  await Instance.disposeAll()
})

test("a resolved permission cannot be reported as handled twice", async () => {
  await using project = await tmpdir({ git: true })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const requestID = "permission_duplicate_reply"
      const pending = PermissionNext.ask({
        id: requestID,
        sessionID: "session_duplicate_reply",
        permission: "bash",
        patterns: ["echo safe"],
        always: ["echo *"],
        metadata: {},
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      })
      await Bun.sleep(0)
      expect(await PermissionNext.reply({ requestID, reply: "once" })).toBe(true)
      expect(await PermissionNext.reply({ requestID, reply: "once" })).toBe(false)
      await pending
    },
  })
})
