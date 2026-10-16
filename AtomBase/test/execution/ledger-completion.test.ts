import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import { Database } from "bun:sqlite"
import { ExecutionLedger } from "@/core/execution/ledger"
import { tmpdir } from "../fixture/fixture"

function claimCompletion(
  ledger: ReturnType<typeof ExecutionLedger.open>,
  sessionID: string,
  executionID: string,
  projectorID: string,
  now: number,
) {
  const claim = ledger.claimCompletions({ sessionID, executionID, projectorID, leaseMs: 100, now }).at(0)
  expect(claim).toBeDefined()
  return claim!
}

describe("ExecutionLedger", () => {
  test("legacy QA PASS cannot bypass acceptance evidence; verified marker survives reopening", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "legacy-qa.sqlite")
    const db = new Database(file)
    db.run(
      "CREATE TABLE execution_review_qa (execution_id TEXT NOT NULL, revision INTEGER NOT NULL, verdict TEXT NOT NULL, reviewed_files TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, PRIMARY KEY (execution_id, revision))",
    )
    db.run("INSERT INTO execution_review_qa VALUES ('legacy', 3, 'passed', '[]', 1)")
    db.close()
    const ledger = ExecutionLedger.open(file)
    expect(ledger.qaReviewPassed({ executionID: "legacy", revision: 3 })).toBe(true)
    expect(ledger.qaReviewPassed({ executionID: "legacy", revision: 3, requireAcceptance: true })).toBe(false)
    ledger.recordQAReview({
      executionID: "legacy",
      revision: 3,
      verdict: "passed",
      acceptanceVerified: true,
      acceptanceRequestHash: "original-criteria",
    })
    expect(ledger.qaReviewPassed({ executionID: "legacy", revision: 3, requireAcceptance: true })).toBe(true)
    ledger.close()
    const reopened = ExecutionLedger.open(file)
    expect(reopened.qaReviewPassed({ executionID: "legacy", revision: 3, requireAcceptance: true })).toBe(true)
    expect(
      reopened.qaReviewPassed({
        executionID: "legacy",
        revision: 3,
        requireAcceptance: true,
        acceptanceRequestHash: "original-criteria",
      }),
    ).toBe(true)
    expect(
      reopened.qaReviewPassed({
        executionID: "legacy",
        revision: 3,
        requireAcceptance: true,
        acceptanceRequestHash: "new-criteria",
      }),
    ).toBe(false)
    expect(reopened.qaReviewPassed({ executionID: "legacy", revision: 4, requireAcceptance: true })).toBe(false)
    reopened.close()
  })
  test("fences a stale completion projector after lease takeover", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "projection-ledger.sqlite"))
    ledger.start({
      id: "exec-projection-fence",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      policy: {},
      now: 90,
    })
    ledger.claimOwner({ executionID: "exec-projection-fence", ownerID: "owner", leaseMs: 100, now: 100 })
    expect(
      ledger.stageCompletion({
        executionID: "exec-projection-fence",
        sessionID: "session",
        messageID: "message",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: "[]",
        reviewFiles: "[]",
        digest: "digest",
        requiresReview: false,
        revision: 0,
        now: 101,
      }),
    ).toMatchObject({ staged: true })
    expect(
      ledger.commitCompletion({
        executionID: "exec-projection-fence",
        ownerID: "owner",
        fence: 1,
        digest: "digest",
        now: 102,
      }),
    ).toMatchObject({ committed: true })

    const stale = ledger
      .claimCompletions({ sessionID: "session", projectorID: "projector-a", leaseMs: 10, now: 103 })
      .at(0)!
    expect(
      ledger.claimCompletions({ sessionID: "session", projectorID: "projector-b", leaseMs: 10, now: 109 }),
    ).toEqual([])
    const current = ledger
      .claimCompletions({ sessionID: "session", projectorID: "projector-b", leaseMs: 10, now: 113 })
      .at(0)!

    expect(ledger.ackCompletion({ ...stale, now: 114 })).toEqual({
      projected: false,
      reason: "stale_projection",
    })
    expect(ledger.ackCompletion({ ...current, now: 114 })).toEqual({ projected: true, idempotent: false })
    expect(ledger.ackCompletion({ ...current, now: 115 })).toEqual({ projected: true, idempotent: true })
    expect(ledger.ackCompletion({ ...stale, now: 115 })).toEqual({
      projected: false,
      reason: "stale_projection",
    })
    ledger.close()
  })

  test("finalizes a rejected review as blocked without downgrading the private candidate", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-review-blocked", projectID: "project", rootSessionID: "session", fence: 1, now: 100 })
    ledger.claimOwner({ executionID: "exec-review-blocked", ownerID: "owner", leaseMs: 100, now: 100 })
    ledger.bind({
      executionID: "exec-review-blocked",
      rootSessionID: "session",
      invocationID: "root-review-blocked",
      sessionID: "session",
      kind: "root",
      ownerID: "owner",
      fence: 1,
      now: 100,
    })
    expect(
      ledger.stageCompletion({
        executionID: "exec-review-blocked",
        sessionID: "session",
        messageID: "assistant-review-blocked",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: '[{"type":"text","text":"unapproved private answer"}]',
        reviewFiles: '["src/security.ts"]',
        digest: "review-blocked-digest",
        requiresReview: true,
        revision: 0,
        policyDigest: "policy-digest",
        reviewRequirement: "required",
        now: 101,
      }),
    ).toMatchObject({ staged: true })
    expect(
      ledger.claimReview({
        id: "review-blocked-claim",
        executionID: "exec-review-blocked",
        ownerID: "owner",
        fence: 1,
        digest: "review-blocked-digest",
        revision: 0,
        now: 102,
      }),
    ).toMatchObject({ claimed: true })
    expect(
      ledger.recordReview({
        executionID: "exec-review-blocked",
        reviewID: "review-blocked-claim",
        ownerID: "owner",
        fence: 1,
        state: "rejected",
        now: 103,
      }),
    ).toMatchObject({ recorded: true })

    const finalized = ledger.finalizeBlocked({
      executionID: "exec-review-blocked",
      ownerID: "owner",
      fence: 1,
      digest: "review-blocked-digest",
      deliveryPayload: '[{"type":"text","text":"review blocked this completion"}]',
      deliveryFinish: "error",
      reasonCode: "review_rejected",
      reasonMessage: "Independent review rejected this completion.",
      now: 104,
    })
    expect(finalized).toMatchObject({
      finalized: true,
      idempotent: false,
      completion: {
        state: "committed",
        outcome: "blocked",
        requiresReview: true,
        reviewRequirement: "required",
        payload: '[{"type":"text","text":"unapproved private answer"}]',
        deliveryPayload: '[{"type":"text","text":"review blocked this completion"}]',
        deliveryFinish: "error",
      },
    })
    expect(ledger.execution("exec-review-blocked")).toMatchObject({
      lifecycle: "terminal",
      phase: "idle",
      outcome: "blocked",
      reason: { code: "review_rejected", retryable: false },
    })
    expect(ledger.pendingCompletions("session")).toEqual([
      expect.objectContaining({ executionID: "exec-review-blocked", outcome: "blocked" }),
    ])
    expect(
      ledger.commitCompletion({
        executionID: "exec-review-blocked",
        ownerID: "owner",
        fence: 1,
        digest: "review-blocked-digest",
        now: 105,
      }),
    ).toEqual({ committed: false, reason: "terminal_outcome" })
    expect(
      ledger.finalizeBlocked({
        executionID: "exec-review-blocked",
        ownerID: "owner",
        fence: 1,
        digest: "review-blocked-digest",
        deliveryPayload: '[{"type":"text","text":"different late text"}]',
        deliveryFinish: "error",
        reasonCode: "review_rejected",
        reasonMessage: "Different late reason.",
        now: 106,
      }),
    ).toMatchObject({ finalized: true, idempotent: true })
    expect(ledger.completion("exec-review-blocked")?.deliveryPayload).toContain("review blocked this completion")
    expect(ledger.deleteSessions({ sessionIDs: ["session"], sessionGenerations: { session: 2 }, now: 107 })).toEqual({
      deleted: true,
      abandoned: 1,
      terminalized: 0,
    })
    expect(ledger.completion("exec-review-blocked")?.projection).toBe("abandoned")
    expect(ledger.pendingCompletions("session")).toEqual([])
    expect(
      ledger.ackCompletion({
        executionID: "exec-review-blocked",
        digest: "review-blocked-digest",
        projectorID: "stale-projector",
        projectionToken: "stale-token",
        sessionGeneration: 1,
        now: 108,
      }),
    ).toEqual({ projected: false, reason: "abandoned" })
    expect(ledger.execution("exec-review-blocked")?.outcome).toBe("blocked")
    expect(ledger.events({ sessionID: "session" }).items.at(-1)).toMatchObject({
      sessionGeneration: 2,
      type: "execution.deleted",
      properties: { execution: expect.objectContaining({ outcome: "blocked" }) },
    })
    expect(ledger.deleteSessions({ sessionIDs: ["session"], sessionGenerations: { session: 2 }, now: 109 })).toEqual({
      deleted: true,
      abandoned: 0,
      terminalized: 0,
    })
    expect(ledger.events({ sessionID: "session" }).items).toHaveLength(3)
    ledger.close()
  })

  test("atomically finalizes a non-success outcome with its delivery outbox and event", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-provider-failed",
      projectID: "project",
      rootSessionID: "session-failed",
      sessionGeneration: 4,
      fence: 1,
      now: 100,
    })
    ledger.claimOwner({ executionID: "exec-provider-failed", ownerID: "owner", leaseMs: 100, now: 100 })
    const finalized = ledger.finalizeOutcome({
      executionID: "exec-provider-failed",
      sessionID: "session-failed",
      messageID: "assistant-failed",
      ownerID: "owner",
      fence: 1,
      finish: "error",
      payload: "[]",
      digest: "failed-digest",
      outcome: "failed",
      reasonCode: "provider_unavailable",
      reasonMessage: "The selected provider could not complete this execution.",
      retryable: true,
      now: 101,
    })
    expect(finalized).toMatchObject({
      finalized: true,
      idempotent: false,
      completion: { outcome: "failed", projection: "pending", state: "committed" },
    })
    expect(ledger.execution("exec-provider-failed")).toMatchObject({
      lifecycle: "terminal",
      outcome: "failed",
      reason: { code: "provider_unavailable", retryable: true },
    })
    expect(ledger.events({ sessionID: "session-failed" }).items.at(-1)).toEqual(
      expect.objectContaining({
        sessionGeneration: 4,
        executionID: "exec-provider-failed",
        type: "execution.updated",
        properties: { execution: expect.objectContaining({ outcome: "failed" }) },
      }),
    )
    expect(
      ledger.finalizeOutcome({
        executionID: "exec-provider-failed",
        sessionID: "session-failed",
        messageID: "assistant-failed",
        ownerID: "owner",
        fence: 1,
        finish: "error",
        payload: "[]",
        digest: "failed-digest",
        outcome: "failed",
        reasonCode: "provider_unavailable",
        reasonMessage: "A late duplicate must not rewrite the outcome.",
        retryable: false,
        now: 102,
      }),
    ).toMatchObject({ finalized: true, idempotent: true })
    expect(ledger.events({ sessionID: "session-failed" }).items).toHaveLength(2)
    ledger.close()
  })

  test("recovers more than one bounded page of pending completion projections", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    ExecutionLedger.open(filepath).close()
    const database = new Database(filepath)
    database.run("PRAGMA foreign_keys = ON")
    database.run("BEGIN IMMEDIATE")
    try {
      const insertExecution = database.query(
        `INSERT INTO execution
          (id, project_id, root_session_id, status, fence, created_at, lifecycle, phase, outcome,
           version, updated_at, terminal_at)
         VALUES (?, 'project', 'session-many', 'terminal', 1, ?, 'terminal', 'idle', 'completed', 1, ?, ?)`,
      )
      const insertCompletion = database.query(
        `INSERT INTO execution_completion
          (execution_id, session_id, message_id, owner_id, fence, finish, payload, digest,
           requires_review, terminal_outcome, projection_state, state, created_at, committed_at)
         VALUES (?, 'session-many', ?, 'owner', 1, 'stop', '[]', ?, 0, 'completed', 'pending',
           'committed', ?, ?)`,
      )
      for (let index = 0; index < 101; index++) {
        const suffix = index.toString().padStart(3, "0")
        const executionID = `exec-page-${suffix}`
        insertExecution.run(executionID, index, index, index)
        insertCompletion.run(executionID, `message-${suffix}`, `digest-${suffix}`, index, index)
      }
      database.run("COMMIT")
    } catch (error) {
      database.run("ROLLBACK")
      throw error
    } finally {
      database.close()
    }

    const recovered = ExecutionLedger.open(filepath)
    const first = recovered.claimCompletions({
      sessionID: "session-many",
      projectorID: "bulk-projector",
      leaseMs: 10_000,
    })
    expect(first).toHaveLength(50)
    for (const completion of first) {
      expect(recovered.ackCompletion(completion)).toMatchObject({
        projected: true,
      })
    }
    const second = recovered.claimCompletions({
      sessionID: "session-many",
      projectorID: "bulk-projector",
      leaseMs: 10_000,
    })
    expect(second).toHaveLength(50)
    for (const completion of second) {
      expect(recovered.ackCompletion(completion)).toMatchObject({
        projected: true,
      })
    }
    const third = recovered.claimCompletions({
      sessionID: "session-many",
      projectorID: "bulk-projector",
      leaseMs: 10_000,
    })
    expect(third).toHaveLength(1)
    expect(recovered.ackCompletion(third[0])).toMatchObject({
      projected: true,
    })
    expect(recovered.pendingCompletions("session-many")).toEqual([])
    recovered.close()
  })

  test("releases only abandoned unsent reservations during owner takeover", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-takeover-reserve",
      projectID: "project-takeover-reserve",
      rootSessionID: "session-takeover-reserve",
      fence: 1,
      policy: { maxCalls: 2 },
      now: 100,
    })
    ledger.claimOwner({ executionID: "exec-takeover-reserve", ownerID: "old", leaseMs: 10, now: 100 })
    for (const attemptID of ["unsent", "sent"]) {
      expect(
        ledger.reserve({
          attemptID,
          executionID: "exec-takeover-reserve",
          runID: "old",
          fence: 1,
          purpose: "main",
          estimateMicrousd: 5,
          now: 101,
        }),
      ).toMatchObject({ admitted: true })
    }
    ledger.dispatch({ attemptID: "sent", runID: "old", fence: 1, now: 102 })

    expect(
      ledger.claimOwner({ executionID: "exec-takeover-reserve", ownerID: "new", leaseMs: 10, now: 110 }),
    ).toMatchObject({ acquired: true, fence: 2, takeover: true })
    expect(ledger.totals("execution:exec-takeover-reserve")).toMatchObject({
      calls: 1,
      pending_calls: 0,
      reserved: 5,
    })
    expect(
      ledger.reserve({
        attemptID: "replacement",
        executionID: "exec-takeover-reserve",
        runID: "new",
        fence: 2,
        purpose: "main",
        estimateMicrousd: 5,
        now: 111,
      }),
    ).toMatchObject({ admitted: true })
    expect(() => ledger.release("unsent")).not.toThrow()
    ledger.close()
  })

  test("cannot downgrade a staged review requirement without an explicit discard", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-review-downgrade", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-review-downgrade", ownerID: "owner", leaseMs: 100, now: 100 })
    const candidate = {
      executionID: "exec-review-downgrade",
      sessionID: "session",
      messageID: "assistant",
      ownerID: "owner",
      fence: 1,
      finish: "stop",
      payload: "[]",
      reviewFiles: "[]",
      revision: 0,
    }
    expect(
      ledger.stageCompletion({
        ...candidate,
        digest: "review-required",
        requiresReview: true,
        now: 101,
      }),
    ).toMatchObject({ staged: true })
    expect(
      ledger.stageCompletion({
        ...candidate,
        digest: "review-bypassed",
        requiresReview: false,
        now: 102,
      }),
    ).toEqual({ staged: false, reason: "review_required" })
    expect(
      ledger.commitCompletion({
        executionID: candidate.executionID,
        ownerID: candidate.ownerID,
        fence: candidate.fence,
        digest: "review-required",
        now: 103,
      }),
    ).toEqual({ committed: false, reason: "review_required" })
    ledger.close()
  })

  test("does not replace a completion while its review claim is pending", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger-review-race.sqlite"))
    ledger.start({ id: "exec-review-race", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-review-race", ownerID: "owner", leaseMs: 100, now: 100 })
    const candidate = {
      executionID: "exec-review-race",
      sessionID: "session",
      messageID: "assistant",
      ownerID: "owner",
      fence: 1,
      finish: "stop",
      payload: "[]",
      reviewFiles: '["src/security.ts"]',
      revision: 0,
      requiresReview: true,
      policyDigest: "policy",
      reviewRequirement: "required" as const,
    }
    expect(ledger.stageCompletion({ ...candidate, digest: "first", now: 101 })).toMatchObject({ staged: true })
    expect(
      ledger.claimReview({
        id: "review-race",
        executionID: candidate.executionID,
        ownerID: candidate.ownerID,
        fence: candidate.fence,
        digest: "first",
        revision: 0,
        now: 102,
      }),
    ).toMatchObject({ claimed: true })
    expect(ledger.stageCompletion({ ...candidate, digest: "replacement", now: 103 })).toEqual({
      staged: false,
      reason: "review_active",
    })
    expect(ledger.stageCompletion({ ...candidate, digest: "first", now: 104 })).toMatchObject({
      staged: true,
      idempotent: true,
    })
    ledger.close()
  })

  test("retains the unknown-price policy when later snapshots omit it", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    const scope = {
      id: "exec-price-policy",
      projectID: "project-price-policy",
      rootSessionID: "session-price-policy",
      fence: 1,
    }
    ledger.start({ ...scope, policy: { unknownPriceBlocked: true } })
    expect(ledger.requiresKnownPrice(scope.id)).toBe(true)
    ledger.start({ ...scope, policy: {} })
    expect(ledger.requiresKnownPrice(scope.id)).toBe(true)
    ledger.close()
  })
})
