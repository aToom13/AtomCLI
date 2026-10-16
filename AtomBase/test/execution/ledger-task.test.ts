import "../preload"
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "path"
import { ExecutionLedger } from "@/core/execution/ledger"
import { tmpdir } from "../fixture/fixture"

function setup(ledger: ReturnType<typeof ExecutionLedger.open>) {
  const now = Date.now()
  ledger.start({ id: "exec-task", projectID: "project", rootSessionID: "session", fence: 1, now })
  const owner = ledger.claimOwner({ executionID: "exec-task", ownerID: "owner", leaseMs: 60_000, now })
  const fence = owner.fence!
  ledger.bind({
    executionID: "exec-task",
    rootSessionID: "session",
    invocationID: "invocation",
    sessionID: "session",
    kind: "root",
    ownerID: "owner",
    fence,
    now,
  })
}

function submit(ledger: ReturnType<typeof ExecutionLedger.open>, taskID: string) {
  const task = ledger.task("exec-task", taskID)!
  const running = ledger.transitionTask({
    executionID: "exec-task",
    taskID,
    ownerID: "owner",
    fence: 1,
    expectedVersion: task.version,
    status: "running",
  })
  expect(running.transitioned).toBe(true)
  const submitted = ledger.transitionTask({
    executionID: "exec-task",
    taskID,
    ownerID: "owner",
    fence: 1,
    expectedVersion: running.task!.version,
    status: "submitted",
    evidence: "Child output",
  })
  expect(submitted.transitioned).toBe(true)
  return submitted.task!
}

