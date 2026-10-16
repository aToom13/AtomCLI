import "../preload"
import { expect, test } from "bun:test"
import path from "path"
import { ExecutionLedger } from "@/core/execution/ledger"
import { AtomicPlan } from "@/core/execution/atomic-plan"
import { tmpdir } from "../fixture/fixture"

const authority = { executionID: "atomic", ownerID: "owner", fence: 1 }
const acceptance = [{ id: "done", description: "Feature works", verification: "parent" as const }]
function definition(id: string, dependsOn: string[] = []): AtomicPlan.Definition {
  return {
    id,
    goal: id,
    agent: "coder",
    dependsOn,
    acceptance,
    execution: ExecutionLedger.TaskExecution.parse({ owns: [id] }),
  }
}
function setup(store: ReturnType<typeof ExecutionLedger.open>) {
  store.start({ id: authority.executionID, projectID: "project", rootSessionID: "parent", fence: 1 })
  store.claimOwner({ ...authority, leaseMs: 60_000 })
  store.bind({ ...authority, rootSessionID: "parent", sessionID: "parent", invocationID: "initial", kind: "root" })
  return store.startAtomicWork({
    ...authority,
    messageID: "initial",
    goal: "Build feature",
    agent: "build",
    sessionID: "parent",
  })
}
function plan(store: ReturnType<typeof ExecutionLedger.open>) {
  const root = setup(store)
  store.updateAtomicPlan({
    ...authority,
    rootID: root.id,
    expectedVersion: root.version,
    definitions: [
      definition("merge", ["left", "right"]),
      definition("left", ["foundation"]),
      definition("foundation"),
      definition("right", ["foundation"]),
      definition(root.id),
    ],
  })
  return root.id
}
function submit(store: ReturnType<typeof ExecutionLedger.open>, taskID: string) {
  const current = store.task(authority.executionID, taskID)!
  const running = store.transitionTask({ ...authority, taskID, expectedVersion: current.version, status: "running" })
  expect(running.transitioned).toBe(true)
  const submitted = store.transitionTask({
    ...authority,
    taskID,
    expectedVersion: running.task!.version,
    status: "submitted",
    evidence: "Worker inspected implementation",
  })
  expect(submitted.transitioned).toBe(true)
  return submitted.task!
}
function accept(store: ReturnType<typeof ExecutionLedger.open>, taskID: string) {
  const submitted = submit(store, taskID)
  const accepted = store.recordTaskChecks({
    ...authority,
    taskID,
    expectedVersion: submitted.version,
    actorID: "parent",
    checks: [{ criterionID: "done", verifier: "parent", passed: true, evidence: "Inspected fixture behavior" }],
  })
  expect(accepted.task?.status).toBe("accepted")
}

test.each(["cycle", "missing", "overlap", "empty", "duplicate"])(
  "invalid %s plan rolls back every task",
  async (kind) => {
    await using tmp = await tmpdir()
    const store = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    try {
      const root = setup(store)
      const tasks = [definition("a"), definition("b"), definition(root.id)]
      if (kind === "cycle") {
        tasks[0].dependsOn = ["b"]
        tasks[1].dependsOn = ["a"]
      }
      if (kind === "missing") tasks[0].dependsOn = ["missing"]
      if (kind === "overlap") tasks[1].execution.owns = ["a/child"]
      if (kind === "empty") tasks[1].acceptance = []
      if (kind === "duplicate") tasks[1].id = "a"
      expect(() =>
        store.updateAtomicPlan({ ...authority, rootID: root.id, expectedVersion: root.version, definitions: tasks }),
      ).toThrow()
      expect(store.tasks(authority.executionID)).toHaveLength(1)
      expect(store.task(authority.executionID, root.id)?.atomic?.planned).toBe(false)
    } finally {
      store.close()
    }
  },
)

