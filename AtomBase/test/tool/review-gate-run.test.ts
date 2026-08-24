import "../preload"
import fs from "fs/promises"
import path from "path"
import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock SubAgent.spawn so runBlockingReview never hits a real model.
// The mock must be registered BEFORE review-gate is imported.
const spawnMock = mock(async (_args: any) => ({
  sessionId: "reviewer-session-1",
  isNewSession: true,
  output: "",
  parts: [],
  structuredOutput: { verdict: "passed", summary: "All checks verified with raw output.", findings: [] },
}))

mock.module("../../src/integrations/tool/subagent", () => ({
  SubAgent: {
    spawn: spawnMock,
    buildFromAgent: (agent: any) => agent.permission ?? [],
    buildPermissions: (parent: any[]) => parent,
  },
}))

const { HarnessState } = await import("@/core/session/harness-state")
const { Config } = await import("@/core/config/config")
const { Instance } = await import("@/services/project/instance")
const { Session } = await import("@/core/session")
const { tmpdir } = await import("../fixture/fixture")
const { runBlockingReview } = await import("@/integrations/tool/review-gate")

function resetSpawn() {
  spawnMock.mockReset()
  spawnMock.mockImplementation(async () => ({
    sessionId: "reviewer-session-1",
    isNewSession: true,
    output: "",
    parts: [],
    structuredOutput: { verdict: "passed", summary: "All checks verified with raw output.", findings: [] },
  }))
}

beforeEach(() => {
  resetSpawn()
})

