import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionLedger } from "@/core/execution/ledger"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { tmpdir } from "../fixture/fixture"

function initialize(ledger: ReturnType<typeof ExecutionLedger.open>, sliceLimit = 2) {
  ledger.start({ id: "exec-race", projectID: "project", rootSessionID: "session", fence: 1 })
  const contract = ExecutionContract.fallback("fixture")
  const state = {
    executionID: "exec-race",
    contract,
    policy: ExecutionPolicy.resolvePolicy(contract),
    evidence: { toolCalls: 13 },
    promotionReasons: [],
    classifierFallback: false,
    extensionCount: 0,
    sliceLimit,
    sliceStartCalls: 0,
  }
  ledger.savePolicyState(state)
  return state
}

describe("checkpoint durability", () => {
  test("normalizes checkpoint wrappers even when transport metadata is present", () => {
    const checkpoint = ExecutionCheckpoint.conservativeContinue("Ship the verified fix")

    expect(ExecutionCheckpoint.normalizeCandidate({ checkpoint, evidence: { source: "reasoning" } })).toEqual(
      checkpoint,
    )
    expect(ExecutionCheckpoint.normalizeCandidate({ execution_checkpoint: checkpoint, traceID: "trace-1" })).toEqual(
      checkpoint,
    )
    expect(ExecutionCheckpoint.normalizeCandidate(checkpoint)).toEqual(checkpoint)
  })

  test("creates a valid conservative continuation after malformed responses", () => {
    const checkpoint = ExecutionCheckpoint.conservativeContinue("Ship the verified fix")

    expect(ExecutionCheckpoint.Result.safeParse(checkpoint).success).toBe(true)
    expect(checkpoint).toMatchObject({
      decision: "continue",
      requestedCalls: ExecutionCheckpoint.MIN_CHECKPOINT_CALLS,
      remainingWork: ["Ship the verified fix"],
      blockers: [],
    })
  })

  test("normalizes sparse and string-valued checkpoint JSON on the first attempt", () => {
    const normalized = ExecutionCheckpoint.normalizeCandidate({
      execution_checkpoint: {
        decision: "continue",
        requestedCalls: "12",
        progressSummary: "Implementation is in progress.",
      },
    })

    expect(ExecutionCheckpoint.Result.safeParse(normalized)).toMatchObject({ success: true })
    expect(normalized).toMatchObject({
      decision: "continue",
      requestedCalls: 12,
      discoveries: [],
      completedWork: [],
      planChanged: false,
      routeChanged: false,
    })
  })

  test("evidence saves cannot erase reservations or overwrite ledger-owned grant counters", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(file)
    const stale = initialize(ledger)
    const other = ExecutionLedger.open(file)
    try {
      expect(ledger.reserveToolAllowance("exec-race")).toBe(true)
      expect(other.reserveToolAllowance("exec-race")).toBe(true)
      // Omitted counter used to reset to zero; explicit stale values were also accepted.
      ledger.savePolicyState(stale)
      other.savePolicyState({ ...stale, sliceUsedCalls: 1 })
      expect(ledger.sliceUsedCalls("exec-race")).toBe(2)
      expect(ledger.reserveToolAllowance("exec-race")).toBe(false)
      ledger.applyCheckpoint({
        executionID: "exec-race",
        checkpointID: "one",
        decision: "continue",
        requestedCalls: 20,
        payload: {},
      })
      other.savePolicyState(stale)
      expect(ledger.getPolicyState("exec-race")).toMatchObject({
        extensionCount: 1,
        sliceLimit: 20,
        sliceStartCalls: 13,
        sliceUsedCalls: 0,
      })
      expect(ledger.getPolicyState("exec-race")?.policy.budget.maxToolCalls).toBe(30)
    } finally {
      other.close()
      ledger.close()
    }
  })

  test("slice reservation is bounded across real concurrent processes", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(file)
    initialize(ledger)
    try {
      const start = String(Date.now() + 300)
      const results = await Promise.all(
        Array.from({ length: 5 }, async (_, index) => {
          const proc = Bun.spawn(
            [process.execPath, path.join(import.meta.dir, "ledger-worker.ts"), file, String(index), start, "slice"],
            { stdout: "pipe", stderr: "pipe" },
          )
          const output = await new Response(proc.stdout).text()
          const error = await new Response(proc.stderr).text()
          expect(await proc.exited, error).toBe(0)
          return JSON.parse(output)
        }),
      )
      expect(results.filter(Boolean)).toHaveLength(2)
      expect(ledger.sliceUsedCalls("exec-race")).toBe(2)
    } finally {
      ledger.close()
    }
  })

  test("grants, budget, consumed event and retry state recover together after reopen", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ledger.sqlite")
    const ledger = ExecutionLedger.open(file)
    initialize(ledger)
    expect(ledger.recordCheckpointFailure("exec-race")).toBe(1)
    ledger.close()
    const reopened = ExecutionLedger.open(file)
    expect(reopened.checkpointFailures("exec-race")).toBe(1)
    const input = {
      executionID: "exec-race",
      checkpointID: "grant",
      decision: "continue" as const,
      requestedCalls: 20,
      payload: { triggerMessageID: "rejected-final" },
    }
    reopened.applyCheckpoint(input)
    reopened.close()
    const recovered = ExecutionLedger.open(file)
    try {
      expect(recovered.getPolicyState("exec-race")).toMatchObject({
        extensionCount: 1,
        sliceStartCalls: 13,
        policy: { budget: { maxToolCalls: 30, maxSteps: 13 } },
      })
      expect(recovered.checkpointFailures("exec-race")).toBe(0)
      expect(recovered.checkpoints("exec-race")[0].payload.triggerMessageID).toBe("rejected-final")
      expect(recovered.applyCheckpoint(input).idempotent).toBe(true)
      expect(recovered.getPolicyState("exec-race")?.policy.budget.maxToolCalls).toBe(30)
    } finally {
      recovered.close()
    }
  })
})
