import "../preload"
import { expect, test } from "bun:test"
import { createCheckpointRuntimeModule } from "@/core/execution/runtime/checkpoint-runtime"
import { createEvidenceRuntime } from "@/core/execution/runtime/evidence"
import type { ExecutionLedger } from "@/core/execution/ledger"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"

test("completion words never turn a continue checkpoint into finish", () => {
  const contract = ExecutionContract.fallback("test")
  const state = {
    contract,
    policy: ExecutionPolicy.resolvePolicy(contract, {}),
    evidence: { mutatingCalls: 1 },
    promotionReasons: [],
    classifierFallback: false,
  } as ExecutionRuntime.ExecutionState
  const ledger = {
    checkpoints: () => [],
    view: () => ({ rootSessionID: "root", routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    hasUnresolvedExecutionTaskflow: () => false,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => state,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  for (const remainingWork of [[], ["Complete game reset behavior"], ["cleanup"]]) {
    const result = runtime.reconcileCheckpoint(
      "execution",
      ExecutionCheckpoint.Result.parse({
        ...ExecutionCheckpoint.conservativeContinue(),
        failures: [],
        decision: "continue",
        requestedCalls: 8,
        completedWork: ["game functions declared"],
        objectiveAssessment: "Implementation complete",
        progressSummary: "Build success; all tests pass",
        remainingWork,
      }),
    )
    expect(result.decision).toBe("continue")
    expect(result.requestedCalls).toBe(10)
    expect(result.finalResponse).toBeUndefined()
  }
})

test("late skill exploration cannot buy large grants or repeat impossible browser obligations", () => {
  const state = {
    contract: ExecutionContract.fallback(),
    evidence: {
      mutatingCalls: 1,
      filesRead: ["new-reference.md"],
      recentToolFamilies: ["skill", "read"],
      recentSemanticActionResults: ["new-reference-result"],
    },
    extensionCount: 1,
  } as ExecutionRuntime.ExecutionState
  const previous = { evidence: { mutatingCalls: 1, noProgressSlices: 1 }, routeRevision: 0, planRevision: 0 }
  const ledger = {
    checkpoints: () => [{ payload: previous }],
    view: () => ({ rootSessionID: "root", routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    hasUnresolvedExecutionTaskflow: () => false,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => state,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: (current = [], prior = []) => current.some((item) => !prior.includes(item)),
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  const request = ExecutionCheckpoint.Result.parse({
    ...ExecutionCheckpoint.conservativeContinue(),
    requestedCalls: 30,
    remainingWork: [
      "Verify direct-file Chrome behavior",
      "Test file:// launch",
      "UNVERIFIED: single-file self-containment over file://",
    ],
  })
  const result = runtime.reconcileCheckpoint("execution", request)
  expect(result.requestedCalls).toBe(10)
  expect(result.remainingWork).toEqual([
    "Verify the deliverable over local HTTP; report unsupported direct-file verification as a limitation.",
  ])
  expect(result.discoveries.join(" ")).toContain("direct-file behavior is unverified")
  expect(runtime.checkpointRuntimeState("execution")).toMatchObject({ progressed: false, noProgressSlices: 2 })
  previous.evidence.noProgressSlices = 2
  expect(runtime.reconcileCheckpoint("execution", request).decision).toBe("blocked")
  state.evidence.fileWriteCounts = { "index.html": 1 }
  const productive = runtime.reconcileCheckpoint("execution", request)
  expect(productive.decision).toBe("continue")
  expect(productive.requestedCalls).toBe(30)
})

test("failed durable workflow blocks finalization without converting it to success", () => {
  const contract = ExecutionContract.fallback("test")
  const state = {
    contract,
    policy: ExecutionPolicy.resolvePolicy(contract, {}),
    evidence: {},
    promotionReasons: [],
    classifierFallback: false,
    extensionCount: 0,
  } as ExecutionRuntime.ExecutionState
  const ledger = {
    checkpoints: () => [],
    view: () => ({ rootSessionID: "root", routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    hasUnresolvedExecutionTaskflow: () => true,
    blockers: () => [
      {
        producerID: "workflow:test",
        kind: "workflow",
        state: "failed",
      },
    ],
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => state,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })

  const result = runtime.reconcileCheckpoint(
    "execution",
    ExecutionCheckpoint.Result.parse({
      ...ExecutionCheckpoint.conservativeContinue(),
      decision: "finish",
      requestedCalls: undefined,
      finalResponse: "The requested verification is complete.",
      completedWork: ["fast child verified"],
      failures: ["slow child timed out"],
    }),
    "root",
    "root-invocation",
  )

  expect(result.decision).toBe("blocked")
  expect(result.finalResponse).toBeUndefined()
  expect(result.requestedCalls).toBeUndefined()
  expect(result.blockers.join(" ")).toContain("workflow:test (failed)")
  const continuing = runtime.reconcileCheckpoint("execution", ExecutionCheckpoint.conservativeContinue(), "root")
  expect(continuing.decision).toBe("blocked")
  expect(continuing.requestedCalls).toBeUndefined()
  expect(continuing.estimatedRemainingCalls).toBe(0)
  expect(continuing.blockers.join(" ")).toContain("workflow:test (failed)")
  expect(continuing.remainingWork.join(" ")).not.toContain("recover failed tasks")
})

test("new forensic queries do not reset stalled failed-workflow checkpoints", () => {
  const prior = {
    invocationID: "root-invocation",
    evidence: { noProgressSlices: 2, recentSemanticActionResults: ["query-a:result-a"] },
  }
  const state = {
    evidence: { filesRead: ["internal-ledger.sqlite"], recentSemanticActionResults: ["query-b:result-b"] },
    extensionCount: 0,
  } as ExecutionRuntime.ExecutionState
  const ledger = {
    checkpoints: () => [{ payload: prior }],
    view: () => ({ rootSessionID: "root", routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    blockers: () => [{ kind: "workflow", state: "failed" }],
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => state,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: (current = [], previous = []) => current.some((value) => !previous.includes(value)),
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  expect(runtime.checkpointRuntimeState("execution", "root-invocation")).toMatchObject({
    progressed: false,
    noProgressSlices: 3,
  })
  state.evidence.fileWriteCounts = { "deliverable.ts": 2 }
  expect(runtime.checkpointRuntimeState("execution", "root-invocation")).toMatchObject({
    progressed: true,
    noProgressSlices: 0,
  })
})

test("write-authorized bash results survive mutations and distinguish changed output from loops", () => {
  const contract = ExecutionContract.fallback("test")
  let state = {
    contract,
    policy: ExecutionPolicy.resolvePolicy(contract, {}),
    evidence: {},
    promotionReasons: [],
    classifierFallback: false,
    extensionCount: 0,
  } as ExecutionRuntime.ExecutionState
  const previous = { evidence: {}, routeRevision: 0, planRevision: 0 }
  const ledger = {
    checkpoints: () => [{ payload: previous }],
    view: () => ({ routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    sliceCheckpointReason: () => undefined,
    stepCount: () => 0,
    sliceUsedCalls: () => 0,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const repeatedTail = (values: string[] = [], count: number) =>
    values.length >= count && values.slice(-count).every((value) => value === values.at(-1))
  const evidence = createEvidenceRuntime({
    ledger: () => ledger,
    getState: () => state,
    setState: (_id, next) => {
      state = { ...state, ...next }
    },
    updateState: (_id, next) => {
      state = next
    },
    makeBudgetError: (reason) => new Error(reason),
    logPromotion: () => {},
    hasRepeatedTail: repeatedTail,
  })
  const checkpoint = createCheckpointRuntimeModule({
    getExecutionState: () => state,
    setExecutionState: (_id, next) => {
      state = next
    },
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: evidence.hasNewEvidencePath,
    hasRepeatedTail: repeatedTail,
    event: ExecutionRuntime.Event,
  })
  for (const result of ["build", "tarball", "verified contents"]) {
    evidence.recordToolCall("execution", { mutatingCalls: 1, successfulToolCalls: 1 }, { signature: "bash-command" })
    evidence.recordSemanticActionResult("execution", "bash-command", result)
    expect(checkpoint.checkpointRuntimeState("execution")).toMatchObject({ progressed: true, noProgressSlices: 0 })
    previous.evidence = structuredClone(state.evidence)
  }
  expect(state.evidence.filesChanged).toEqual([])
  expect(state.evidence.recentSemanticActionResults).toHaveLength(3)
  expect(evidence.checkpointReason("execution")).toBeUndefined()
  expect(checkpoint.finalizationConstraints("execution")).toEqual([])
  state.contract = { ...contract, scope: "coordinated" }
  state.policy = ExecutionPolicy.resolvePolicy(state.contract, state.evidence)
  state.evidence.toolCalls = 10
  // A visible checklist is sufficient planning; absent legacy taskflow is no interruption.
  expect(evidence.checkpointReason("execution")).toBeUndefined()
  for (let index = 0; index < 3; index++) {
    evidence.recordToolCall("execution", { mutatingCalls: 1, successfulToolCalls: 1 }, { signature: "bash-command" })
    evidence.recordSemanticActionResult("execution", "bash-command", "verified contents")
    const runtime = checkpoint.checkpointRuntimeState("execution")
    expect(runtime).toMatchObject({ progressed: false, noProgressSlices: index + 1 })
    previous.evidence = { ...structuredClone(state.evidence), noProgressSlices: runtime.noProgressSlices }
  }
  expect(evidence.checkpointReason("execution")).toBe("repeated_tool_call")
  expect(checkpoint.finalizationConstraints("execution")).toContain(
    "The same tool call was repeated without new evidence.",
  )
})

test("route changes without work evidence do not reset the checkpoint stall counter", () => {
  let priorNoProgress = 0
  let routeRevision = 2
  const ledger = {
    checkpoints: () => [
      {
        payload: {
          evidence: { noProgressSlices: priorNoProgress },
          routeRevision: routeRevision - 1,
          planRevision: 0,
        },
      },
    ],
    view: () => ({ routeRevision }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => ({ evidence: {}, extensionCount: 0 }) as ExecutionRuntime.ExecutionState,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })

  const first = runtime.checkpointRuntimeState("execution")
  expect(first).toMatchObject({ routeChanged: true, progressed: false, noProgressSlices: 1 })
  priorNoProgress = first.noProgressSlices
  routeRevision++
  const second = runtime.checkpointRuntimeState("execution")
  expect(second).toMatchObject({ routeChanged: true, progressed: false, noProgressSlices: 2 })
  expect(runtime.finalizationConstraints("execution")).not.toContain(
    "No verifiable progress was recorded across consecutive execution slices.",
  )
  priorNoProgress = second.noProgressSlices
  routeRevision++
  expect(runtime.checkpointRuntimeState("execution")).toMatchObject({ noProgressSlices: 3 })
  expect(runtime.finalizationConstraints("execution")).toContain(
    "No verifiable progress was recorded across consecutive execution slices.",
  )
})

test("running child work does not exhaust parent no-progress checkpoints", () => {
  let running = 1
  const ledger = {
    checkpoints: () => [{ payload: { evidence: { noProgressSlices: 2 }, routeRevision: 1, planRevision: 0 } }],
    view: () => ({ routeRevision: 1 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => running > 0,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => ({ evidence: {}, extensionCount: 0 }) as ExecutionRuntime.ExecutionState,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  expect(runtime.checkpointRuntimeState("execution")).toMatchObject({ progressed: false, noProgressSlices: 2 })
  expect(runtime.finalizationConstraints("execution")).not.toContain(
    "No verifiable progress was recorded across consecutive execution slices.",
  )
  running = 0
  expect(runtime.checkpointRuntimeState("execution").noProgressSlices).toBe(3)
})

test("root final retries share progress history without borrowing child progress", () => {
  const checkpoints: {
    payload: {
      invocationID: string
      sessionID?: string
      evidence: ExecutionPolicy.RuntimeEvidence
      routeRevision: number
      planRevision: number
    }
  }[] = [
    { payload: { invocationID: "original", evidence: { noProgressSlices: 1 }, routeRevision: 0, planRevision: 0 } },
    { payload: { invocationID: "child", sessionID: "child-session", evidence: {}, routeRevision: 0, planRevision: 0 } },
  ]
  const ledger = {
    checkpoints: () => checkpoints,
    invocation: (id: string) =>
      id === "original" ? { sessionID: "root" } : id === "child" ? { sessionID: "child-session" } : undefined,
    view: () => ({ rootSessionID: "root", routeRevision: 0 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: () => false,
    hasUnresolvedExecutionTaskflow: () => false,
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => ({ evidence: {}, extensionCount: 0 }) as ExecutionRuntime.ExecutionState,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  const request = ExecutionCheckpoint.Result.parse({
    ...ExecutionCheckpoint.conservativeContinue(),
    decision: "finish",
    finalResponse: "Done",
  })
  expect(runtime.checkpointRuntimeState("execution", "retry-1", "root")).toMatchObject({
    progressed: false,
    noProgressSlices: 2,
  })
  checkpoints.push({
    payload: {
      invocationID: "retry-1",
      sessionID: "root",
      evidence: { noProgressSlices: 2 },
      routeRevision: 0,
      planRevision: 0,
    },
  })
  expect(runtime.reconcileCheckpoint("execution", request, "root", "retry-2").decision).toBe("blocked")
  expect(runtime.checkpointRuntimeState("execution", "new-child", "another-child")).toMatchObject({
    progressed: true,
    noProgressSlices: 0,
  })
})

test("a checkpointing child is not exempted from its own no-progress limit", () => {
  const ledger = {
    checkpoints: () => [
      {
        payload: {
          invocationID: "child-invocation",
          evidence: { noProgressSlices: 2 },
          routeRevision: 1,
          planRevision: 0,
        },
      },
    ],
    view: () => ({ routeRevision: 1 }),
    planRevision: () => 0,
    revision: () => 0,
    hasRunningChild: (_executionID: string, callerInvocationID?: string) => callerInvocationID !== "child-invocation",
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createCheckpointRuntimeModule({
    getExecutionState: () => ({ evidence: {}, extensionCount: 0 }) as ExecutionRuntime.ExecutionState,
    setExecutionState: () => {},
    deleteExecutionState: () => {},
    ledger: () => ledger,
    hasNewEvidencePath: () => false,
    hasRepeatedTail: () => false,
    event: ExecutionRuntime.Event,
  })
  expect(runtime.checkpointRuntimeState("execution", "child-invocation")).toMatchObject({
    progressed: false,
    noProgressSlices: 3,
  })
  expect(runtime.finalizationConstraints("execution", undefined, "child-invocation")).toContain(
    "No verifiable progress was recorded across consecutive execution slices.",
  )
})

test("step threshold requests one checkpoint, then lets work continue", () => {
  let handled = false
  const ledger = {
    sliceCheckpointReason: () => undefined,
    stepCount: () => 25,
    checkpoints: () => (handled ? [{ payload: { telemetry: { reason: "step_threshold" }, planRevision: 0 } }] : []),
    sliceUsedCalls: () => 0,
    planRevision: () => 0,
    view: () => ({ routeRevision: 0 }),
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createEvidenceRuntime({
    ledger: () => ledger,
    getState: () =>
      ({ policy: { scope: "focused", budget: { maxSteps: 30 } }, evidence: {}, sliceStartCalls: 0 }) as never,
    setState: () => {},
    updateState: () => {},
    makeBudgetError: (reason) => new Error(reason),
    logPromotion: () => {},
    hasRepeatedTail: () => false,
  })
  expect(runtime.checkpointReason("execution")).toBe("step_threshold")
  handled = true
  expect(runtime.checkpointReason("execution")).toBeUndefined()
})

test("a continue grant does not checkpoint unchanged evidence again before new work", () => {
  const evidence = {
    toolCalls: 3,
    fileWriteCounts: { "index.html": 3 },
    recentToolTargets: ["write:index.html", "write:index.html", "write:index.html"],
  }
  let current = structuredClone(evidence)
  let routeRevision = 1
  const ledger = {
    sliceCheckpointReason: () => undefined,
    stepCount: () => 0,
    sliceUsedCalls: () => 0,
    planRevision: () => 1,
    view: () => ({ routeRevision }),
    checkpoints: () => [
      { payload: { evidence, planRevision: 1, routeRevision: 1, checkpoint: { decision: "continue" } } },
    ],
  } as unknown as ReturnType<typeof ExecutionLedger.open>
  const runtime = createEvidenceRuntime({
    ledger: () => ledger,
    getState: () =>
      ({ policy: { scope: "focused", budget: { maxSteps: 30 } }, evidence: current, sliceStartCalls: 3 }) as never,
    setState: () => {},
    updateState: () => {},
    makeBudgetError: (reason) => new Error(reason),
    logPromotion: () => {},
    hasRepeatedTail: (values = [], count) =>
      values.length >= count && values.slice(-count).every((value) => value === values.at(-1)),
  })
  expect(runtime.checkpointReason("execution")).toBeUndefined()
  expect(runtime.checkpointReason("execution")).toBeUndefined()
  current = { ...current, toolCalls: 4 }
  expect(runtime.checkpointReason("execution")).toBe("repeated_tool_target")
  current = { ...current, recentToolTargets: [] }
  routeRevision++
  expect(runtime.checkpointReason("execution")).toBe("route_or_plan_changed")
})
