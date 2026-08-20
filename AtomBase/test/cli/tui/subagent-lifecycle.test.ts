import { describe, expect, test } from "bun:test"
import { SubAgentLifecycle } from "@tui/context/subagent-lifecycle"

describe("SubAgentLifecycle.dismiss", () => {
  test("aborts work and permanently deletes the child session", async () => {
    const calls: string[] = []
    const client = {
      async abort({ sessionID }: { sessionID: string }) {
        calls.push(`abort:${sessionID}`)
      },
      async delete({ sessionID }: { sessionID: string }) {
        calls.push(`delete:${sessionID}`)
        return { data: true }
      },
    }

    await SubAgentLifecycle.dismiss(client, "child-1")

    expect(calls).toEqual(["abort:child-1", "delete:child-1"])
  })

  test("still deletes when the child already stopped before abort", async () => {
    let deleted = false
    const client = {
      async abort() {
        throw new Error("already idle")
      },
      async delete() {
        deleted = true
        return { data: true }
      },
    }

    await SubAgentLifecycle.dismiss(client, "child-2")

    expect(deleted).toBe(true)
  })

  test("reports deletion failures instead of pretending dismissal persisted", async () => {
    const client = {
      async abort() {},
      async delete() {
        return { error: "storage unavailable" }
      },
    }

    expect(SubAgentLifecycle.dismiss(client, "child-3")).rejects.toThrow("Failed to delete sub-agent session")
  })
})
