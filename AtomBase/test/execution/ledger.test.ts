import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import { Database } from "bun:sqlite"
import { ExecutionLedger } from "@/core/execution/ledger"
import { tmpdir } from "../fixture/fixture"

test("shutdown cancels an expired owner's idle execution but fences replacement owners", async () => {
  await using tmp = await tmpdir()
  const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
  try {
    for (const id of ["idle-shutdown", "replacement-shutdown"]) {
      ledger.start({ id, projectID: "fake-project", rootSessionID: id, fence: 1, now: 1 })
      expect(ledger.claimOwner({ executionID: id, ownerID: "fake-original", leaseMs: 1, now: 1 }).acquired).toBe(true)
    }
    const own = { executionID: "idle-shutdown", ownerID: "fake-original", fence: 1, now: 3 }
    expect(ledger.cancel(own)).toMatchObject({ cancelled: false, reason: "stale_fence" })
    expect(ledger.cancel({ ...own, ownerID: "fake-stranger", allowExpiredOwner: true }).cancelled).toBe(false)
    expect(ledger.cancel({ ...own, allowExpiredOwner: true }).cancelled).toBe(true)
    expect(ledger.view(own.executionID)?.outcome).toBe("cancelled")
    expect(
      ledger.claimOwner({ executionID: "replacement-shutdown", ownerID: "fake-replacement", leaseMs: 1, now: 3 })
        .acquired,
    ).toBe(true)
    expect(ledger.cancel({ ...own, executionID: "replacement-shutdown", allowExpiredOwner: true }).cancelled).toBe(
      false,
    )
    expect(ledger.view("replacement-shutdown")?.lifecycle).toBe("active")
  } finally {
    ledger.close()
  }
})

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
})
