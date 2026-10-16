import { expect, test } from "bun:test"
import "../preload"
import { Instance } from "@/services/project/instance"
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { Storage } from "@/core/storage/storage"
import { tmpdir } from "../fixture/fixture"

test("session scope floor is monotonic, durable, and isolated per session", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      SessionScopeFloor.clearCache()
      expect(await SessionScopeFloor.merge("session-a", "direct")).toBe("direct")
      expect(await SessionScopeFloor.raise({ sessionID: "session-a", scope: "focused" })).toBe("focused")
      expect(await SessionScopeFloor.raise({ sessionID: "session-a", scope: "direct" })).toBe("focused")
      expect(await SessionScopeFloor.merge("session-b", "direct")).toBe("direct")

      SessionScopeFloor.clearCache()
      expect(await SessionScopeFloor.merge("session-a", "direct")).toBe("focused")
      await SessionScopeFloor.reset("session-a")
      expect(await SessionScopeFloor.merge("session-a", "direct")).toBe("direct")

      await Storage.write(["session_scope_floor", "legacy-session"], "coordinated")
      expect(await SessionScopeFloor.merge("legacy-session", "direct")).toBe("coordinated")
      expect(SessionScopeFloor.get("legacy-session")).toBe("coordinated")
      expect(await Storage.read(["session_scope_floor", "legacy-session"]).catch(() => undefined)).toBeUndefined()

      await Storage.write(["session_scope_floor", "session-a"], "coordinated")
      expect(await SessionScopeFloor.merge("session-a", "direct")).toBe("coordinated")
    },
  })
})
