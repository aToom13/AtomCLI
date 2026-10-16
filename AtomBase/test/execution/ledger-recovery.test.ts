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
  test("checks execution lease at requested time", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "lease-check.sqlite"))
    try {
      ledger.start({ id: "exec-lease", projectID: "project-lease", rootSessionID: "session-lease", fence: 1 })
      ledger.claimOwner({ executionID: "exec-lease", ownerID: "owner", leaseMs: 100, now: 100 })
      expect(ledger.executionLeaseActive("exec-lease", 199)).toBe(true)
      expect(ledger.executionLeaseActive("exec-lease", 200)).toBe(false)
      expect(ledger.executionLeaseActive("missing", 199)).toBe(false)
    } finally {
      ledger.close()
    }
  })

  test("backfills execution, root-session, and project totals from a legacy ledger", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "legacy-ledger.sqlite")
    const legacy = new Database(filepath, { create: true })
    legacy.run(`CREATE TABLE execution (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, root_session_id TEXT NOT NULL, status TEXT NOT NULL,
      fence INTEGER NOT NULL, created_at INTEGER NOT NULL, deadline_at INTEGER, max_calls INTEGER,
      max_cost INTEGER, project_max_cost INTEGER
    )`)
    legacy.run(`CREATE TABLE attempt (
      id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, run_id TEXT NOT NULL, purpose TEXT NOT NULL,
      state TEXT NOT NULL, estimate INTEGER NOT NULL, actual INTEGER, created_at INTEGER,
      dispatched_at INTEGER, settled_at INTEGER
    )`)
    legacy.run(`CREATE TABLE scope_total (
      scope_id TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, pending_calls INTEGER NOT NULL DEFAULT 0,
      spent INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0
    )`)
    legacy
      .query("INSERT INTO execution VALUES (?, ?, ?, 'active', 1, 1, NULL, NULL, NULL, NULL)")
      .run("legacy-exec", "legacy-project", "legacy-root")
    legacy
      .query("INSERT INTO attempt VALUES (?, ?, ?, ?, 'settled', 12, 9, 1, 2, 3)")
      .run("legacy-attempt", "legacy-exec", "legacy-run", "main")
    legacy.close()

    const migrated = ExecutionLedger.open(filepath)
    for (const scopeID of ["execution:legacy-exec", "root-session:legacy-root", "project:legacy-project"]) {
      expect(migrated.totals(scopeID)).toMatchObject({ calls: 1, pending_calls: 0, spent: 9, reserved: 0 })
    }
    migrated.close()

    const reopened = ExecutionLedger.open(filepath)
    expect(reopened.totals("root-session:legacy-root").spent).toBe(9)
    reopened.close()
  })

  test("persists cancellation and rejects later work or completion commit", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-cancel", projectID: "project-cancel", rootSessionID: "session-cancel", fence: 1 })
    ledger.claimOwner({ executionID: "exec-cancel", ownerID: "owner", leaseMs: 100, now: 100 })
    const staged = ledger.stageCompletion({
      executionID: "exec-cancel",
      sessionID: "session-cancel",
      messageID: "message-cancel",
      ownerID: "owner",
      fence: 1,
      finish: "stop",
      payload: "[]",
      reviewFiles: "[]",
      digest: "cancel-digest",
      requiresReview: true,
      revision: 0,
      now: 101,
    })
    expect(staged.staged).toBe(true)
    expect(ledger.cancel({ executionID: "exec-cancel", ownerID: "owner", fence: 1, now: 102 })).toEqual({
      cancelled: true,
    })
    expect(
      ledger.reserve({
        attemptID: "after-cancel",
        executionID: "exec-cancel",
        runID: "owner",
        fence: 1,
        purpose: "agent:reviewer",
        estimateMicrousd: 0,
        now: 103,
      }),
    ).toEqual({ admitted: false, reason: "not_active" })
    expect(
      ledger.commitCompletion({
        executionID: "exec-cancel",
        ownerID: "owner",
        fence: 1,
        digest: "cancel-digest",
        now: 103,
      }),
    ).toEqual({ committed: false, reason: "not_active" })
    ledger.close()
  })

  test("rejects a completion when the execution mutates after staging", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-revision", projectID: "project-revision", rootSessionID: "session-revision", fence: 1 })
    ledger.claimOwner({ executionID: "exec-revision", ownerID: "owner", leaseMs: 100, now: 100 })
    expect(
      ledger.stageCompletion({
        executionID: "exec-revision",
        sessionID: "session-revision",
        messageID: "message-revision",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: "[]",
        reviewFiles: "[]",
        digest: "revision-digest",
        requiresReview: true,
        revision: 0,
        now: 101,
      }),
    ).toMatchObject({ staged: true })
    expect(ledger.recordMutation({ executionID: "exec-revision", ownerID: "owner", fence: 1, now: 102 })).toEqual({
      recorded: true,
      revision: 1,
    })
    expect(
      ledger.commitCompletion({
        executionID: "exec-revision",
        ownerID: "owner",
        fence: 1,
        digest: "revision-digest",
        now: 103,
      }),
    ).toEqual({ committed: false, reason: "stale_revision" })
    ledger.close()
  })

  test("atomically discards a candidate, binds its retry, and keeps a restart-safe continuation outbox", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    ledger.start({ id: "exec-retry", projectID: "project-retry", rootSessionID: "session-retry", fence: 1 })
    ledger.claimOwner({ executionID: "exec-retry", ownerID: "owner", leaseMs: 100, now: 100 })
    expect(
      ledger.stageCompletion({
        executionID: "exec-retry",
        sessionID: "session-retry",
        messageID: "assistant-retry",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: "[]",
        reviewFiles: "[]",
        digest: "retry-digest",
        requiresReview: true,
        revision: 0,
        now: 101,
      }),
    ).toMatchObject({ staged: true })
    expect(
      ledger.retryCompletion({
        id: "retry-intent",
        executionID: "exec-retry",
        sessionID: "session-retry",
        invocationID: "retry-message",
        rootSessionID: "session-retry",
        ownerID: "owner",
        fence: 1,
        digest: "retry-digest",
        payload: '{"message":{},"part":{}}',
        now: 102,
      }),
    ).toEqual({ accepted: true })
    expect(ledger.completion("exec-retry")?.state).toBe("discarded")
    expect(ledger.binding("retry-message")).toMatchObject({ executionID: "exec-retry", invocationID: "retry-message" })
    expect(ledger.pendingContinuations("session-retry")).toEqual([
      expect.objectContaining({ id: "retry-intent", invocationID: "retry-message", state: "pending" }),
    ])
    ledger.close()

    const reopened = ExecutionLedger.open(filepath)
    expect(reopened.pendingContinuations("session-retry")).toHaveLength(1)
    expect(reopened.projectContinuation({ id: "retry-intent", now: 103 })).toEqual({
      projected: true,
      idempotent: false,
    })
    expect(reopened.projectContinuation({ id: "retry-intent", now: 104 })).toEqual({
      projected: true,
      idempotent: true,
    })
    expect(reopened.pendingContinuations("session-retry")).toEqual([])
    reopened.close()
  })

  test("rejects continuation overflow before changing the staged candidate", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    for (let index = 0; index < 101; index++) {
      const executionID = `exec-retry-limit-${index}`
      const digest = `retry-limit-digest-${index}`
      ledger.start({
        id: executionID,
        projectID: "project-retry-limit",
        rootSessionID: "session-retry-limit",
        fence: 1,
      })
      ledger.claimOwner({ executionID, ownerID: "owner", leaseMs: 10_000, now: 100 })
      expect(
        ledger.stageCompletion({
          executionID,
          sessionID: "session-retry-limit",
          messageID: `assistant-retry-limit-${index}`,
          ownerID: "owner",
          fence: 1,
          finish: "stop",
          payload: "[]",
          reviewFiles: "[]",
          digest,
          requiresReview: true,
          revision: 0,
          now: 101,
        }),
      ).toMatchObject({ staged: true })
      const result = ledger.retryCompletion({
        id: `retry-limit-${index}`,
        executionID,
        sessionID: "session-retry-limit",
        invocationID: `retry-message-limit-${index}`,
        rootSessionID: "session-retry-limit",
        ownerID: "owner",
        fence: 1,
        digest,
        payload: '{"message":{},"part":{}}',
        now: 102,
      })
      if (index < 100) expect(result).toEqual({ accepted: true })
      else {
        expect(result).toEqual({ accepted: false, reason: "continuation_limit" })
        expect(ledger.completion(executionID)?.state).toBe("staged")
      }
    }
    expect(ledger.pendingContinuations("session-retry-limit")).toHaveLength(100)
    ledger.close()
  })

  test("dirties mutation revision before invocation and blocks completion on open or unknown work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-work", projectID: "project-work", rootSessionID: "session-work", fence: 1 })
    ledger.claimOwner({ executionID: "exec-work", ownerID: "owner", leaseMs: 10_000, now: 100 })
    ledger.bind({
      executionID: "exec-work",
      rootSessionID: "session-work",
      invocationID: "invocation-work",
      sessionID: "session-work",
      ownerID: "owner",
      fence: 1,
      now: 100,
    })

    expect(
      ledger.registerWork({
        id: "work-mutation",
        executionID: "exec-work",
        invocationID: "invocation-work",
        kind: "tool:write",
        mutating: true,
        ownerID: "owner",
        fence: 1,
        now: 101,
      }),
    ).toEqual({ registered: true, idempotent: false, state: "prepared", version: 1 })
    expect(ledger.revision("exec-work")).toBe(0)
    expect(
      ledger.beginWork({
        id: "work-mutation",
        executionID: "exec-work",
        invocationID: "invocation-work",
        ownerID: "owner",
        fence: 1,
        expectedVersion: 1,
        now: 102,
      }),
    ).toEqual({ began: true, version: 2 })
    expect(ledger.revision("exec-work")).toBe(1)
    expect(
      ledger.stageCompletion({
        executionID: "exec-work",
        sessionID: "session-work",
        messageID: "assistant-work",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: "[]",
        reviewFiles: "[]",
        digest: "work-digest",
        requiresReview: false,
        revision: 1,
        now: 103,
      }),
    ).toEqual({ staged: false, reason: "active_work" })
    expect(
      ledger.finishWork({
        id: "work-mutation",
        executionID: "exec-work",
        ownerID: "owner",
        fence: 1,
        expectedVersion: 2,
        state: "unknown",
        now: 104,
      }),
    ).toEqual({ finished: true, idempotent: false, state: "unknown", version: 3 })
    expect(
      ledger.stageCompletion({
        executionID: "exec-work",
        sessionID: "session-work",
        messageID: "assistant-work",
        ownerID: "owner",
        fence: 1,
        finish: "stop",
        payload: "[]",
        reviewFiles: "[]",
        digest: "work-digest",
        requiresReview: false,
        revision: 1,
        now: 105,
      }),
    ).toEqual({ staged: false, reason: "active_work" })
    ledger.close()
  })

  test("requires the new fenced owner to reconcile work abandoned during takeover", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-reconcile", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-reconcile", ownerID: "owner-a", leaseMs: 10, now: 100 })
    ledger.bind({
      executionID: "exec-reconcile",
      rootSessionID: "session",
      invocationID: "invocation-reconcile",
      sessionID: "session",
      ownerID: "owner-a",
      fence: 1,
      now: 100,
    })
    expect(
      ledger.registerWork({
        id: "work-reconcile",
        executionID: "exec-reconcile",
        invocationID: "invocation-reconcile",
        kind: "tool:write",
        mutating: true,
        ownerID: "owner-a",
        fence: 1,
        now: 101,
      }),
    ).toMatchObject({ registered: true })
    expect(
      ledger.beginWork({
        id: "work-reconcile",
        executionID: "exec-reconcile",
        invocationID: "invocation-reconcile",
        ownerID: "owner-a",
        fence: 1,
        expectedVersion: 1,
        now: 102,
      }),
    ).toEqual({ began: true, version: 2 })
    expect(
      ledger.claimOwner({ executionID: "exec-reconcile", ownerID: "owner-b", leaseMs: 100, now: 110 }),
    ).toMatchObject({ acquired: true, fence: 2, takeover: true })
    expect(
      ledger.finishWork({
        id: "work-reconcile",
        executionID: "exec-reconcile",
        ownerID: "owner-a",
        fence: 1,
        expectedVersion: 2,
        state: "completed",
        now: 111,
      }),
    ).toEqual({ finished: false, reason: "stale_fence" })
    expect(
      ledger.reconcileWork({
        id: "work-reconcile",
        executionID: "exec-reconcile",
        ownerID: "owner-b",
        fence: 2,
        expectedVersion: 3,
        state: "completed",
        evidence: "Artifact hash matches the expected postcondition",
        resolutionCode: "postcondition_verified",
        now: 111,
      }),
    ).toEqual({ reconciled: true, idempotent: false, state: "completed" })
    ledger.close()
  })

  test("does not dirty mutation state when a prepared operation misses its begin deadline", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-prepare-deadline",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      policy: { maxDurationMs: 10 },
      now: 100,
    })
    ledger.claimOwner({ executionID: "exec-prepare-deadline", ownerID: "owner", leaseMs: 100, now: 100 })
    ledger.bind({
      executionID: "exec-prepare-deadline",
      rootSessionID: "session",
      invocationID: "invocation-prepare-deadline",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    expect(
      ledger.registerWork({
        id: "work-prepare-deadline",
        executionID: "exec-prepare-deadline",
        invocationID: "invocation-prepare-deadline",
        kind: "tool:write",
        mutating: true,
        ownerID: "owner",
        fence: 1,
        now: 105,
      }),
    ).toMatchObject({ registered: true, state: "prepared", version: 1 })
    expect(
      ledger.beginWork({
        id: "work-prepare-deadline",
        executionID: "exec-prepare-deadline",
        invocationID: "invocation-prepare-deadline",
        ownerID: "owner",
        fence: 1,
        expectedVersion: 1,
        now: 110,
      }),
    ).toEqual({ began: false, reason: "deadline" })
    expect(ledger.revision("exec-prepare-deadline")).toBe(0)
    expect(
      ledger.finishWork({
        id: "work-prepare-deadline",
        executionID: "exec-prepare-deadline",
        ownerID: "owner",
        fence: 1,
        expectedVersion: 1,
        state: "failed",
        now: 111,
      }),
    ).toEqual({ finished: true, idempotent: false, state: "failed", version: 2 })
    ledger.close()
  })

  test("cancels only one child invocation and leaves its parent and sibling active", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-child-cancel", projectID: "project", rootSessionID: "root", fence: 1 })
    ledger.claimOwner({ executionID: "exec-child-cancel", ownerID: "owner", leaseMs: 100, now: 100 })
    for (const binding of [
      { invocationID: "root-invocation", sessionID: "root", kind: "root" as const },
      { invocationID: "child-a", sessionID: "child-a-session", kind: "child" as const },
      { invocationID: "child-b", sessionID: "child-b-session", kind: "child" as const },
    ]) {
      ledger.bind({
        executionID: "exec-child-cancel",
        rootSessionID: "root",
        parentInvocationID: binding.kind === "child" ? "root-invocation" : undefined,
        ownerID: "owner",
        fence: 1,
        now: 101,
        ...binding,
      })
    }
    ledger.registerWork({
      id: "cancelled-child-work",
      executionID: "exec-child-cancel",
      invocationID: "child-a",
      kind: "tool:bash",
      mutating: true,
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    expect(
      ledger.beginWork({
        id: "cancelled-child-work",
        executionID: "exec-child-cancel",
        invocationID: "child-a",
        ownerID: "owner",
        fence: 1,
        expectedVersion: 1,
        now: 101,
      }),
    ).toEqual({ began: true, version: 2 })
    expect(
      ledger.cancelInvocation({
        invocationID: "child-a",
        executionID: "exec-child-cancel",
        ownerID: "owner",
        fence: 1,
        now: 102,
      }),
    ).toMatchObject({ cancelled: true, invocation: { state: "draining" } })
    expect(ledger.invocation("root-invocation")?.state).toBe("running")
    expect(ledger.invocation("child-b")?.state).toBe("running")
    expect(ledger.blocker("child:child-a")?.state).toBe("draining")
    expect(ledger.blocker("child:child-b")?.state).toBe("running")
    ledger.finishInvocation({
      invocationID: "child-a",
      executionID: "exec-child-cancel",
      ownerID: "owner",
      fence: 1,
      state: "failed",
      reasonCode: "deadline",
      now: 103,
    })
    expect(
      ledger.registerWork({
        id: "late-child-work",
        executionID: "exec-child-cancel",
        invocationID: "child-a",
        kind: "tool:write",
        mutating: true,
        ownerID: "owner",
        fence: 1,
        now: 103,
      }),
    ).toMatchObject({ registered: false, reason: "invalid_invocation" })
    const settle = {
      id: "cancelled-child-work",
      executionID: "exec-child-cancel",
      ownerID: "owner",
      fence: 1,
      state: "unknown" as const,
      now: 104,
    }
    for (const expectedVersion of [1, 4]) {
      expect(ledger.finishWork({ ...settle, expectedVersion })).toMatchObject({
        finished: false,
        reason: "stale_version",
        state: "draining",
        version: 3,
      })
    }
    expect(ledger.finishWork({ ...settle, expectedVersion: 2 })).toEqual({
      finished: true,
      idempotent: false,
      state: "unknown",
      version: 4,
    })
    expect(ledger.finishWork({ ...settle, expectedVersion: 4, state: "completed" })).toMatchObject({
      finished: false,
      reason: "reconciliation_required",
    })
    expect(
      ledger.finishInvocation({
        invocationID: "child-a",
        executionID: "exec-child-cancel",
        ownerID: "owner",
        fence: 1,
        state: "completed",
        now: 105,
      }),
    ).toMatchObject({ finished: false, reason: "terminal" })
    expect(
      ledger.claimStep({
        stepID: "sibling-step",
        executionID: "exec-child-cancel",
        invocationID: "child-b",
        ownerID: "owner",
        fence: 1,
        now: 103,
      }),
    ).toEqual({ admitted: true, idempotent: false })
    ledger.close()
  })

  test("rejects new work at its execution deadline", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-work-deadline",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      policy: { maxDurationMs: 10 },
      now: 100,
    })
    ledger.claimOwner({ executionID: "exec-work-deadline", ownerID: "owner", leaseMs: 100, now: 100 })
    ledger.bind({
      executionID: "exec-work-deadline",
      rootSessionID: "session",
      invocationID: "late-invocation",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    expect(
      ledger.registerWork({
        id: "late-work",
        executionID: "exec-work-deadline",
        invocationID: "late-invocation",
        kind: "tool:read",
        mutating: false,
        ownerID: "owner",
        fence: 1,
        now: 110,
      }),
    ).toEqual({ registered: false, reason: "deadline" })
    ledger.close()
  })

  test("reopens a completed plan item with durable evidence", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-reopen", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-reopen", ownerID: "owner", leaseMs: 100, now: 100 })
    ledger.bind({
      executionID: "exec-reopen",
      rootSessionID: "session",
      invocationID: "invocation",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    const plan = ledger.createPlan({
      executionID: "exec-reopen",
      invocationID: "invocation",
      ownerID: "owner",
      fence: 1,
      items: [{ id: "verify", resourceScope: "plan-item:verify" }],
      now: 102,
    })
    if (!plan.created) throw new Error("expected plan")
    let item = plan.blockers[0]
    item = ledger.transitionBlocker({
      id: item.id,
      executionID: "exec-reopen",
      ownerID: "owner",
      fence: 1,
      expectedVersion: item.version,
      state: "running",
      now: 103,
    }).blocker!
    item = ledger.transitionBlocker({
      id: item.id,
      executionID: "exec-reopen",
      ownerID: "owner",
      fence: 1,
      expectedVersion: item.version,
      state: "resolved",
      evidence: "first verification passed",
      resolutionCode: "verified",
      now: 104,
    }).blocker!
    const reopened = ledger.transitionBlocker({
      id: item.id,
      executionID: "exec-reopen",
      ownerID: "owner",
      fence: 1,
      expectedVersion: item.version,
      state: "reopened",
      evidence: "new evidence invalidated verification",
      resolutionCode: "new_evidence",
      now: 105,
    })
    expect(reopened).toMatchObject({ transitioned: true, blocker: { state: "reopened" } })
    ledger.close()
  })
})