describe("ExecutionLedger tasks", () => {
  test("keeps agent completion as submitted until checks pass", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    setup(ledger)

    const registered = ledger.registerTask({
      id: "build",
      executionID: "exec-task",
      goal: "Build feature",
      owner: "session",
      agent: "coder",
      acceptance: [{ id: "tests", description: "Tests pass", verification: "automatic", command: "bun test" }],
      ownerID: "owner",
      fence: 1,
    })
    expect(registered).toMatchObject({ registered: true, task: { status: "pending", version: 1 } })
    const running = ledger.transitionTask({
      executionID: "exec-task",
      taskID: "build",
      ownerID: "owner",
      fence: 1,
      expectedVersion: 1,
      status: "running",
    })
    const submitted = ledger.transitionTask({
      executionID: "exec-task",
      taskID: "build",
      ownerID: "owner",
      fence: 1,
      expectedVersion: running.task!.version,
      status: "submitted",
      evidence: "Agent result",
    })
    expect(submitted.task?.status).toBe("submitted")
    expect(
      ledger.transitionTask({
        executionID: "exec-task",
        taskID: "build",
        ownerID: "owner",
        fence: 1,
        expectedVersion: submitted.task!.version,
        status: "accepted",
        evidence: "Claim only",
      }),
    ).toMatchObject({ transitioned: false, reason: "invalid_transition" })

    const verifying = ledger.transitionTask({
      executionID: "exec-task",
      taskID: "build",
      ownerID: "owner",
      fence: 1,
      expectedVersion: submitted.task!.version,
      status: "verifying",
    })
    const accepted = ledger.recordAutomaticTaskChecks({
      executionID: "exec-task",
      taskID: "build",
      ownerID: "owner",
      fence: 1,
      expectedVersion: verifying.task!.version,
      checks: [{ criterionID: "tests", command: "bun test", exitCode: 0, evidence: "bun test passed" }],
    })
    expect(accepted).toMatchObject({ recorded: true, task: { status: "accepted" } })
    ledger.close()
  })

  test("invalidates accepted dependency subtree on revision evidence", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    setup(ledger)
    for (const [id, dependsOn] of [
      ["foundation", []],
      ["ui", ["foundation"]],
    ] as const) {
      ledger.registerTask({
        id,
        executionID: "exec-task",
        goal: id,
        owner: "session",
        agent: "coder",
        dependsOn: [...dependsOn],
        ownerID: "owner",
        fence: 1,
      })
    }
    for (const id of ["foundation", "ui"]) {
      const running = ledger.transitionTask({
        executionID: "exec-task",
        taskID: id,
        ownerID: "owner",
        fence: 1,
        expectedVersion: 1,
        status: "running",
      })
      const submitted = ledger.transitionTask({
        executionID: "exec-task",
        taskID: id,
        ownerID: "owner",
        fence: 1,
        expectedVersion: running.task!.version,
        status: "submitted",
        evidence: "done",
      })
      ledger.transitionTask({
        executionID: "exec-task",
        taskID: id,
        ownerID: "owner",
        fence: 1,
        expectedVersion: submitted.task!.version,
        status: "verifying",
      })
      const verifying = ledger.task("exec-task", id)!
      ledger.recordTaskChecks({
        executionID: "exec-task",
        taskID: id,
        ownerID: "owner",
        fence: 1,
        expectedVersion: verifying.version,
        checks: [],
      })
    }
    expect(
      ledger.invalidateDependents({
        executionID: "exec-task",
        taskID: "foundation",
        ownerID: "owner",
        fence: 1,
        evidence: "User changed foundation",
      }),
    ).toBe(2)
    expect(ledger.task("exec-task", "foundation")?.status).toBe("needs_revision")
    expect(ledger.task("exec-task", "ui")?.status).toBe("needs_revision")
    expect(ledger.task("exec-task", "foundation")).toMatchObject({
      revision: 2,
      supersedes: "foundation@1",
      checks: [],
    })
    expect(ledger.taskHistory("exec-task", "foundation")).toContainEqual(
      expect.objectContaining({ revision: 1, status: "accepted" }),
    )
    ledger.close()
  })

  test("rejects automatic claims at the ledger boundary and derives failure from command exit", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    setup(ledger)
    ledger.registerTask({
      id: "auto",
      executionID: "exec-task",
      goal: "Check",
      owner: "session",
      agent: "coder",
      ownerID: "owner",
      fence: 1,
      acceptance: [{ id: "test", description: "Test passes", verification: "automatic", command: "exit 7" }],
    })
    const submitted = submit(ledger, "auto")
    const input = {
      executionID: "exec-task",
      taskID: "auto",
      ownerID: "owner",
      fence: 1,
      expectedVersion: submitted.version,
    }
    expect(() =>
      ledger.recordTaskChecks({
        ...input,
        checks: [{ criterionID: "test", verifier: "automatic", passed: true, evidence: "Parent says passed" }] as any,
      }),
    ).toThrow()
    expect(
      ledger.recordTaskChecks({
        ...input,
        checks: [{ criterionID: "test", verifier: "parent", passed: true, evidence: "Parent says passed" }],
      }),
    ).toMatchObject({ recorded: false, reason: "wrong_verifier" })
    expect(
      ledger.recordAutomaticTaskChecks({
        ...input,
        checks: [{ criterionID: "test", command: "exit 0", exitCode: 0, evidence: "Wrong check" }],
      }),
    ).toMatchObject({ recorded: false, reason: "wrong_command" })
    const failed = ledger.recordAutomaticTaskChecks({
      ...input,
      now: 123,
      checks: [
        { criterionID: "test", command: "exit 7", exitCode: 7, evidence: "Command failed", passed: true } as any,
      ],
    })
    expect(failed).toMatchObject({
      recorded: true,
      task: {
        status: "needs_revision",
        checks: [
          {
            passed: false,
            verifier: "automatic",
            verifierID: "harness",
            taskRevision: 1,
            verifiedAt: 123,
          },
        ],
      },
    })
    ledger.close()
  })

  test("stores verifier provenance and rejects evidence from an old revision", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    setup(ledger)
    ledger.registerTask({
      id: "review",
      executionID: "exec-task",
      goal: "Review",
      owner: "session",
      agent: "coder",
      ownerID: "owner",
      fence: 1,
      acceptance: [
        { id: "parent", description: "Parent approves", verification: "parent" },
        { id: "reviewer", description: "Reviewer approves", verification: "reviewer" },
      ],
    })
    const submitted = submit(ledger, "review")
    const checks: ExecutionLedger.TaskCheckInput[] = [
      { criterionID: "parent", verifier: "parent", passed: true, evidence: "Parent evidence" },
      { criterionID: "reviewer", verifier: "reviewer", passed: true, evidence: "Review evidence" },
    ]
    const accepted = ledger.recordTaskChecks({
      executionID: "exec-task",
      taskID: "review",
      ownerID: "owner",
      fence: 1,
      expectedVersion: submitted.version,
      actorID: "session-verifier",
      checks,
      now: 124,
    })
    expect(accepted.task?.checks).toEqual(
      checks.map((check) => ({
        ...check,
        verifierID: "session-verifier",
        taskRevision: 1,
        verifiedAt: 124,
      })),
    )
    ledger.invalidateDependents({
      executionID: "exec-task",
      taskID: "review",
      ownerID: "owner",
      fence: 1,
      evidence: "Changed requirement",
    })
    expect(ledger.task("exec-task", "review")).toMatchObject({ revision: 2, supersedes: "review@1", checks: [] })
    const resubmitted = submit(ledger, "review")
    ledger.transitionTask({
      executionID: "exec-task",
      taskID: "review",
      ownerID: "owner",
      fence: 1,
      expectedVersion: resubmitted.version,
      status: "verifying",
    })
    // Simulate legacy persisted checks; old evidence must never approve a new revision.
    using db = new Database(filepath)
    db.query("UPDATE execution_task SET checks = ? WHERE id = ?").run(JSON.stringify(accepted.task!.checks), "review")
    const current = ledger.task("exec-task", "review")!
    expect(
      ledger.transitionTask({
        executionID: "exec-task",
        taskID: "review",
        ownerID: "owner",
        fence: 1,
        expectedVersion: current.version,
        status: "accepted",
        evidence: "Reusing old review",
      }),
    ).toMatchObject({ transitioned: false, reason: "acceptance_unverified" })
    ledger.close()
  })

  test("rejects a running downstream child after revision and preserves independent accepted work", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    setup(ledger)
    for (const [id, dependsOn] of [
      ["base", []],
      ["child", ["base"]],
      ["independent", []],
    ] as const) {
      ledger.registerTask({
        id,
        executionID: "exec-task",
        goal: id,
        owner: "session",
        agent: "coder",
        ownerID: "owner",
        fence: 1,
        dependsOn: [...dependsOn],
      })
    }
    for (const id of ["base", "independent"]) {
      const submitted = submit(ledger, id)
      ledger.recordTaskChecks({
        executionID: "exec-task",
        taskID: id,
        ownerID: "owner",
        fence: 1,
        expectedVersion: submitted.version,
        checks: [],
      })
    }
    const independent = ledger.task("exec-task", "independent")
    const running = ledger.transitionTask({
      executionID: "exec-task",
      taskID: "child",
      ownerID: "owner",
      fence: 1,
      expectedVersion: 1,
      status: "running",
    }).task!
    expect(
      ledger.invalidateDependents({
        executionID: "exec-task",
        taskID: "base",
        ownerID: "owner",
        fence: 1,
        evidence: "User change",
      }),
    ).toBe(2)
    expect(
      ledger.transitionTask({
        executionID: "exec-task",
        taskID: "child",
        ownerID: "owner",
        fence: 1,
        expectedVersion: running.version,
        status: "submitted",
        evidence: "Stale child output",
      }),
    ).toMatchObject({ transitioned: false, reason: "stale_version" })
    expect(ledger.task("exec-task", "child")).toMatchObject({ status: "needs_revision", revision: 2 })
    expect(ledger.task("exec-task", "independent")).toEqual(independent)
    ledger.close()
  })

  test("rejects missing, self and cyclic dependencies without relying on orchestrate", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(filepath)
    setup(ledger)
    const input = {
      id: "new",
      executionID: "exec-task",
      goal: "New task",
      owner: "session",
      agent: "coder",
      ownerID: "owner",
      fence: 1,
    }
    expect(ledger.registerTask({ ...input, dependsOn: ["missing"] })).toMatchObject({
      registered: false,
      reason: "unknown_dependency",
    })
    expect(ledger.registerTask({ ...input, dependsOn: ["new"] })).toMatchObject({
      registered: false,
      reason: "self_dependency",
    })
    ledger.registerTask({ ...input, id: "existing" })
    // Legacy graph contains a forward reference; registration would close its cycle.
    using db = new Database(filepath)
    db.query("UPDATE execution_task SET depends_on = ? WHERE id = ?").run('["new"]', "existing")
    expect(ledger.registerTask({ ...input, dependsOn: ["existing"] })).toMatchObject({
      registered: false,
      reason: "dependency_cycle",
    })
    expect(ledger.task("exec-task", "new")).toBeUndefined()
    ledger.close()
  })

  test("reopens open tasks without nesting ledger transactions", async () => {
    await using tmp = await tmpdir()
    const ledger = ExecutionLedger.open(path.join(tmp.path, "ledger.sqlite"))
    setup(ledger)
    ledger.registerTask({
      id: "open",
      executionID: "exec-task",
      goal: "open task",
      owner: "session",
      agent: "coder",
      ownerID: "owner",
      fence: 1,
    })
    ledger.transitionTask({
      executionID: "exec-task",
      taskID: "open",
      ownerID: "owner",
      fence: 1,
      expectedVersion: 1,
      status: "running",
    })
    const count = ledger.invalidateOpenTasks({
      executionID: "exec-task",
      ownerID: "owner",
      fence: 1,
      evidence: "User amendment",
    })
    expect(count).toBe(1)
    expect(ledger.task("exec-task", "open")?.status).toBe("needs_revision")
    ledger.close()
  })
})