test("foundation, submitted state, partial verification, and integration completion gate", async () => {
  await using tmp = await tmpdir()
  const store = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
  try {
    const rootID = plan(store)
    expect(store.task(authority.executionID, rootID)?.dependsOn.sort()).toEqual([
      "foundation",
      "left",
      "merge",
      "right",
    ])
    expect(store.transitionTask({ ...authority, taskID: "left", expectedVersion: 1, status: "running" })).toMatchObject(
      { reason: "dependency_unaccepted" },
    )
    const submitted = submit(store, "foundation")
    expect(
      store.recordTaskChecks({
        ...authority,
        taskID: submitted.id,
        expectedVersion: submitted.version,
        actorID: "parent",
        checks: [],
      }).task?.status,
    ).toBe("verifying")
    expect(store.hasUnresolvedTasks(authority.executionID)).toBe(true)
    const verifying = store.task(authority.executionID, "foundation")!
    expect(
      store.recordTaskChecks({
        ...authority,
        taskID: verifying.id,
        expectedVersion: verifying.version,
        actorID: "other",
        checks: [{ criterionID: "done", verifier: "parent", passed: true, evidence: "Claim" }],
      }),
    ).toMatchObject({ reason: "parent_identity_required" })
    expect(
      store.recordTaskChecks({
        ...authority,
        taskID: verifying.id,
        expectedVersion: verifying.version,
        actorID: "parent",
        checks: [{ criterionID: "done", verifier: "parent", passed: true, evidence: "Verified fixture" }],
      }).task?.status,
    ).toBe("accepted")
    for (const id of ["left", "right", "merge"]) accept(store, id)
    expect(store.hasUnresolvedTasks(authority.executionID)).toBe(true)
    const completion = {
      ...authority,
      sessionID: "parent",
      messageID: "completion",
      finish: "stop",
      payload: "[]",
      reviewFiles: "[]",
      digest: "complete",
      requiresReview: false,
      revision: 0,
    }
    expect(store.stageCompletion(completion)).toMatchObject({ staged: false, reason: "active_task" })
    store.queueAtomicMessage({ ...authority, messageID: "status", text: "Status?" })
    expect(store.stageCompletion(completion)).toMatchObject({ staged: false, reason: "active_task" })
    const root = store.task(authority.executionID, rootID)!
    store.updateAtomicPlan({
      ...authority,
      rootID,
      expectedVersion: root.version,
      message: { id: "status", classification: "status", evidence: "Implementation accepted, integration pending" },
    })
    accept(store, rootID)
    expect(store.hasUnresolvedTasks(authority.executionID)).toBe(false)
    expect(store.stageCompletion(completion)).toMatchObject({ staged: true })
  } finally {
    store.close()
  }
})

test("amendment invalidates shared downstream once, preserves independent accepted work and rejects stale output", async () => {
  await using tmp = await tmpdir()
  const store = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
  try {
    const rootID = plan(store)
    for (const id of ["foundation", "left", "right", "merge"]) accept(store, id)
    const before = store.task(authority.executionID, "merge")!
    store.queueAtomicMessage({ ...authority, messageID: "amend", text: "Add avatar upload" })
    expect(store.atomicPending(authority.executionID)).toBe(true)
    const root = store.task(authority.executionID, rootID)!
    const changes = ["left", "right"].map((id) => ({
      ...definition(id, ["foundation"]),
      goal: id + " with avatar",
      expectedVersion: store.task(authority.executionID, id)!.version,
    }))
    store.updateAtomicPlan({
      ...authority,
      rootID,
      expectedVersion: root.version,
      definitions: changes,
      message: { id: "amend", classification: "amendment", evidence: "Avatar affects both branches" },
    })
    expect(store.task(authority.executionID, "foundation")?.status).toBe("accepted")
    expect(store.task(authority.executionID, "merge")).toMatchObject({
      status: "needs_revision",
      revision: before.revision + 1,
    })
    expect(store.taskHistory(authority.executionID, "merge").at(-1)).toMatchObject({
      status: "accepted",
      checks: [{ passed: true }],
    })
    expect(() => store.assertAtomicReady({ ...authority, taskID: "merge", expectedVersion: before.version })).toThrow(
      "stale_version",
    )
    expect(store.atomicPending(authority.executionID)).toBe(false)
    const snapshot = store.task(authority.executionID, "merge")!
    expect(() =>
      store.updateAtomicPlan({
        ...authority,
        rootID,
        expectedVersion: store.task(authority.executionID, rootID)!.version,
        definitions: [{ ...definition("merge", ["left", "right"]), expectedVersion: before.version }],
      }),
    ).toThrow("stale_version")
    expect(store.task(authority.executionID, "merge")).toEqual(snapshot)
  } finally {
    store.close()
  }
})

