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
  test("a checkpoint slice permits one tool per turn without premature step exhaustion", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    try {
      ledger.start({ id: "single-tool-turns", projectID: "project", rootSessionID: "session", fence: 1 })
      ledger.savePolicyState({
        executionID: "single-tool-turns",
        contract: {},
        policy: { budget: { maxToolCalls: 1, maxSteps: 1 } } as never,
        evidence: {},
        promotionReasons: [],
        classifierFallback: false,
        extensionCount: 0,
        sliceLimit: 1,
        sliceStartCalls: 0,
      })
      expect(
        ledger.claimStep({ stepID: "initial", executionID: "single-tool-turns", fence: 1, maxSteps: 1 }),
      ).toMatchObject({ admitted: true })
      ledger.applyCheckpoint({
        executionID: "single-tool-turns",
        checkpointID: "continue",
        decision: "continue",
        requestedCalls: 10,
        payload: {},
      })
      const maxSteps = ledger.getPolicyState("single-tool-turns")!.policy.budget.maxSteps
      for (let i = 0; i < 10; i++) {
        expect(
          ledger.claimStep({ stepID: `turn-${i}`, executionID: "single-tool-turns", fence: 1, maxSteps }),
        ).toMatchObject({ admitted: true })
        expect(ledger.reserveToolAllowance("single-tool-turns")).toBe(true)
      }
      expect(ledger.reserveToolAllowance("single-tool-turns")).toBe(false)
      expect(ledger.claimStep({ stepID: "excess", executionID: "single-tool-turns", fence: 1, maxSteps })).toEqual({
        admitted: false,
        reason: "step_limit",
      })
    } finally {
      ledger.close()
    }
  })

  test("checkpoint grants do not override explicit call and step ceilings", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({
      id: "hard-ceiling",
      projectID: "project",
      rootSessionID: "session",
      fence: 1,
      policy: { maxCalls: 1, maxSteps: 1 },
    })
    ledger.savePolicyState({
      executionID: "hard-ceiling",
      contract: {},
      policy: {},
      evidence: {},
      promotionReasons: [],
      classifierFallback: false,
      extensionCount: 0,
      sliceLimit: 1,
      sliceStartCalls: 0,
    })
    expect(
      ledger.applyCheckpoint({
        executionID: "hard-ceiling",
        checkpointID: "extend",
        decision: "continue",
        requestedCalls: 50,
        payload: {},
      }),
    ).toMatchObject({ grantedCalls: 50 })
    expect(ledger.view("hard-ceiling")?.budget.execution).toMatchObject({
      calls: { limit: 1 },
      steps: { limit: 1 },
    })
    expect(
      ledger.reserve({
        attemptID: "first",
        executionID: "hard-ceiling",
        runID: "run",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
      }),
    ).toMatchObject({ admitted: true })
    expect(
      ledger.reserve({
        attemptID: "second",
        executionID: "hard-ceiling",
        runID: "run",
        fence: 1,
        purpose: "main",
        estimateMicrousd: 0,
      }),
    ).toEqual({ admitted: false, reason: "call_limit" })
    expect(ledger.claimStep({ stepID: "first-step", executionID: "hard-ceiling", fence: 1 })).toMatchObject({
      admitted: true,
    })
    expect(ledger.claimStep({ stepID: "second-step", executionID: "hard-ceiling", fence: 1 })).toEqual({
      admitted: false,
      reason: "step_limit",
    })
    ledger.close()
  })

  test("keeps scope escalation limits and cooldown after reopening ledger", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    const now = Date.now()
    ledger.start({ id: "scope-first", projectID: "project", rootSessionID: "session", fence: 1 })
    ledger.savePolicyState({
      executionID: "scope-first",
      contract: {},
      policy: {},
      evidence: {},
      promotionReasons: [],
      classifierFallback: false,
      extensionCount: 0,
      sliceLimit: 2,
      sliceStartCalls: 0,
    })
    const escalation = {
      scope: "coordinated" as const,
      contract: { scope: "coordinated" },
      policy: {},
      promotionReasons: [],
      reason: "test",
      actorID: "test",
      grantedCalls: 0,
      grantedSteps: 0,
      maxPerSession: 3,
      cooldownMs: 100,
    }
    expect(ledger.applyScopeEscalation({ ...escalation, executionID: "scope-first", now })).toMatchObject({
      allowed: true,
    })
    ledger.close()

    const reopened = ExecutionLedger.open(filepath)
    expect(reopened.scopeFloor("session")).toBe("coordinated")
    expect(reopened.scopeEscalationStatus("session")).toMatchObject({ count: 1, last_at: now })
    reopened.start({ id: "scope-second", projectID: "project", rootSessionID: "session", fence: 1 })
    reopened.savePolicyState({
      executionID: "scope-second",
      contract: {},
      policy: {},
      evidence: {},
      promotionReasons: [],
      classifierFallback: false,
      extensionCount: 0,
      sliceLimit: 2,
      sliceStartCalls: 0,
    })
    expect(reopened.applyScopeEscalation({ ...escalation, executionID: "scope-second", now: now + 50 })).toEqual({
      allowed: false,
      reason: "scope_escalation_cooldown",
    })
    expect(reopened.applyScopeEscalation({ ...escalation, executionID: "scope-second", now: now + 100 })).toMatchObject(
      {
        allowed: true,
      },
    )
    expect(reopened.applyScopeEscalation({ ...escalation, executionID: "scope-second", now: now + 200 })).toMatchObject(
      {
        allowed: true,
      },
    )
    expect(
      reopened
        .events({ sessionID: "session", afterSequence: 0, limit: 100 })
        .items.filter((event) => event.type === "execution.scope.escalated"),
    ).toHaveLength(3)
    expect(reopened.applyScopeEscalation({ ...escalation, executionID: "scope-second", now: now + 300 })).toEqual({
      allowed: false,
      reason: "scope_escalation_limit",
    })
    reopened.close()
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
})
