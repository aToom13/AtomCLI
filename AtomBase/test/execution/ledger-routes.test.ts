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
  test("manual model and thinking pins reject automatic routes but permit explicit approval", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    ledger.start({ id: "pinned", projectID: "project", rootSessionID: "session", fence: 1, now: 100 })
    ledger.claimOwner({ executionID: "pinned", ownerID: "owner", leaseMs: 1_000, now: 100 })
    ledger.bind({
      executionID: "pinned",
      rootSessionID: "session",
      invocationID: "invocation",
      sessionID: "session",
      ownerID: "owner",
      fence: 1,
      now: 101,
    })
    const proposal = {
      executionID: "pinned",
      invocationID: "invocation",
      ownerID: "owner",
      fence: 1,
      stepID: "step",
      expectedRouteRevision: 1,
      sessionGeneration: 1,
      fromRoute: { providerID: "provider", modelID: "base" },
      toRoute: { providerID: "provider", modelID: "target" },
      paramsDigest: "params",
      scope: "model" as const,
      reasonCode: "test",
      evidenceRefs: [],
      expiresAt: 1_000,
      policyVersion: 1,
      credentialRevision: "credential",
      now: 102,
    }
    expect(ledger.proposeRoute({ ...proposal, id: "auto-pinned", autoAccept: true, manualModelPin: true })).toEqual({
      proposed: false,
      reason: "manual_pin",
    })
    expect(ledger.proposeRoute({ ...proposal, id: "ask-pinned", manualModelPin: true })).toMatchObject({
      proposed: true,
      proposal: { state: "pending" },
    })
    expect(ledger.proposeRoute({ ...proposal, id: "auto-after-pin", autoAccept: true })).toEqual({
      proposed: false,
      reason: "manual_pin",
    })
    expect(
      ledger.proposeRoute({
        ...proposal,
        id: "auto-thinking-pinned",
        scope: "thinking",
        autoAccept: true,
        manualThinkingPin: true,
      }),
    ).toEqual({ proposed: false, reason: "manual_pin" })
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
      reason: { code: "recovery_required", retryable: false },
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
