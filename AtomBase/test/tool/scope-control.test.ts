import "../preload"
import { expect, test } from "bun:test"
import { ScopeControl } from "@/integrations/tool/scope-control"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

function context(sessionID: string, ask: () => Promise<void>, rootSessionID = sessionID) {
  return {
    sessionID,
    messageID: "message",
    agent: "agent",
    abort: new AbortController().signal,
    extra: { execution: { executionID: "execution", rootSessionID } },
    metadata() {},
    ask,
  }
}

test("scope reset in auto mode does not ask for permission", async () => {
  await Config.clearCache()
  await using tmp = await tmpdir({
    init: async (directory) => {
      await Bun.write(
        path.join(directory, "atomcli.json"),
        JSON.stringify({ experimental: { scope_escalation: { mode: "auto" } } }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await SessionScopeFloor.raise({ sessionID: "scope-session", scope: "coordinated" })
      const tool = await ScopeControl.Info.init()
      const status = await tool.execute(
        { action: "status" },
        context("scope-session", async () => {
          throw new Error("status must not request permission")
        }),
      )
      expect(JSON.parse(status.output)).toMatchObject({
        floor: "coordinated",
        nextScope: "coordinated",
        nextAllowsSubagents: true,
        escalation: { mode: "auto", used: 0, max: 20, remaining: 20, cooldownUntil: null },
      })
      const result = await tool.execute(
        { action: "reset" },
        context("scope-session", async () => {
          throw new Error("auto mode must not request permission")
        }),
      )
      expect(result.metadata.changed).toBe(true)
      expect(result.output).toContain("future turns")
      expect(SessionScopeFloor.get("scope-session")).toBe("direct")
      expect(ExecutionRuntime.scopeEscalationStatus("scope-session").count).toBe(0)
    },
  })
})

test("child session cannot reset or escalate parent execution scope", async () => {
  await Config.clearCache()
  await using tmp = await tmpdir({
    init: async (directory) => {
      await Bun.write(
        path.join(directory, "atomcli.json"),
        JSON.stringify({ experimental: { scope_escalation: { mode: "auto" } } }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tool = await ScopeControl.Info.init()
      const child = context("child", async () => {
        throw new Error("child must not request permission")
      }, "root")
      await expect(tool.execute({ action: "reset" }, child)).rejects.toThrow("Only the main conversation")
      await expect(
        tool.execute({ action: "escalate", target: "coordinated", reason: "cross-package work" }, child),
      ).rejects.toThrow("Only the main conversation")
      expect(SessionScopeFloor.get("root")).toBeUndefined()
    },
  })
})

test("scope reset asks in ask mode and rejects in off mode", async () => {
  for (const mode of ["ask", "off"] as const) {
    await Config.clearCache()
    await using tmp = await tmpdir({
      init: async (directory) => {
        await Bun.write(
          path.join(directory, "atomcli.json"),
          JSON.stringify({ experimental: { scope_escalation: { mode } } }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionScopeFloor.raise({ sessionID: `scope-${mode}`, scope: "focused" })
        const tool = await ScopeControl.Info.init()
        let asks = 0
        const run = tool.execute(
          { action: "reset" },
          context(`scope-${mode}`, async () => {
            asks += 1
          }),
        )
        if (mode === "off") {
          await expect(run).rejects.toThrow("Scope escalation is disabled")
          expect(asks).toBe(0)
        } else {
          await run
          expect(asks).toBe(1)
        }
      },
    })
  }
})