describe("ReviewGate - runBlockingReview", () => {
  test("PASS verdict records pass and returns passed", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(true)
        expect(result.exhausted).toBe(false)
        expect(result.skipped).toBe(false)
        expect(spawnMock).toHaveBeenCalledTimes(2)
        expect(HarnessState.getReviewVerdict(sessionID)?.status).toBe("pass")
      },
    })
  })

  test("validated REJECTED finding records fail with reason and increments attempts", async () => {
    spawnMock.mockImplementation(async () => ({
      sessionId: "reviewer-session-1",
      isNewSession: false,
      output: "",
      parts: [],
      structuredOutput: {
        verdict: "rejected",
        summary: "Authentication input is unchecked.",
        findings: [
          {
            file: "src/auth/a.ts",
            startLine: 2,
            endLine: 2,
            severity: "P1",
            confidence: 0.94,
            title: "Authentication input is unchecked",
            evidence: "return value",
            recommendation: "Validate the input before returning it.",
          },
        ],
      },
    }))

    await using tmp = await tmpdir({
      init: async (dir) => {
        const target = path.join(dir, "src/auth/a.ts")
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, "export function auth(value: string) {\n  return value\n}\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(false)
        expect(result.exhausted).toBe(false)
        expect(result.reason).toContain("Authentication input is unchecked")
        expect(result.report?.findings).toHaveLength(1)
        const verdict = HarnessState.getReviewVerdict(sessionID)
        expect(verdict?.status).toBe("fail")
        expect(verdict?.attempts).toBe(1)
      },
    })
  })

  test("exhausted short-circuit: no re-spawn after max_attempts fails", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        // Simulate 3 consecutive FAILs (max_attempts default = 3)
        HarnessState.recordReviewVerdict(sessionID, { status: "fail", reason: "fail 1" })
        HarnessState.recordReviewVerdict(sessionID, { status: "fail", reason: "fail 2" })
        HarnessState.recordReviewVerdict(sessionID, { status: "fail", reason: "fail 3" })

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(false)
        expect(result.exhausted).toBe(true)
        expect(result.skipped).toBe(true)
        expect(spawnMock).not.toHaveBeenCalled()
      },
    })
  })

  test("disabled via config returns skipped without spawning", async () => {
    await using tmp = await tmpdir({
      config: {
        review: { enabled: false, max_attempts: 3, reviewer_count: 2, policy: "adaptive", high_risk_patterns: [] },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(true)
        expect(result.skipped).toBe(true)
        expect(spawnMock).not.toHaveBeenCalled()
      },
    })
  })

  test("no edits returns skipped without spawning", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(true)
        expect(result.skipped).toBe(true)
        expect(spawnMock).not.toHaveBeenCalled()
      },
    })
  })

  test("infrastructure error returns error flag without passing", async () => {
    spawnMock.mockImplementation(async () => {
      throw new Error("provider unavailable")
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(false)
        expect(result.error).toBe(true)
        expect(result.skipped).toBe(false)
        // Wedge fix: the pending claim must be released, so a retry can re-claim
        expect(HarnessState.getReviewVerdict(sessionID)?.status).not.toBe("pending")
        expect(HarnessState.beginReview(sessionID)).toBe(true)
      },
    })
  })

  test("aggregates descendant sub-agent edits so the gate is not bypassed", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })

        // Simulate a sub-agent editing a file under its OWN session (the
        // main agent delegated the edit — parent tracker has no edits).
        HarnessState.addEditedFile(child.id, "src/auth/subagent-edit.ts")

        const result = await runBlockingReview(parent.id)

        // The gate must NOT be bypassed: reviewer spawns and sees the child edit
        expect(result.passed).toBe(true)
        expect(result.skipped).toBe(false)
        expect(spawnMock).toHaveBeenCalledTimes(2)
        expect(HarnessState.getEditedFiles(parent.id)).toContain("src/auth/subagent-edit.ts")

        const promptArg = spawnMock.mock.calls[0]?.[0]
        const promptText = (promptArg as any)?.parts?.[0]?.text ?? ""
        expect(promptText).toContain("src/auth/subagent-edit.ts")

        await Session.remove(parent.id)
      },
    })
  })

  test("no sub-agent edits means parent-only edits still trigger review", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const parent = await Session.create({})
        HarnessState.addEditedFile(parent.id, "src/auth/parent-edit.ts")

        const result = await runBlockingReview(parent.id)

        expect(result.passed).toBe(true)
        expect(result.skipped).toBe(false)
        expect(spawnMock).toHaveBeenCalledTimes(2)
        const promptArg = spawnMock.mock.calls[0]?.[0]
        const promptText = (promptArg as any)?.parts?.[0]?.text ?? ""
        expect(promptText).toContain("src/auth/parent-edit.ts")

        await Session.remove(parent.id)
      },
    })
  })

  test("concurrent runBlockingReview calls spawn the reviewer exactly once", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-run-1"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const [a, b] = await Promise.all([runBlockingReview(sessionID), runBlockingReview(sessionID)])

        // The beginReview claim must serialize the race: one spawn, one loser
        expect(spawnMock).toHaveBeenCalledTimes(2)
        const winners = [a, b].filter((r) => r.passed === true)
        const losers = [a, b].filter((r) => r.passed === false)
        expect(winners.length).toBe(1)
        expect(losers.length).toBe(1)
        expect(losers[0].error).toBe(true)
        expect(losers[0].skipped).toBe(true)
      },
    })
  })

  test("deleting a sub-agent session does not bypass the review gate", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        HarnessState.addEditedFile(child.id, "src/auth/subagent-edit.ts")

        // Attacker deletes the child session BEFORE clear — Session.remove must
        // merge the child's edits into the parent so the gate still reviews them.
        await Session.remove(child.id)

        const result = await runBlockingReview(parent.id)

        expect(result.skipped).toBe(false)
        expect(result.passed).toBe(true)
        expect(spawnMock).toHaveBeenCalledTimes(2)
        expect(HarnessState.getEditedFiles(parent.id)).toContain("src/auth/subagent-edit.ts")

        await Session.remove(parent.id)
      },
    })
  })

  test("reviewer agent disabled via config skips without leaking a pending claim (wedge fix)", async () => {
    await using tmp = await tmpdir({
      config: { agent: { reviewer: { disable: true } } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-no-reviewer"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const result = await runBlockingReview(sessionID)

        // Reviewer-not-found is a skip, not a pass-through review
        expect(result.passed).toBe(true)
        expect(result.skipped).toBe(true)
        expect(spawnMock).not.toHaveBeenCalled()

        // The claim taken by beginReview must have been released — otherwise
        // the next clear sees a stale "pending" verdict and is wedged forever
        expect(HarnessState.getReviewVerdict(sessionID)).toBeUndefined()
        expect(HarnessState.beginReview(sessionID)).toBe(true)
      },
    })
  })
})
