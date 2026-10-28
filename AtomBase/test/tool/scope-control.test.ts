import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ScopeControl } from "@/integrations/tool/scope-control"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { Session } from "@/core/session"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"

test.each([
  ["auto", "focused"],
  ["ask", "focused"],
  ["denied", "focused"],
  ["off", "focused"],
  ["default", "focused"],
  ["default", "coordinated"],
] as const)("same-scope mutation recovery needs no approval: %s / %s", async (mode, scope) => {
  await using tmp = await tmpdir({
    config: {
      execution_budget: { max_calls: 1, max_steps: 1, unknown_price: "block" },
      experimental: {
        scope_escalation: {
          mode: mode === "default" ? undefined : mode === "denied" ? "ask" : mode,
          max_per_session: 1,
          cooldown_ms: 0,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.clearCache()
      const session = await Session.create({})
      const messageID = Identifier.ascending("message")
      await Session.updateMessage({
        id: messageID,
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "fixture" },
        time: { created: Date.now() },
      })
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
      ExecutionRuntime.setExecutionContract(
        execution.executionID,
        ExecutionContract.parseSafe({
          intent: "inspect",
          scope,
          needsMutation: false,
          confidence: 0.6,
          expectedSurfaces: ["workspace"],
        }),
      )
      let asks = 0
      const ctx = {
        ...context(session.id, async () => {
          asks++
          if (mode === "denied") throw new Error("permission denied")
        }),
        extra: { execution },
      }
      const tool = await ScopeControl.Info.init()
      const request = {
        action: "escalate" as const,
        target: scope,
        needsMutation: true as const,
        reason: "The user asked to write a test file, preserving implementation files.",
      }
      const run = tool.execute(request, ctx)
      if (mode === "off") {
        await expect(run).rejects.toThrow("disabled")
        expect(ExecutionRuntime.getExecutionContract(execution.executionID)?.needsMutation).toBe(false)
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)?.allowedTools).not.toContain("write")
        expect(ExecutionRuntime.scopeEscalationStatus(session.id).count).toBe(0)
      } else {
        const result = await run
        expect(result.metadata.changed).toBe(true)
        expect(ExecutionRuntime.getExecutionContract(execution.executionID)).toMatchObject({
          intent: "change",
          scope,
          needsMutation: true,
        })
        const policy = ExecutionRuntime.getExecutionPolicy(execution.executionID)!
        expect(policy.allowedTools).toContain("write")
        expect(policy.allowedTools).toContain("edit")
        expect(policy.allowedTools.includes("agent")).toBe(scope === "coordinated")
        expect(ExecutionRuntime.scopeEscalationStatus(session.id).count).toBe(1)
        const event = ExecutionRuntime.events(session.id).items.find(
          (item) => item.type === "execution.scope.escalated",
        )
        expect(event?.properties).toMatchObject({ grantedCalls: 0, grantedSteps: 0, scope })
        expect(asks).toBe(0)
        expect((await tool.execute(request, ctx)).metadata.changed).toBe(false)
        expect(ExecutionRuntime.scopeEscalationStatus(session.id).count).toBe(1)
        await expect(tool.execute(request, { ...ctx, sessionID: "child" })).rejects.toThrow(
          "Only the main conversation",
        )
        if (scope === "focused") {
          const broader = tool.execute({ ...request, target: "coordinated" }, ctx)
          if (mode === "denied") await expect(broader).rejects.toThrow("permission denied")
          else await expect(broader).rejects.toMatchObject({ reason: "scope_escalation_limit" })
        }
        expect(ExecutionRuntime.getExecutionPolicy(execution.executionID)?.scope).toBe(scope)
      }
      // A rejected child request never reaches the permission responder.
      expect(asks).toBe(scope === "focused" && ["default", "ask", "denied"].includes(mode) ? 1 : 0)
    },
  })
})

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
      const child = context(
        "child",
        async () => {
          throw new Error("child must not request permission")
        },
        "root",
      )
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

test("diagnostics expose actual paths and credential types without secrets or access claims", async () => {
  const { Auth } = await import("@/services/auth")
  const { Provider } = await import("@/integrations/provider/provider")
  const { Global } = await import("@/core/global")
  await using tmp = await tmpdir({
    git: true,
    config: { provider: { diagnostic: { options: { apiKey: "fake-config-secret-for-test-only" } } } },
  })
  const auth = spyOn(Auth, "get").mockResolvedValue({
    type: "oauth",
    access: "fake-access-token-for-test-only",
    refresh: "fake-refresh-token-for-test-only",
    expires: 0,
  })
  const provider = spyOn(Provider, "getProvider").mockResolvedValue({
    source: "custom",
    env: [],
    options: { apiKey: "fake-provider-secret-for-test-only" },
  } as never)
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScopeControl.diagnostics({ providerID: "diagnostic", id: "model" })
        expect(result.paths.root).toBe(Global.Path.root)
        expect(result.paths.auth).toBe(path.join(Global.Path.data, "auth.json"))
        expect(result).toMatchObject({
          availability: "unverified",
          provider: {
            resolved: true,
            configured: true,
            storedEntry: "present",
            storedType: "oauth",
            environmentCredentialPresent: false,
          },
        })
        const output = JSON.stringify(result)
        for (const secret of ["fake-config-secret", "fake-access-token", "fake-refresh-token", "fake-provider-secret"])
          expect(output).not.toContain(secret)
        auth.mockResolvedValue(undefined)
        expect((await ScopeControl.diagnostics({ providerID: "diagnostic", id: "model" })).provider.storedEntry).toBe(
          "not_observed",
        )
      },
    })
  } finally {
    auth.mockRestore()
    provider.mockRestore()
  }
})
