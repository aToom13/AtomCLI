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
  test("upgrades a legacy completion table that lacks projection columns", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "legacy-completion.sqlite")
    ExecutionLedger.open(filepath).close()
    const legacy = new Database(filepath)
    legacy.run("DROP TABLE execution_completion")
    legacy.run(`CREATE TABLE execution_completion (
      execution_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, fence INTEGER NOT NULL, finish TEXT NOT NULL, payload TEXT NOT NULL,
      digest TEXT NOT NULL, requires_review INTEGER NOT NULL, state TEXT NOT NULL,
      created_at INTEGER NOT NULL, committed_at INTEGER
    )`)
    legacy.close()

    ExecutionLedger.open(filepath).close()
    const migrated = new Database(filepath)
    const columns = migrated
      .query<{ name: string }, []>("PRAGMA table_info(execution_completion)")
      .all()
      .map((column) => column.name)
    migrated.close()
    expect(columns).toContain("projected_at")
    expect(columns).toContain("projection_state")
  })

  test("admits only one of two competing process reservations", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    ledger.start({
      id: "exec-race",
      projectID: "project-race",
      rootSessionID: "session-race",
      fence: 1,
      policy: { maxCostMicrousd: 100 },
    })
    ledger.close()

    const worker = path.join(import.meta.dir, "ledger-worker.ts")
    const startAt = String(Date.now() + 150)
    const children = ["race-a", "race-b"].map((attemptID) =>
      Bun.spawn([process.execPath, "--conditions=browser", worker, filepath, attemptID, startAt], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    const results = await Promise.all(
      children.map(async (child) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        return JSON.parse(stdout) as ExecutionLedger.Admission
      }),
    )

    expect(results.filter((result) => result.admitted)).toHaveLength(1)
    expect(results.filter((result) => !result.admitted)).toEqual([{ admitted: false, reason: "cost_limit" }])
  })

  test("atomically shares call and cost reservations across connections", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const first = ExecutionLedger.open(filepath)
    const second = ExecutionLedger.open(filepath)
    first.start({
      id: "exec-1",
      projectID: "project-1",
      rootSessionID: "session-1",
      fence: 7,
      policy: { maxCalls: 2, maxCostMicrousd: 100, projectMaxCostMicrousd: 100 },
    })

    expect(
      first.reserve({
        attemptID: "attempt-1",
        executionID: "exec-1",
        runID: "run-1",
        fence: 7,
        purpose: "main",
        estimateMicrousd: 60,
      }),
    ).toMatchObject({ admitted: true, idempotent: false })
    expect(
      second.reserve({
        attemptID: "attempt-2",
        executionID: "exec-1",
        runID: "run-2",
        fence: 7,
        purpose: "reviewer",
        estimateMicrousd: 50,
      }),
    ).toEqual({ admitted: false, reason: "cost_limit" })

    expect(first.dispatch({ attemptID: "attempt-1", runID: "run-1", fence: 7 })).toEqual({ dispatched: true })
    expect(first.settle("attempt-1", 70)).toBe("settled")
    expect(first.settle("attempt-1", 70)).toBe("settled")
    expect(second.totals("execution:exec-1")).toEqual({
      calls: 1,
      pending_calls: 0,
      steps: 0,
      spent: 70,
      reserved: 0,
      uncertain: 0,
    })

    first.close()
    second.close()
  })

  test("starts resume as a new segment without resetting calls, steps, cost, or deadline", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-segment-1",
      projectID: "project-resume",
      rootSessionID: "session-resume",
      fence: 1,
      now: 1_000,
      policy: { maxCalls: 2, maxSteps: 2, maxCostMicrousd: 100, maxDurationMs: 1_000 },
    })
    expect(
      ledger.reserve({
        attemptID: "attempt-segment-1",
        executionID: "exec-segment-1",
        runID: "run-1",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 40,
        now: 1_100,
      }),
    ).toMatchObject({ admitted: true })
    expect(ledger.dispatch({ attemptID: "attempt-segment-1", runID: "run-1", fence: 1, now: 1_101 })).toEqual({
      dispatched: true,
    })
    expect(ledger.settle("attempt-segment-1", 40, 1_102)).toBe("settled")
    expect(
      ledger.claimStep({ stepID: "step-segment-1", executionID: "exec-segment-1", fence: 1, now: 1_103 }),
    ).toMatchObject({ admitted: true })
    expect(ledger.cancel({ executionID: "exec-segment-1", ownerID: "run-1", fence: 1, now: 1_200 })).toEqual({
      cancelled: true,
    })

    ledger.start({
      id: "exec-segment-2",
      resumesExecutionID: "exec-segment-1",
      projectID: "project-resume",
      rootSessionID: "session-resume",
      fence: 1,
      now: 1_500,
      policy: { maxCalls: 20, maxSteps: 20, maxCostMicrousd: 1_000, maxDurationMs: 10_000 },
    })

    const resumed = ledger.view("exec-segment-2")!
    expect(resumed).toMatchObject({
      id: "exec-segment-2",
      resumesExecutionID: "exec-segment-1",
      budgetScopeID: "exec-segment-1",
      budget: {
        execution: {
          spentMicrousd: 40,
          calls: { used: 1, limit: 2 },
          steps: { used: 1, limit: 2 },
          deadlineAt: 2_000,
        },
      },
    })
    expect(
      ledger.claimStep({ stepID: "step-segment-2", executionID: "exec-segment-2", fence: 1, now: 1_600 }),
    ).toMatchObject({ admitted: true })
    expect(ledger.claimStep({ stepID: "step-segment-3", executionID: "exec-segment-2", fence: 1, now: 1_601 })).toEqual(
      { admitted: false, reason: "step_limit" },
    )
    expect(
      ledger.reserve({
        attemptID: "attempt-segment-2",
        executionID: "exec-segment-2",
        runID: "run-2",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 61,
        now: 1_602,
      }),
    ).toEqual({ admitted: false, reason: "cost_limit" })
    expect(
      ledger.reserve({
        attemptID: "attempt-segment-3",
        executionID: "exec-segment-2",
        runID: "run-2",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 60,
        now: 2_000,
      }),
    ).toEqual({ admitted: false, reason: "deadline" })
    ledger.close()
  })

  test("keeps uncertain dispatched usage across restart and rejects stale fences", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    ledger.start({ id: "exec-2", projectID: "project-2", rootSessionID: "session-2", fence: 3 })
    expect(
      ledger.reserve({
        attemptID: "stale",
        executionID: "exec-2",
        runID: "old-run",
        fence: 2,
        purpose: "main",
        estimateMicrousd: 10,
      }),
    ).toEqual({ admitted: false, reason: "stale_fence" })
    expect(
      ledger.reserve({
        attemptID: "sent",
        executionID: "exec-2",
        runID: "run",
        fence: 3,
        purpose: "main",
        estimateMicrousd: 25,
      }),
    ).toMatchObject({ admitted: true })
    ledger.dispatch({ attemptID: "sent", runID: "run", fence: 3 })
    ledger.uncertain("sent")
    ledger.close()

    const reopened = ExecutionLedger.open(filepath)
    expect(reopened.totals("execution:exec-2")).toEqual({
      calls: 1,
      pending_calls: 0,
      steps: 0,
      spent: 0,
      reserved: 0,
      uncertain: 25,
    })
    reopened.close()
  })

  test("does not count an idempotent reservation twice and releases only unsent work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-3",
      projectID: "project-3",
      rootSessionID: "session-3",
      fence: 1,
      policy: { maxCalls: 1 },
    })
    const input = {
      attemptID: "same",
      executionID: "exec-3",
      runID: "run",
      fence: 1,
      purpose: "probe",
      estimateMicrousd: 5,
    }
    expect(ledger.reserve(input)).toMatchObject({ admitted: true, idempotent: false })
    expect(ledger.reserve(input)).toMatchObject({ admitted: true, idempotent: true })
    expect(ledger.totals("execution:exec-3").pending_calls).toBe(1)
    expect(ledger.release("same")).toBe("released")
    expect(ledger.totals("execution:exec-3").pending_calls).toBe(0)
    ledger.close()
  })

  test("shares an idempotent step limit across child work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-steps",
      projectID: "project-steps",
      rootSessionID: "session-steps",
      fence: 1,
      policy: { maxSteps: 1 },
    })
    expect(ledger.claimStep({ stepID: "root:1", executionID: "exec-steps", fence: 1 })).toEqual({
      admitted: true,
      idempotent: false,
    })
    expect(ledger.claimStep({ stepID: "root:1", executionID: "exec-steps", fence: 1 })).toEqual({
      admitted: true,
      idempotent: true,
    })
    expect(ledger.claimStep({ stepID: "child:1", executionID: "exec-steps", fence: 1 })).toEqual({
      admitted: false,
      reason: "step_limit",
    })
    expect(ledger.totals("execution:exec-steps").steps).toBe(1)
    ledger.close()
  })

  test("rechecks the deadline immediately before dispatch and releases the reservation", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-deadline",
      projectID: "project-deadline",
      rootSessionID: "session-deadline",
      fence: 1,
      policy: { maxDurationMs: 10 },
      now: 100,
    })
    expect(
      ledger.reserve({
        attemptID: "deadline-attempt",
        executionID: "exec-deadline",
        runID: "deadline-run",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 7,
        now: 105,
      }),
    ).toMatchObject({ admitted: true })
    expect(ledger.dispatch({ attemptID: "deadline-attempt", runID: "deadline-run", fence: 1, now: 111 })).toEqual({
      dispatched: false,
      reason: "deadline",
    })
    expect(ledger.totals("execution:exec-deadline")).toMatchObject({ pending_calls: 0, calls: 0, reserved: 0 })
    ledger.close()
  })

  test("allows ownership recovery after the deadline but blocks new work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-expired-recovery",
      projectID: "project-expired-recovery",
      rootSessionID: "session-expired-recovery",
      fence: 1,
      policy: { maxDurationMs: 10 },
      now: 100,
    })
    expect(
      ledger.claimOwner({ executionID: "exec-expired-recovery", ownerID: "recovery", leaseMs: 10, now: 111 }),
    ).toMatchObject({ acquired: true, fence: 1 })
    expect(
      ledger.reserve({
        attemptID: "expired-new-work",
        executionID: "exec-expired-recovery",
        runID: "recovery",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
        now: 111,
      }),
    ).toEqual({ admitted: false, reason: "deadline" })
    ledger.close()
  })

  test("allows late usage to settle an uncertain dispatched attempt", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-late", projectID: "project-late", rootSessionID: "session-late", fence: 1 })
    ledger.reserve({
      attemptID: "late",
      executionID: "exec-late",
      runID: "run-late",
      fence: 1,
      purpose: "main",
      estimateMicrousd: 25,
    })
    expect(ledger.dispatch({ attemptID: "late", runID: "run-late", fence: 1 })).toEqual({ dispatched: true })
    ledger.uncertain("late")
    expect(ledger.settle("late", 19)).toBe("settled")
    expect(ledger.totals("execution:exec-late")).toMatchObject({ spent: 19, reserved: 0, uncertain: 0 })
    ledger.close()
  })

  test("intersects repeated policy snapshots instead of loosening an execution", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    const base = { id: "exec-tighten", projectID: "project-tighten", rootSessionID: "session-tighten", fence: 1 }
    ledger.start({ ...base, policy: { maxCalls: 3 } })
    ledger.reserve({
      attemptID: "tight-1",
      executionID: base.id,
      runID: "run",
      fence: 1,
      purpose: "main",
      estimateMicrousd: 0,
    })
    expect(ledger.dispatch({ attemptID: "tight-1", runID: "run", fence: 1 })).toEqual({ dispatched: true })
    ledger.settle("tight-1", 0)
    ledger.start({ ...base, policy: { maxCalls: 1 } })
    expect(
      ledger.reserve({
        attemptID: "tight-2",
        executionID: base.id,
        runID: "run",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
      }),
    ).toEqual({ admitted: false, reason: "call_limit" })
    ledger.close()
  })

  test("keeps execution, root-session, and project cost scopes distinct", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    for (const id of ["exec-scope-1", "exec-scope-2"]) {
      ledger.start({
        id,
        projectID: "project-scope",
        rootSessionID: "session-scope",
        fence: 1,
        policy: { maxCostMicrousd: 100, rootMaxCostMicrousd: 70, projectMaxCostMicrousd: 200 },
      })
    }
    const first = {
      attemptID: "scope-1",
      executionID: "exec-scope-1",
      runID: "run",
      fence: 1,
      purpose: "main",
      estimateMicrousd: 50,
    }
    expect(ledger.reserve(first)).toMatchObject({ admitted: true })
    ledger.dispatch({ attemptID: first.attemptID, runID: first.runID, fence: first.fence })
    ledger.settle(first.attemptID, 50)
    expect(
      ledger.reserve({ ...first, attemptID: "scope-2", executionID: "exec-scope-2", estimateMicrousd: 25 }),
    ).toEqual({ admitted: false, reason: "cost_limit" })
    expect(ledger.totals("root-session:session-scope").spent).toBe(50)
    expect(ledger.totals("project:project-scope").spent).toBe(50)
    ledger.close()
  })

  test("emits each budget threshold once and versions late actual usage", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "budget-events.sqlite"))
    ledger.start({
      id: "exec-budget-events",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      policy: { maxCostMicrousd: 100 },
      now: 90,
    })
    ledger.claimOwner({ executionID: "exec-budget-events", ownerID: "owner", leaseMs: 100, now: 100 })
    expect(
      ledger.reserve({
        attemptID: "late-cost",
        executionID: "exec-budget-events",
        runID: "owner",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 50,
        now: 101,
      }),
    ).toMatchObject({ admitted: true })
    expect(ledger.dispatch({ attemptID: "late-cost", runID: "owner", fence: 1, now: 102 })).toEqual({
      dispatched: true,
    })
    ledger.settle("late-cost", 100, 103)
    const warnings = ledger
      .events({ sessionID: "session" })
      .items.filter((event) => event.type === "execution.budget.warning")
    expect(warnings.map((event) => event.properties.budget)).toEqual([
      expect.objectContaining({ scope: "execution", threshold: 80, observedMicrousd: 100 }),
      expect.objectContaining({ scope: "execution", threshold: 100, observedMicrousd: 100 }),
    ])
    expect(warnings[1].resourceVersion).toBeGreaterThan(warnings[0].resourceVersion)
    expect(ledger.settle("late-cost", 100, 104)).toBe("settled")
    expect(
      ledger.events({ sessionID: "session" }).items.filter((event) => event.type === "execution.budget.warning"),
    ).toHaveLength(2)
    ledger.close()
  })

  test("expires an owner lease, increments the fence, and blocks the stale owner", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-owner", projectID: "project-owner", rootSessionID: "session-owner", fence: 1 })

    expect(ledger.claimOwner({ executionID: "exec-owner", ownerID: "owner-a", leaseMs: 10, now: 100 })).toEqual({
      acquired: true,
      fence: 1,
      leaseExpiresAt: 110,
      takeover: false,
    })
    expect(
      ledger.claimStep({
        stepID: "owner-step",
        executionID: "exec-owner",
        ownerID: "owner-a",
        fence: 1,
        now: 101,
      }),
    ).toEqual({ admitted: true, idempotent: false })
    for (const attemptID of ["old-dispatched", "old-pending"]) {
      expect(
        ledger.reserve({
          attemptID,
          executionID: "exec-owner",
          runID: "owner-a",
          fence: 1,
          purpose: "main",
          estimateMicrousd: 5,
          now: 101,
        }),
      ).toMatchObject({ admitted: true })
    }
    expect(ledger.dispatch({ attemptID: "old-dispatched", runID: "owner-a", fence: 1, now: 102 })).toEqual({
      dispatched: true,
    })
    expect(ledger.claimOwner({ executionID: "exec-owner", ownerID: "owner-b", leaseMs: 10, now: 105 })).toEqual({
      acquired: false,
      reason: "owned",
      retryAt: 110,
    })
    expect(ledger.claimOwner({ executionID: "exec-owner", ownerID: "owner-b", leaseMs: 10, now: 110 })).toEqual({
      acquired: true,
      fence: 2,
      leaseExpiresAt: 120,
      takeover: true,
    })
    expect(
      ledger.renewOwner({ executionID: "exec-owner", ownerID: "owner-a", fence: 1, leaseMs: 10, now: 111 }),
    ).toEqual({ renewed: false, reason: "stale_fence" })
    expect(
      ledger.renewOwner({ executionID: "exec-owner", ownerID: "owner-b", fence: 2, leaseMs: 10, now: 111 }),
    ).toEqual({ renewed: true, leaseExpiresAt: 121 })
    expect(
      ledger.claimStep({
        stepID: "owner-step",
        executionID: "exec-owner",
        ownerID: "owner-a",
        fence: 1,
        now: 111,
      }),
    ).toEqual({ admitted: false, reason: "stale_fence" })
    expect(
      ledger.reserve({
        attemptID: "stale-owner-attempt",
        executionID: "exec-owner",
        runID: "owner-a",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
        now: 111,
      }),
    ).toEqual({ admitted: false, reason: "stale_fence" })
    expect(ledger.dispatch({ attemptID: "old-pending", runID: "owner-a", fence: 1, now: 111 })).toEqual({
      dispatched: false,
      reason: "not_reserved",
      state: "released",
    })

    expect(
      ledger.reserve({
        attemptID: "current-owner-attempt",
        executionID: "exec-owner",
        runID: "owner-b",
        fence: 2,
        purpose: "main",
        estimateMicrousd: 5,
        now: 111,
      }),
    ).toMatchObject({ admitted: true })
    expect(ledger.dispatch({ attemptID: "current-owner-attempt", runID: "owner-b", fence: 2, now: 112 })).toEqual({
      dispatched: true,
    })
    expect(ledger.settle("old-dispatched", 4, 113)).toBe("settled")
    expect(ledger.settle("current-owner-attempt", 5, 113)).toBe("settled")
    expect(ledger.totals("execution:exec-owner")).toMatchObject({ calls: 2, pending_calls: 0, spent: 9, reserved: 0 })
    ledger.close()
  })

  test("allows only one process to take ownership after lease expiry", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    ledger.start({ id: "exec-race", projectID: "project-race", rootSessionID: "session-race", fence: 1 })
    ledger.claimOwner({ executionID: "exec-race", ownerID: "expired-owner", leaseMs: 1, now: 1 })
    ledger.close()

    const worker = path.join(import.meta.dir, "ledger-worker.ts")
    const startAt = String(Date.now() + 150)
    const children = ["new-owner-a", "new-owner-b"].map((ownerID) =>
      Bun.spawn([process.execPath, "--conditions=browser", worker, filepath, ownerID, startAt, "claim-owner"], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    const results = await Promise.all(
      children.map(async (child) => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        return JSON.parse(stdout) as { acquired: boolean; fence?: number; reason?: string; retryAt?: number }
      }),
    )

    expect(results.filter((result) => result.acquired)).toHaveLength(1)
    expect(results.filter((result) => !result.acquired)).toEqual([
      { acquired: false, reason: "owned", retryAt: expect.any(Number) },
    ])
    expect(results.find((result) => result.acquired)?.fence).toBe(2)
  })

  test("persists completion and lets only the current fenced owner commit it", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const first = ExecutionLedger.open(filepath)
    first.start({ id: "exec-complete", projectID: "project", rootSessionID: "session", fence: 1 })
    first.claimOwner({ executionID: "exec-complete", ownerID: "owner-a", leaseMs: 10, now: 100 })
    first.bind({
      executionID: "exec-complete",
      rootSessionID: "session",
      invocationID: "root-invocation",
      sessionID: "session",
      kind: "root",
      ownerID: "owner-a",
      fence: 1,
      now: 100,
    })
    const staged = first.stageCompletion({
      executionID: "exec-complete",
      sessionID: "session",
      messageID: "message",
      ownerID: "owner-a",
      fence: 1,
      finish: "stop",
      payload: '[{"type":"text","text":"private"}]',
      reviewFiles: '["src/index.ts"]',
      digest: "digest-a",
      requiresReview: true,
      revision: 0,
      now: 101,
    })
    expect(staged).toMatchObject({ staged: true, idempotent: false, completion: { state: "staged" } })
    expect(
      first.reserve({
        attemptID: "normal-while-finalizing",
        executionID: "exec-complete",
        runID: "owner-a",
        fence: 1,
        purpose: "agent:build",
        estimateMicrousd: 0,
        now: 102,
      }),
    ).toEqual({ admitted: false, reason: "not_active" })
    const reviewClaim = first.claimReview({
      id: "review-claim",
      executionID: "exec-complete",
      ownerID: "owner-a",
      fence: 1,
      digest: "digest-a",
      revision: 0,
      now: 102,
    })
    expect(reviewClaim).toMatchObject({ claimed: true, claim: { state: "pending" } })
    expect(
      first.reserve({
        attemptID: "unclaimed-reviewer",
        executionID: "exec-complete",
        runID: "owner-a",
        fence: 1,
        purpose: "agent:reviewer",
        sessionID: "ordinary-reviewer-session",
        estimateMicrousd: 0,
        now: 102,
      }),
    ).toEqual({ admitted: false, reason: "not_active" })
    expect(
      first.authorizeReviewSession({
        executionID: "exec-complete",
        reviewID: "review-claim",
        sessionID: "authorized-reviewer-session",
        ownerID: "owner-a",
        fence: 1,
        now: 102,
      }),
    ).toEqual({ authorized: true })
    first.bind({
      executionID: "exec-complete",
      rootSessionID: "session",
      invocationID: "reviewer-invocation",
      sessionID: "authorized-reviewer-session",
      parentInvocationID: "root-invocation",
      kind: "reviewer",
      ownerID: "owner-a",
      fence: 1,
      now: 102,
    })
    expect(
      first.claimStep({
        stepID: "unauthorized-finalizing-step",
        executionID: "exec-complete",
        ownerID: "owner-a",
        fence: 1,
        now: 102,
      }),
    ).toEqual({ admitted: false, reason: "not_active" })
    expect(
      first.claimStep({
        stepID: "authorized-finalizing-step",
        executionID: "exec-complete",
        invocationID: "reviewer-invocation",
        ownerID: "owner-a",
        fence: 1,
        now: 102,
      }),
    ).toEqual({ admitted: true, idempotent: false })
    const reviewAdmission = first.reserve({
      attemptID: "review-while-finalizing",
      executionID: "exec-complete",
      invocationID: "reviewer-invocation",
      runID: "owner-a",
      fence: 1,
      purpose: "agent:reviewer",
      sessionID: "authorized-reviewer-session",
      estimateMicrousd: 0,
      now: 102,
    })
    expect(reviewAdmission).toMatchObject({ admitted: true })
    expect(first.dispatch({ attemptID: "review-while-finalizing", runID: "owner-a", fence: 1, now: 102 })).toEqual({
      dispatched: true,
    })
    first.settle("review-while-finalizing", 0, 102)
    expect(
      first.recordReview({
        executionID: "exec-complete",
        reviewID: "review-claim",
        ownerID: "owner-a",
        fence: 1,
        state: "passed",
        now: 103,
      }),
    ).toMatchObject({ recorded: true, claim: { state: "passed" } })
    first.close()

    const recovered = ExecutionLedger.open(filepath)
    expect(recovered.completion("exec-complete")).toMatchObject({
      digest: "digest-a",
      reviewFiles: '["src/index.ts"]',
      state: "staged",
    })
    expect(
      recovered.claimOwner({ executionID: "exec-complete", ownerID: "owner-b", leaseMs: 10, now: 110 }),
    ).toMatchObject({
      acquired: true,
      fence: 2,
      takeover: true,
    })
    expect(
      recovered.commitCompletion({
        executionID: "exec-complete",
        ownerID: "owner-a",
        fence: 1,
        digest: "digest-a",
        now: 111,
      }),
    ).toEqual({ committed: false, reason: "stale_fence" })
    expect(
      recovered.commitCompletion({
        executionID: "exec-complete",
        ownerID: "owner-b",
        fence: 2,
        digest: "wrong-digest",
        now: 111,
      }),
    ).toEqual({ committed: false, reason: "stale_candidate" })
    const committed = recovered.commitCompletion({
      executionID: "exec-complete",
      ownerID: "owner-b",
      fence: 2,
      digest: "digest-a",
      now: 111,
    })
    expect(committed).toMatchObject({ committed: true, idempotent: false, completion: { state: "committed" } })
    expect(recovered.active("session")).toBeUndefined()
    expect(recovered.inherit({ parentSessionID: "session", childSessionID: "late-child", now: 112 })).toBe(false)
    const committedEvents = recovered.events({ sessionID: "session" })
    expect(committedEvents.items.at(-1)).toEqual(
      expect.objectContaining({
        cursor: { epoch: committedEvents.epoch, sequence: expect.any(Number) },
        sessionID: "session",
        sessionGeneration: 1,
        executionID: "exec-complete",
        resourceVersion: recovered.execution("exec-complete")!.version,
        type: "execution.updated",
        properties: { execution: expect.objectContaining({ outcome: "completed", lifecycle: "terminal" }) },
      }),
    )
    expect(recovered.pendingCompletions("session")).toEqual([
      expect.objectContaining({ executionID: "exec-complete", digest: "digest-a", state: "committed" }),
    ])
    const projectionClaim = claimCompletion(recovered, "session", "exec-complete", "projector-a", 112)
    expect(recovered.ackCompletion({ ...projectionClaim, now: 113 })).toEqual({
      projected: true,
      idempotent: false,
    })
    const projectedEvents = recovered.events({
      sessionID: "session",
      afterSequence: committedEvents.items.at(-1)!.cursor.sequence,
    })
    expect(projectedEvents.epoch).toBe(committedEvents.epoch)
    expect(projectedEvents.items).toEqual([
      expect.objectContaining({
        cursor: {
          epoch: committedEvents.epoch,
          sequence: committedEvents.items.at(-1)!.cursor.sequence + 1,
        },
        executionID: "exec-complete",
        resourceVersion: recovered.execution("exec-complete")!.version,
      }),
    ])
    expect(recovered.ackCompletion({ ...projectionClaim, now: 114 })).toEqual({
      projected: true,
      idempotent: true,
    })
    expect(recovered.pendingCompletions("session")).toEqual([])
    expect(
      recovered.reserve({
        attemptID: "after-completion",
        executionID: "exec-complete",
        runID: "owner-b",
        fence: 2,
        purpose: "main",
        estimateMicrousd: 0,
        now: 111,
      }),
    ).toEqual({ admitted: false, reason: "not_active" })
    expect(
      recovered.commitCompletion({
        executionID: "exec-complete",
        ownerID: "owner-b",
        fence: 2,
        digest: "digest-a",
        now: 112,
      }),
    ).toMatchObject({ committed: true, idempotent: true })
    recovered.close()
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

  test("reserves slice allowance atomically and persists bounded checkpoint grants", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    ledger.start({ id: "exec-slices", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.savePolicyState({
      executionID: "exec-slices",
      contract: {},
      policy: {},
      evidence: {},
      promotionReasons: [],
      classifierFallback: false,
      extensionCount: 0,
      sliceLimit: 2,
      sliceStartCalls: 0,
    })
    const reservations = await Promise.all(
      Array.from({ length: 5 }, async () => ledger.reserveToolAllowance("exec-slices")),
    )
    expect(reservations.filter(Boolean)).toHaveLength(2)
    expect(ledger.sliceCheckpointRequired("exec-slices")).toBe(true)
    ledger.releaseToolAllowance("exec-slices")
    expect(ledger.reserveToolAllowance("exec-slices")).toBe(true)
    expect(ledger.reserveToolAllowance("exec-slices")).toBe(false)
    expect(ledger.requestCheckpoint("exec-slices")).toBe(true)
    expect(ledger.sliceCheckpointRequired("exec-slices")).toBe(true)
    for (let sequence = 1; sequence <= 4; sequence++) {
      const applied = ledger.applyCheckpoint({
        executionID: "exec-slices",
        checkpointID: `checkpoint-${sequence}`,
        decision: "continue",
        requestedCalls: 80,
        payload: { progress: sequence },
        now: 100 + sequence,
      })
      expect(applied).toEqual({ sequence, grantedCalls: 50, idempotent: false })
      expect(
        ledger.applyCheckpoint({
          executionID: "exec-slices",
          checkpointID: `checkpoint-${sequence}`,
          decision: "continue",
          requestedCalls: 80,
          payload: { progress: sequence },
          now: 200 + sequence,
        }),
      ).toEqual({ sequence, grantedCalls: 50, idempotent: true })
    }
    expect(ledger.getPolicyState("exec-slices")).toMatchObject({ extensionCount: 4, sliceLimit: 50 })
    ledger.close()
    const reopened = ExecutionLedger.open(filepath)
    expect(reopened.checkpoints("exec-slices")).toHaveLength(4)
    expect(reopened.getPolicyState("exec-slices")).toMatchObject({ extensionCount: 4, sliceLimit: 50 })
    reopened.close()
  })

  test("keeps blocked checkpoints active while waiting for new user input", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-wait", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-wait", ownerID: "owner", leaseMs: 1_000, now: 100 })
    ledger.bind({
      executionID: "exec-wait",
      rootSessionID: "session",
      invocationID: "first",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    expect(
      ledger.recordObjective({
        executionID: "exec-wait",
        messageID: "first",
        objective: "Complete the durable execution task",
        now: 101,
      }),
    ).toBe(true)
    expect(
      ledger.recordObjective({
        executionID: "exec-wait",
        messageID: "first",
        objective: "Complete the durable execution task",
        now: 101,
      }),
    ).toBe(false)
    expect(
      ledger.waitForInput({
        executionID: "exec-wait",
        invocationID: "first",
        ownerID: "owner",
        fence: 1,
        reason: "credentials required",
        now: 102,
      }),
    ).toEqual({ waiting: true })
    expect(ledger.view("exec-wait")).toMatchObject({ lifecycle: "active", phase: "waiting_input" })
    ledger.bind({
      executionID: "exec-wait",
      rootSessionID: "session",
      invocationID: "second",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      replacesInvocationID: "first",
      now: 103,
    })
    expect(ledger.view("exec-wait")).toMatchObject({ lifecycle: "active", phase: "model" })
    expect(ledger.invocation("first")).toMatchObject({ state: "completed", finishedAt: 103 })
    expect(ledger.invocation("second")).toMatchObject({ state: "running" })
    expect(ledger.objective("exec-wait")).toMatchObject({
      message_id: "first",
      objective: "Complete the durable execution task",
    })
    ledger.close()
  })

  test("creates a versioned plan atomically and requires exact authority to waive an item", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-plan", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-plan", ownerID: "owner", leaseMs: 100, now: 100 })
    ledger.bind({
      executionID: "exec-plan",
      rootSessionID: "session",
      invocationID: "plan-invocation",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    const plan = ledger.createPlan({
      executionID: "exec-plan",
      invocationID: "plan-invocation",
      ownerID: "owner",
      fence: 1,
      items: [
        { id: "implement", resourceScope: "plan-item:implement" },
        { id: "verify", resourceScope: "plan-item:verify" },
      ],
      now: 102,
    })
    expect(plan).toMatchObject({ created: true, idempotent: false, revision: 1 })
    if (!plan.created) throw new Error("expected plan creation")
    expect(plan.blockers).toHaveLength(2)
    expect(ledger.planRevision("exec-plan")).toBe(1)
    const revision = ledger.createPlan({
      executionID: "exec-plan",
      invocationID: "plan-invocation",
      ownerID: "owner",
      fence: 1,
      items: [{ id: "replacement", resourceScope: "plan-item:replacement" }],
      now: 103,
    })
    expect(revision).toMatchObject({ created: true, idempotent: false, revision: 2 })
    expect(ledger.planRevision("exec-plan")).toBe(2)

    const item = plan.blockers[0]
    expect(
      ledger.transitionBlocker({
        id: item.id,
        executionID: "exec-plan",
        ownerID: "owner",
        fence: 1,
        expectedVersion: item.version,
        state: "waived",
        evidence: "user chose to omit this item",
        resolutionCode: "plan_item_user_waiver",
        planRevision: 1,
        now: 104,
      }),
    ).toMatchObject({ transitioned: false, reason: "authority_required" })
    expect(
      ledger.transitionBlocker({
        id: item.id,
        executionID: "exec-plan",
        ownerID: "owner",
        fence: 1,
        expectedVersion: item.version,
        state: "waived",
        evidence: "user chose to omit this item",
        resolutionCode: "plan_item_user_waiver",
        authority: "user",
        planRevision: 2,
        now: 104,
      }),
    ).toMatchObject({ transitioned: false, reason: "stale_plan_revision" })
    expect(
      ledger.transitionBlocker({
        id: item.id,
        executionID: "exec-plan",
        ownerID: "owner",
        fence: 1,
        expectedVersion: item.version,
        state: "waived",
        evidence: "user chose to omit this item",
        resolutionCode: "plan_item_user_waiver",
        authority: "user",
        planRevision: 1,
        now: 104,
      }),
    ).toMatchObject({ transitioned: true, blocker: { state: "waived", planRevision: 1 } })
    const blockerEvents = ledger
      .events({ sessionID: "session" })
      .items.filter((event) => event.type === "execution.blocker.updated")
    expect(blockerEvents).toHaveLength(3)
    expect(blockerEvents.at(-1)?.properties).toMatchObject({ blocker: { id: item.id, state: "waived" } })
    ledger.close()
  })

  test("lists and snapshots executions with scoped cursors and explicit replay resync", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    for (const [index, id] of ["exec-page-1", "exec-page-2", "exec-page-3"].entries()) {
      ledger.start({
        id,
        projectID: "project-page",
        rootSessionID: "session-page",
        fence: 1,
        sessionGeneration: 4,
        now: 100 + index,
      })
    }
    ledger.bind({
      executionID: "exec-page-3",
      rootSessionID: "session-page",
      invocationID: "invocation-page-3",
      sessionID: "session-page",
      kind: "root",
      acceptedMessageID: "message-page-3",
      ownerID: "owner",
      fence: 1,
      now: 104,
    })

    const first = ledger.list({ sessionID: "session-page", limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(["exec-page-3", "exec-page-2"])
    expect(first.nextCursor).toBeString()
    expect(first.sessionGeneration).toBe(4)
    expect(first.activeExecutionID).toBe("exec-page-3")
    const second = ledger.list({ sessionID: "session-page", cursor: first.nextCursor, limit: 2 })
    expect(second.items.map((item) => item.id)).toEqual(["exec-page-1"])
    expect(second.nextCursor).toBeUndefined()
    expect(() => ledger.list({ sessionID: "different-session", cursor: first.nextCursor })).toThrow("cursor")

    const snapshot = ledger.snapshot("session-page")
    expect(snapshot.cursor.sequence).toBeGreaterThan(0)
    expect(snapshot.activeInvocations.map((item) => item.id)).toEqual(["invocation-page-3"])
    expect(snapshot.executions).toHaveLength(3)
    expect(
      ledger.events({ sessionID: "session-page", cursor: { epoch: "restored-database", sequence: 0 } }),
    ).toMatchObject({ resyncRequired: true, reason: "epoch_changed" })
    expect(
      ledger.events({
        sessionID: "session-page",
        cursor: { epoch: snapshot.cursor.epoch, sequence: snapshot.cursor.sequence + 100 },
      }),
    ).toMatchObject({ resyncRequired: true, reason: "cursor_ahead" })
    ledger.close()
  })

  test("CAS-decides a durable route proposal and applies it only at a safe boundary", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "exec-route",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      sessionGeneration: 2,
      now: 100,
    })
    ledger.claimOwner({ executionID: "exec-route", ownerID: "owner", leaseMs: 1_000, now: 100 })
    ledger.bind({
      executionID: "exec-route",
      rootSessionID: "session",
      invocationID: "invocation-route",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    const proposed = ledger.proposeRoute({
      id: "proposal-route",
      executionID: "exec-route",
      invocationID: "invocation-route",
      ownerID: "owner",
      fence: 1,
      stepID: "step-1",
      expectedRouteRevision: 1,
      sessionGeneration: 2,
      fromRoute: { providerID: "provider", modelID: "base" },
      toRoute: { providerID: "provider", modelID: "expert", variant: "high" },
      paramsDigest: "params",
      scope: "expert",
      reasonCode: "concurrency_or_persistence",
      evidenceRefs: ["test:race"],
      expiresAt: 1_000,
      policyVersion: 1,
      credentialRevision: "credential-1",
      now: 102,
    })
    expect(proposed).toMatchObject({ proposed: true, idempotent: false, proposal: { state: "pending", version: 1 } })
    expect(ledger.snapshot("session", 102).pendingProposals).toHaveLength(1)

    const accepted = ledger.decideRouteProposal({
      requestID: "decision-1",
      proposalID: "proposal-route",
      executionID: "exec-route",
      sessionID: "session",
      projectID: "project",
      expectedProposalVersion: 1,
      expectedRouteRevision: 1,
      decision: "accept",
      actorID: "user",
      acceptScope: "execution",
      now: 103,
    })
    expect(accepted).toMatchObject({ decided: true, idempotent: false, proposal: { state: "accepted", version: 2 } })
    expect(
      ledger.decideRouteProposal({
        requestID: "decision-2",
        proposalID: "proposal-route",
        executionID: "exec-route",
        sessionID: "session",
        projectID: "project",
        expectedProposalVersion: 1,
        expectedRouteRevision: 1,
        decision: "accept",
        actorID: "other-user",
        now: 104,
      }),
    ).toMatchObject({ decided: false, reason: "stale_version" })
    expect(
      ledger.decideRouteProposal({
        requestID: "decision-1",
        proposalID: "proposal-route",
        executionID: "exec-route",
        sessionID: "session",
        projectID: "project",
        expectedProposalVersion: 1,
        expectedRouteRevision: 1,
        decision: "accept",
        actorID: "user",
        acceptScope: "execution",
        now: 105,
      }),
    ).toMatchObject({ decided: true, idempotent: true })

    expect(
      ledger.reserve({
        attemptID: "route-attempt",
        executionID: "exec-route",
        invocationID: "invocation-route",
        runID: "owner",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
        now: 106,
      }),
    ).toMatchObject({ admitted: true })
    expect(ledger.dispatch({ attemptID: "route-attempt", runID: "owner", fence: 1, now: 107 })).toEqual({
      dispatched: true,
    })
    expect(
      ledger.applyRouteProposal({
        proposalID: "proposal-route",
        executionID: "exec-route",
        invocationID: "invocation-route",
        ownerID: "owner",
        fence: 1,
        expectedProposalVersion: 2,
        expectedRouteRevision: 1,
        paramsDigest: "params",
        expertLimits: { maxEpisodes: 2, maxCalls: 3, maxSteps: 3 },
        now: 108,
      }),
    ).toEqual({ applied: false, reason: "unsafe_boundary" })
    ledger.settle("route-attempt", 0, 109)
    expect(
      ledger.applyRouteProposal({
        proposalID: "proposal-route",
        executionID: "exec-route",
        invocationID: "invocation-route",
        ownerID: "owner",
        fence: 1,
        expectedProposalVersion: 2,
        expectedRouteRevision: 1,
        paramsDigest: "params",
        expertLimits: { maxEpisodes: 2, maxCalls: 3, maxSteps: 3 },
        now: 110,
      }),
    ).toMatchObject({ applied: true, routeRevision: 2, proposal: { state: "applied", version: 3 } })
    expect(ledger.view("exec-route")).toMatchObject({
      routeRevision: 2,
      phase: "model",
      route: {
        active: { providerID: "provider", modelID: "expert", variant: "high" },
        base: { providerID: "provider", modelID: "base" },
        stage: "expert",
        activeEpisodeID: "proposal-route",
        expert: { episodes: 1, maxEpisodes: 2, calls: 0, maxCalls: 3, steps: 0, maxSteps: 3 },
      },
    })
    for (let index = 1; index <= 3; index++) {
      expect(
        ledger.reserve({
          attemptID: `expert-attempt-${index}`,
          executionID: "exec-route",
          invocationID: "invocation-route",
          runID: "owner",
          fence: 1,
          purpose: "expert",
          estimateMicrousd: 0,
          now: 110 + index,
        }),
      ).toMatchObject({ admitted: true })
      ledger.dispatch({ attemptID: `expert-attempt-${index}`, runID: "owner", fence: 1, now: 110 + index })
      ledger.settle(`expert-attempt-${index}`, 0, 110 + index)
      expect(
        ledger.claimStep({
          stepID: `expert-step-${index}`,
          executionID: "exec-route",
          invocationID: "invocation-route",
          ownerID: "owner",
          fence: 1,
          now: 110 + index,
        }),
      ).toMatchObject({ admitted: true })
    }
    expect(
      ledger.reserve({
        attemptID: "expert-attempt-over-limit",
        executionID: "exec-route",
        invocationID: "invocation-route",
        runID: "owner",
        fence: 1,
        purpose: "expert",
        estimateMicrousd: 0,
        now: 114,
      }),
    ).toEqual({ admitted: false, reason: "call_limit" })
    expect(
      ledger.claimStep({
        stepID: "expert-step-over-limit",
        executionID: "exec-route",
        invocationID: "invocation-route",
        ownerID: "owner",
        fence: 1,
        now: 114,
      }),
    ).toEqual({ admitted: false, reason: "step_limit" })
    expect(ledger.snapshot("session", 110).pendingProposals).toEqual([])
    expect(
      ledger.proposeRoute({
        id: "proposal-route-auto",
        executionID: "exec-route",
        invocationID: "invocation-route",
        ownerID: "owner",
        fence: 1,
        stepID: "step-2",
        expectedRouteRevision: 2,
        sessionGeneration: 2,
        fromRoute: { providerID: "provider", modelID: "expert", variant: "high" },
        toRoute: { providerID: "provider", modelID: "expert", variant: "high" },
        paramsDigest: "params",
        scope: "expert",
        reasonCode: "concurrency_or_persistence",
        evidenceRefs: ["test:race-2"],
        expiresAt: 1_000,
        policyVersion: 1,
        credentialRevision: "credential-1",
        autoAccept: true,
        now: 111,
      }),
    ).toMatchObject({ proposed: true, idempotent: false, proposal: { state: "accepted", actorID: "user" } })
    expect(
      ledger.returnFromExpert({
        id: "expert-handoff:exec-route:proposal-route",
        executionID: "exec-route",
        sessionID: "session",
        invocationID: "invocation-handoff",
        rootSessionID: "session",
        ownerID: "owner",
        fence: 1,
        episodeID: "proposal-route",
        expectedRouteRevision: 2,
        payload: '{"handoff":true}',
        now: 112,
      }),
    ).toMatchObject({
      returned: true,
      routeRevision: 3,
      route: { providerID: "provider", modelID: "base" },
    })
    expect(ledger.view("exec-route")).toMatchObject({
      routeRevision: 3,
      route: { active: { modelID: "base" }, stage: "base" },
    })
    expect(ledger.routeProposal("proposal-route-auto")).toMatchObject({ state: "superseded", version: 2 })
    expect(ledger.pendingContinuations("session")).toEqual([
      expect.objectContaining({ kind: "expert_handoff", invocationID: "invocation-handoff", state: "pending" }),
    ])
    ledger.close()
  })

  test("expires route proposals before returning a snapshot", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-expiry", projectID: "project", rootSessionID: "session", fence: 1, now: 100 })
    ledger.claimOwner({ executionID: "exec-expiry", ownerID: "owner", leaseMs: 1_000, now: 100 })
    ledger.bind({
      executionID: "exec-expiry",
      rootSessionID: "session",
      invocationID: "invocation-expiry",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    ledger.proposeRoute({
      id: "proposal-expiry",
      executionID: "exec-expiry",
      invocationID: "invocation-expiry",
      ownerID: "owner",
      fence: 1,
      stepID: "step-1",
      expectedRouteRevision: 1,
      sessionGeneration: 1,
      fromRoute: { providerID: "provider", modelID: "base" },
      toRoute: { providerID: "provider", modelID: "base", variant: "high" },
      paramsDigest: "params",
      scope: "thinking",
      reasonCode: "complex_analysis",
      evidenceRefs: ["test:complex"],
      expiresAt: 110,
      policyVersion: 1,
      credentialRevision: "credential-1",
      now: 102,
    })

    expect(ledger.snapshot("session", 111).pendingProposals).toEqual([])
    expect(ledger.routeProposal("proposal-expiry")).toMatchObject({ state: "expired", version: 2 })
    ledger.close()
  })

  test("CAS-cancels public execution requests and keeps duplicate requests idempotent", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-public-cancel", projectID: "project", rootSessionID: "session", fence: 1 })
    const version = ledger.view("exec-public-cancel")!.version
    const first = ledger.requestCancel({
      requestID: "cancel-request-1",
      executionID: "exec-public-cancel",
      sessionID: "session",
      projectID: "project",
      expectedVersion: version,
    })
    expect(first).toMatchObject({
      accepted: true,
      idempotent: false,
      execution: { lifecycle: "terminal", outcome: "cancelled", reason: { code: "user_cancelled" } },
    })
    expect(
      ledger.requestCancel({
        requestID: "cancel-request-1",
        executionID: "exec-public-cancel",
        sessionID: "session",
        projectID: "project",
        expectedVersion: version,
      }),
    ).toMatchObject({ accepted: true, idempotent: true, version: first.version })
    expect(
      ledger.requestCancel({
        requestID: "cancel-request-2",
        executionID: "exec-public-cancel",
        sessionID: "session",
        projectID: "project",
        expectedVersion: version,
      }),
    ).toMatchObject({ accepted: false, reason: "stale_version" })
    ledger.close()
  })

  test("requires evidence and two CAS versions for public unknown-work reconciliation", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-public-reconcile", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-public-reconcile", ownerID: "owner-a", leaseMs: 10, now: 100 })
    ledger.bind({
      executionID: "exec-public-reconcile",
      rootSessionID: "session",
      invocationID: "invocation-reconcile",
      sessionID: "session",
      ownerID: "owner-a",
      fence: 1,
      now: 101,
    })
    const work = ledger.registerWork({
      id: "operation-reconcile",
      executionID: "exec-public-reconcile",
      invocationID: "invocation-reconcile",
      kind: "tool:write",
      mutating: true,
      ownerID: "owner-a",
      fence: 1,
      now: 102,
    })
    expect(work).toMatchObject({ registered: true, version: 1 })
    expect(
      ledger.beginWork({
        id: "operation-reconcile",
        executionID: "exec-public-reconcile",
        invocationID: "invocation-reconcile",
        ownerID: "owner-a",
        fence: 1,
        expectedVersion: 1,
        now: 103,
      }),
    ).toMatchObject({ began: true, version: 2 })
    expect(
      ledger.claimOwner({ executionID: "exec-public-reconcile", ownerID: "owner-b", leaseMs: 100, now: 111 }),
    ).toMatchObject({ acquired: true, takeover: true, fence: 2 })
    const version = ledger.view("exec-public-reconcile")!.version
    expect(
      ledger.requestReconcile({
        requestID: "reconcile-without-evidence",
        executionID: "exec-public-reconcile",
        sessionID: "session",
        projectID: "project",
        operationID: "operation-reconcile",
        state: "completed",
        expectedVersion: version,
        expectedWorkVersion: 3,
        evidence: "",
        resolutionCode: "observed_exit",
      }),
    ).toEqual({ reconciled: false, reason: "evidence_required" })
    const result = ledger.requestReconcile({
      requestID: "reconcile-request-1",
      executionID: "exec-public-reconcile",
      sessionID: "session",
      projectID: "project",
      operationID: "operation-reconcile",
      state: "completed",
      expectedVersion: version,
      expectedWorkVersion: 3,
      evidence: "Observed the durable output and matching operation token.",
      resolutionCode: "verified_effect",
    })
    expect(result).toMatchObject({ reconciled: true, idempotent: false, version: version + 1 })
    expect(
      ledger.requestReconcile({
        requestID: "reconcile-request-1",
        executionID: "exec-public-reconcile",
        sessionID: "session",
        projectID: "project",
        operationID: "operation-reconcile",
        state: "completed",
        expectedVersion: version,
        expectedWorkVersion: 3,
        evidence: "Observed the durable output and matching operation token.",
        resolutionCode: "verified_effect",
      }),
    ).toMatchObject({ reconciled: true, idempotent: true, version: version + 1 })
    ledger.close()
  })

  test("blocks a new root on unknown mutating work without leaking the rejected execution", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-old", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-old", ownerID: "owner-a", leaseMs: 10, now: 100 })
    ledger.bind({
      executionID: "exec-old",
      rootSessionID: "session",
      invocationID: "invocation-old",
      sessionID: "session",
      kind: "root",
      ownerID: "owner-a",
      fence: 1,
      now: 101,
    })
    ledger.registerWork({
      id: "operation-old",
      executionID: "exec-old",
      invocationID: "invocation-old",
      kind: "tool:write",
      mutating: true,
      ownerID: "owner-a",
      fence: 1,
      now: 102,
    })
    ledger.beginWork({
      id: "operation-old",
      executionID: "exec-old",
      invocationID: "invocation-old",
      ownerID: "owner-a",
      fence: 1,
      expectedVersion: 1,
      now: 103,
    })
    ledger.claimOwner({ executionID: "exec-old", ownerID: "owner-b", leaseMs: 100, now: 111 })

    expect(ledger.view("exec-old")?.unknownWork).toEqual([
      {
        id: "operation-old",
        executionID: "exec-old",
        invocationID: "invocation-old",
        kind: "tool:write",
        mutating: true,
        state: "unknown",
        version: 3,
        createdAt: 102,
        beganAt: 103,
      },
    ])

    ledger.start({ id: "exec-new", projectID: "project", rootSessionID: "session", fence: 1, now: 112 })
    ledger.claimOwner({ executionID: "exec-new", ownerID: "owner-b", leaseMs: 100, now: 112 })
    expect(
      ledger.bind({
        executionID: "exec-new",
        rootSessionID: "session",
        invocationID: "invocation-new",
        sessionID: "session",
        kind: "root",
        ownerID: "owner-b",
        fence: 1,
        now: 113,
      }),
    ).toBeUndefined()
    expect(ledger.view("exec-new")).toMatchObject({
      lifecycle: "terminal",
      outcome: "failed",
      reason: { code: "recovery_required", retryable: true },
    })
    expect(ledger.snapshot("session").activeExecutionID).toBe("exec-old")
    expect(ledger.snapshot("session").activeInvocations).toEqual([
      expect.objectContaining({ id: "invocation-old", state: "unknown" }),
    ])
    const reconciled = ledger.requestReconcile({
      requestID: "reconcile-old",
      executionID: "exec-old",
      sessionID: "session",
      projectID: "project",
      operationID: "operation-old",
      state: "cancelled",
      expectedVersion: ledger.view("exec-old")!.version,
      expectedWorkVersion: 3,
      evidence: "User confirmed operation operation-old was not applied.",
      resolutionCode: "user_confirmed_not_applied",
      now: 114,
    })
    expect(reconciled).toMatchObject({ reconciled: true, execution: { unknownWork: [] } })
    ledger.start({ id: "exec-after", projectID: "project", rootSessionID: "session", fence: 1, now: 115 })
    ledger.claimOwner({ executionID: "exec-after", ownerID: "owner-b", leaseMs: 100, now: 115 })
    expect(
      ledger.bind({
        executionID: "exec-after",
        rootSessionID: "session",
        invocationID: "invocation-after",
        sessionID: "session",
        kind: "root",
        ownerID: "owner-b",
        fence: 1,
        now: 116,
      }),
    ).toMatchObject({ executionID: "exec-after" })
    ledger.close()
  })

  test("ignores a stale terminal invocation with no unknown work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "exec-old", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.claimOwner({ executionID: "exec-old", ownerID: "owner-a", leaseMs: 10, now: 100 })
    ledger.bind({
      executionID: "exec-old",
      rootSessionID: "session",
      invocationID: "invocation-old",
      sessionID: "session",
      kind: "root",
      ownerID: "owner-a",
      fence: 1,
      now: 101,
    })
    ledger.finishInvocation({
      invocationID: "invocation-old",
      executionID: "exec-old",
      ownerID: "owner-a",
      fence: 1,
      state: "unknown",
      now: 102,
    })
    ledger.requestCancel({
      requestID: "cancel-old",
      executionID: "exec-old",
      sessionID: "session",
      projectID: "project",
      expectedVersion: ledger.view("exec-old")!.version,
      now: 103,
    })

    ledger.start({ id: "exec-new", projectID: "project", rootSessionID: "session", fence: 1, now: 104 })
    ledger.claimOwner({ executionID: "exec-new", ownerID: "owner-b", leaseMs: 100, now: 104 })
    expect(
      ledger.bind({
        executionID: "exec-new",
        rootSessionID: "session",
        invocationID: "invocation-new",
        sessionID: "session",
        kind: "root",
        ownerID: "owner-b",
        fence: 1,
        now: 105,
      }),
    ).toMatchObject({ executionID: "exec-new", invocationID: "invocation-new" })
    expect(ledger.invocation("invocation-old")?.state).toBe("completed")
    expect(ledger.snapshot("session").activeInvocations).toEqual([
      expect.objectContaining({ id: "invocation-new", state: "running" }),
    ])
    ledger.close()
  })

  test("completes an expired legacy auxiliary invocation during startup recovery", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "legacy-invocation.sqlite")
    const initial = ExecutionLedger.open(filepath)
    initial.start({ id: "exec-old", projectID: "project", rootSessionID: "session", fence: 1, now: 100 })
    initial.claimOwner({ executionID: "exec-old", ownerID: "owner-a", leaseMs: 10, now: 100 })
    initial.bind({
      executionID: "exec-old",
      rootSessionID: "session",
      invocationID: "invocation-old",
      sessionID: "session",
      kind: "root",
      ownerID: "owner-a",
      fence: 1,
      now: 101,
    })
    initial.close()

    const legacy = new Database(filepath)
    legacy.run("DELETE FROM execution_invocation WHERE id = 'invocation-old'")
    legacy.close()

    const recovered = ExecutionLedger.open(filepath)
    expect(recovered.invocation("invocation-old")?.state).toBe("completed")
    recovered.start({ id: "exec-new", projectID: "project", rootSessionID: "session", fence: 1 })
    const ownership = recovered.claimOwner({ executionID: "exec-new", ownerID: "owner-b", leaseMs: 100 })
    expect(
      recovered.bind({
        executionID: "exec-new",
        rootSessionID: "session",
        invocationID: "invocation-new",
        sessionID: "session",
        kind: "root",
        ownerID: "owner-b",
        fence: ownership.fence,
      }),
    ).toMatchObject({ invocationID: "invocation-new" })
    recovered.close()
  })
})