test("pending messages fence dispatch, checks, and completion; status classification preserves accepted work", async () => {
  await using tmp = await tmpdir()
  const store = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
  try {
    const rootID = plan(store)
    accept(store, "foundation")
    const child = submit(store, "left")
    store.queueAtomicMessage({ ...authority, messageID: "status", text: "Progress?" })
    expect(() => store.assertAtomicReady({ ...authority, taskID: child.id, expectedVersion: child.version })).toThrow(
      "ATOMIC_PAUSED",
    )
    expect(
      store.recordTaskChecks({
        ...authority,
        taskID: child.id,
        expectedVersion: child.version,
        actorID: "parent",
        checks: [],
      }),
    ).toMatchObject({ reason: "pending_amendment" })
    expect(store.hasUnresolvedTasks(authority.executionID)).toBe(true)
    store.updateAtomicPlan({
      ...authority,
      rootID,
      expectedVersion: store.task(authority.executionID, rootID)!.version,
      message: { id: "status", classification: "status", evidence: "Progress request, no scope change" },
    })
    expect(store.task(authority.executionID, "foundation")?.status).toBe("accepted")
    expect(store.task(authority.executionID, "left")?.revision).toBe(child.revision)
  } finally {
    store.close()
  }
})

test("automatic and reviewer checks cannot be forged by parent", async () => {
  await using tmp = await tmpdir()
  const store = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
  try {
    const root = setup(store)
    const build = definition("build")
    build.acceptance = [
      { id: "test", description: "Checks pass", verification: "automatic", command: "true" },
      { id: "review", description: "Inspected code", verification: "reviewer" },
    ]
    store.updateAtomicPlan({
      ...authority,
      rootID: root.id,
      expectedVersion: root.version,
      definitions: [build, definition(root.id)],
    })
    const current = submit(store, "build")
    expect(
      store.recordTaskChecks({
        ...authority,
        taskID: "build",
        expectedVersion: current.version,
        actorID: "parent",
        checks: [{ criterionID: "test", verifier: "parent", passed: true, evidence: "Claim" }],
      }),
    ).toMatchObject({ reason: "wrong_verifier" })
    expect(
      store.recordTaskVerification({
        ...authority,
        taskID: "build",
        expectedVersion: current.version,
        actorID: "parent",
        automaticChecks: [],
        checks: [{ criterionID: "review", verifier: "reviewer", passed: true, evidence: "PASS" }],
      }),
    ).toMatchObject({ reason: "reviewer_identity_required" })
    store.bind({
      ...authority,
      rootSessionID: "parent",
      sessionID: "reviewer-session",
      invocationID: "reviewer-invocation",
      kind: "reviewer",
    })
    const verified = store.recordTaskVerification({
      ...authority,
      taskID: "build",
      expectedVersion: current.version,
      actorID: "parent",
      reviewerID: "reviewer-session",
      automaticChecks: [{ criterionID: "test", command: "true", exitCode: 0, evidence: "Ran command" }],
      checks: [{ criterionID: "review", verifier: "reviewer", passed: true, evidence: "Verified exact criterion" }],
    })
    expect(verified.task).toMatchObject({
      status: "accepted",
      checks: [{ verifierID: "reviewer-session" }, { verifierID: "harness" }],
    })
  } finally {
    store.close()
  }
})

test("restart and terminal resume retain plan, amendments, history, recovery state and budget lineage", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "ledger.sqlite")
  let store = ExecutionLedger.open(file)
  try {
    const rootID = plan(store)
    accept(store, "foundation")
    const left = store.task(authority.executionID, "left")!
    store.transitionTask({ ...authority, taskID: "left", expectedVersion: left.version, status: "running" })
    store.beginAtomicAttempt({
      ...authority,
      taskID: "left",
      expectedVersion: store.task(authority.executionID, "left")!.version,
    })
    store.queueAtomicMessage({ ...authority, messageID: "pending", text: "Avatar" })
    const root = store.task(authority.executionID, rootID)!
    store.close()
    store = ExecutionLedger.open(file)
    expect(store.task(authority.executionID, rootID)).toEqual(root)
    store.cancel(authority)
    store.start({
      id: "resumed",
      projectID: "project",
      rootSessionID: "parent",
      fence: 1,
      resumesExecutionID: authority.executionID,
    })
    expect(store.task("resumed", "foundation")?.status).toBe("accepted")
    expect(store.task("resumed", "left")).toMatchObject({ status: "blocked", execution: { attempts: 1 } })
    expect(store.task("resumed", rootID)?.atomic).toEqual(root.atomic)
    expect(store.taskHistory("resumed", "foundation")).toEqual(store.taskHistory(authority.executionID, "foundation"))
    expect(store.view("resumed")?.budgetScopeID).toBe(store.view(authority.executionID)?.budgetScopeID)
    expect(store.task(authority.executionID, "left")?.status).toBe("running")
  } finally {
    store.close()
  }
})
