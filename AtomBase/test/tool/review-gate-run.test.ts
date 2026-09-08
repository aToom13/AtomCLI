import "../preload"
import fs from "fs/promises"
import path from "path"
import { describe, expect, test, beforeEach, spyOn } from "bun:test"

// Spy on only SubAgent.spawn so the shared Bun test process keeps the real
// lifecycle methods for other test files.
const { SubAgent } = await import("@/integrations/tool/subagent")
const spawnMock = spyOn(SubAgent, "spawn").mockImplementation(async (_args: any) => ({
  sessionId: "reviewer-session-1",
  isNewSession: true,
  output: "",
  parts: [],
  structuredOutput: { verdict: "passed", summary: "All checks verified with raw output.", findings: [] },
}))

const { HarnessState } = await import("@/core/session/harness-state")
const { Config } = await import("@/core/config/config")
const { Instance } = await import("@/services/project/instance")
const { Session } = await import("@/core/session")
const { Identifier } = await import("@/core/id/id")
const { Provider } = await import("@/integrations/provider/provider")
const { ModelVerification } = await import("@/integrations/provider/verification")
const { tmpdir } = await import("../fixture/fixture")
const { evaluateReviewDecision, runBlockingReview } = await import("@/integrations/tool/review-gate")

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
  test("records policy skip as not_required rather than a reviewer PASS", async () => {
    await using tmp = await tmpdir({
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 2,
          max_attempts: 3,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-policy-skip"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")

        const assessment = await evaluateReviewDecision(sessionID)
        const result = await runBlockingReview(sessionID, { decision: assessment.decision })

        expect(assessment.decision).toMatchObject({
          requirement: "not_required",
          reasonCode: "review_disabled",
          requiredReviewers: 0,
        })
        expect(result).toMatchObject({ passed: true, skipped: true })
        expect(spawnMock).not.toHaveBeenCalled()
        expect(HarnessState.getReviewVerdict(sessionID)).toBeUndefined()
      },
    })
  })

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

  test("a staged final decision reuses a fresh PASS for the same revision", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-final-reuse"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        expect((await runBlockingReview(sessionID)).passed).toBe(true)
        expect(spawnMock).toHaveBeenCalledTimes(2)

        const assessment = await evaluateReviewDecision(sessionID)
        const result = await runBlockingReview(sessionID, { decision: assessment.decision })
        expect(result).toMatchObject({ passed: true, skipped: true })
        expect(spawnMock).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("binds reused PASS evidence to every final-review ledger session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-final-ledger-reuse"
        let next = 0
        spawnMock.mockImplementation(async (config: any) => {
          const sessionId = `reviewer-ledger-${next++}`
          await config.onSession?.({ sessionId, isNewSession: true })
          return {
            sessionId,
            isNewSession: true,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Verified.", findings: [] },
          }
        })
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        expect((await runBlockingReview(sessionID)).passed).toBe(true)
        const assessment = await evaluateReviewDecision(sessionID)
        const authorized: string[] = []
        const result = await runBlockingReview(sessionID, {
          decision: assessment.decision,
          authorizeSession: (reviewerSessionID) => {
            authorized.push(reviewerSessionID)
          },
        })
        expect(result).toMatchObject({ passed: true, skipped: true })
        expect(authorized).toEqual(["reviewer-ledger-0", "reviewer-ledger-1"])
        expect(spawnMock).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("reuses every reviewer slot on the next changed revision", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-slot-reuse"
        let next = 0
        spawnMock.mockImplementation(async (config: any) => {
          const sessionId = config.sessionId ?? `reviewer-slot-${next++}`
          await config.onSession?.({ sessionId, isNewSession: !config.sessionId })
          return {
            sessionId,
            isNewSession: !config.sessionId,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Verified.", findings: [] },
          }
        })
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        expect((await runBlockingReview(sessionID)).passed).toBe(true)
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        expect((await runBlockingReview(sessionID)).passed).toBe(true)
        expect(spawnMock.mock.calls.slice(2).map((call) => (call[0] as any).sessionId)).toEqual([
          "reviewer-slot-0",
          "reviewer-slot-1",
        ])
      },
    })
  })

  test("pins reviewers to the parent's verified AtomCLI Free route", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user: any = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "atomcli", modelID: "atomcli-free" },
        }
        await Session.updateMessage(user)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: user.id,
          sessionID: session.id,
          type: "text",
          text: "Review this authentication change",
        })
        const provider = await Provider.getProvider("atomcli")
        const selected = Object.values(provider!.models).find(
          (model) =>
            !["atomcli-free", "atomcli-auto"].includes(model.id) &&
            model.capabilities.toolcall &&
            model.cost?.input === 0 &&
            model.cost?.output === 0,
        )!
        const key = await ModelVerification.identity(selected, provider!)
        const attempt = await ModelVerification.begin({ key, providerID: selected.providerID, modelID: selected.id })
        await ModelVerification.verified(attempt, ["text", "tool"])
        HarnessState.addEditedFile(session.id, "src/auth/a.ts")

        const result = await runBlockingReview(session.id)

        expect(result.passed).toBe(true)
        const reviewerModel = (spawnMock.mock.calls[0]?.[0] as any)?.model
        expect(reviewerModel.providerID).toBe("atomcli")
        expect(reviewerModel.modelID).not.toBe("atomcli-free")
        expect(reviewerModel.modelID).not.toBe("atomcli-auto")
        expect(spawnMock.mock.calls.every((call) => (call[0] as any).model.modelID === reviewerModel.modelID)).toBe(
          true,
        )

        await Session.remove(session.id)
      },
    })
  })

  test("PASS is rejected when the same file changes while review is running", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const target = path.join(dir, "src/auth/a.ts")
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, "export const auth = true\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-stale-pass"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        spawnMock.mockImplementation(async () => {
          HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
          return {
            sessionId: "reviewer-session-stale",
            isNewSession: true,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Checked the earlier revision.", findings: [] },
          }
        })

        const result = await runBlockingReview(sessionID)

        expect(result.passed).toBe(false)
        expect(result.reason).toContain("changed while review was running")
        expect(HarnessState.needsReview(sessionID)).toBe(true)
      },
    })
  })

  test("reviewer source writes invalidate the verdict without leaving a pending claim", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const target = path.join(dir, "src/auth/a.ts")
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, "export const auth = true\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-reviewer-write"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        let changed = false
        spawnMock.mockImplementation(async () => {
          if (!changed) {
            changed = true
            await fs.writeFile(path.join(tmp.path, "src/auth/a.ts"), "export const auth = false\n")
          }
          return {
            sessionId: "reviewer-session-write",
            isNewSession: true,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Changed the source.", findings: [] },
          }
        })

        const result = await runBlockingReview(sessionID)
        expect(result.passed).toBe(false)
        expect(result.reason).toContain("workspace changed while review was running")
        expect(HarnessState.getReviewVerdict(sessionID)?.status).toBe("fail")
        expect(HarnessState.beginReview(sessionID)).toBe(true)
      },
    })
  })

  test("PASS is rejected when a descendant changes during review", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const target = path.join(dir, "src/auth/child.ts")
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, "export const child = true\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        HarnessState.addEditedFile(child.id, "src/auth/child.ts")
        let changed = false
        spawnMock.mockImplementation(async () => {
          if (!changed) {
            changed = true
            HarnessState.addEditedFile(child.id, "src/auth/child.ts")
          }
          return {
            sessionId: "reviewer-session-child-stale",
            isNewSession: true,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Checked the earlier child revision.", findings: [] },
          }
        })

        const result = await runBlockingReview(parent.id)

        expect(result.passed).toBe(false)
        expect(result.reason).toContain("changed while review was running")
        expect(HarnessState.needsReview(parent.id)).toBe(true)
      },
    })
  })

  test("does not return PASS after its parent operation is cancelled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const sessionID = "session-gate-cancelled"
        HarnessState.addEditedFile(sessionID, "src/auth/a.ts")
        const controller = new AbortController()
        spawnMock.mockImplementation(async () => {
          controller.abort(new Error("parent cancelled"))
          return {
            sessionId: "reviewer-session-cancelled",
            isNewSession: true,
            output: "",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Late review result.", findings: [] },
          }
        })

        const result = await runBlockingReview(sessionID, { signal: controller.signal })
        expect(result).toMatchObject({ passed: false, error: true })
        expect(HarnessState.getReviewVerdict(sessionID)).toBeUndefined()
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

  test("reviewer agent disabled via config fails closed without leaking a pending claim", async () => {
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

        // A required reviewer that cannot run must never approve unreviewed edits.
        expect(result.passed).toBe(false)
        expect(result.skipped).toBe(true)
        expect(result.error).toBe(true)
        expect(result.reason?.toLowerCase()).toContain("reviewer")
        expect(spawnMock).not.toHaveBeenCalled()

        // Infrastructure failures are bounded but remain re-claimable.
        expect(HarnessState.getReviewVerdict(sessionID)).toMatchObject({ status: "fail", attempts: 1 })
        expect(HarnessState.beginReview(sessionID)).toBe(true)
      },
    })
  })
})
