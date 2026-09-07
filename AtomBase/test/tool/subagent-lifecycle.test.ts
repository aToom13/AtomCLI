import { describe, expect, test } from "bun:test"
import "../preload"
import { Bus } from "@/core/bus"
import { SessionStatus } from "@/core/session/status"
import { SubAgentLifecycle } from "@/integrations/tool/subagent-lifecycle"
import { TuiEvent } from "@/interfaces/cli/cmd/tui/event"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SubAgent lifecycle", () => {
  test("wait rejects immediately when its signal was already aborted", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const controller = new AbortController()
        controller.abort(new Error("cancelled before wait"))

        await expect(
          SubAgentLifecycle.wait("ses_wait_pre_aborted", { timeoutMs: 5_000, signal: controller.signal }),
        ).rejects.toThrow("cancelled before wait")
      },
    })
  })

  test("wait resolves a removed running session as cancelled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_wait_cancelled"
        SessionStatus.set(sessionID, { type: "busy" })
        const waiting = SubAgentLifecycle.wait(sessionID, { timeoutMs: 5_000 })

        await Bus.publish(TuiEvent.SubAgentRemove, { sessionId: sessionID })

        expect(await waiting).toMatchObject({ sessionId: sessionID, status: "cancelled" })
      },
    })
  })
})
