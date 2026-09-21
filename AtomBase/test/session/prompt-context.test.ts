import { describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
import { Storage } from "@/core/storage/storage"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { HarnessState } from "@/core/session/harness-state"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { SessionCompaction } from "@/core/session/compaction"
import { tmpdir } from "../fixture/fixture"

describe("session prompt turn context", () => {
  test("checkpoint is a first-class message part", () => {
    expect(
      MessageV2.Part.parse({
        id: "part-checkpoint",
        messageID: "message-checkpoint",
        sessionID: "session-checkpoint",
        type: "checkpoint",
        sequence: 4,
        decision: "continue",
        requestedCalls: 80,
        grantedCalls: 50,
        objectiveAssessment: "Objective remains unchanged.",
        progressSummary: "Core implementation complete.",
        discoveries: [],
        completedWork: ["runtime"],
        remainingWork: ["verification"],
        failures: [],
        blockers: [],
        routeAssessment: "Current route remains suitable.",
        nextActions: ["run tests"],
      }),
    ).toMatchObject({ type: "checkpoint", sequence: 4, grantedCalls: 50 })
  })

  test("checkpoint mode disables every tool to force a structured response", () => {
    expect(
      Object.keys(
        SessionPrompt._internals.checkpointTools({
          bash: 1,
          read: 1,
          edit: 1,
          taskflow: 1,
          model_control: 1,
        }),
      ),
    ).toEqual([])
  })

  test("parseCheckpointJson extracts valid JSON from clean and markdown-wrapped text", () => {
    const raw = JSON.stringify({ decision: "continue", requestedCalls: 20 })
    expect(SessionPrompt._internals.parseCheckpointJson(raw)).toEqual({ decision: "continue", requestedCalls: 20 })

    const fenced = "Here is my evaluation:\n```json\n" + raw + "\n```\nHope this helps."
    expect(SessionPrompt._internals.parseCheckpointJson(fenced)).toEqual({ decision: "continue", requestedCalls: 20 })

    const inline = "Some preamble text: " + raw + " and trailing text."
    expect(SessionPrompt._internals.parseCheckpointJson(inline)).toEqual({ decision: "continue", requestedCalls: 20 })

    const multiple = `${JSON.stringify({ note: "preface" })}\n${raw}`
    expect(SessionPrompt._internals.parseCheckpointJsonCandidates(multiple)).toEqual([
      { note: "preface" },
      { decision: "continue", requestedCalls: 20 },
    ])

    expect(SessionPrompt._internals.parseCheckpointJson("not json at all")).toBeUndefined()
  })

  test("finish checkpoint requires and stages a user-facing final response", () => {
    const base = {
      objectiveAssessment: "done",
      progressSummary: "verified",
      discoveries: [],
      completedWork: ["implementation"],
      remainingWork: [],
      failures: [],
      blockers: [],
      routeAssessment: "appropriate",
      planChanged: false,
      routeChanged: false,
      estimatedRemainingCalls: 0,
      nextActions: [],
    }
    expect(ExecutionCheckpoint.Result.safeParse({ ...base, decision: "finish" }).success).toBe(false)
    expect(ExecutionCheckpoint.Result.safeParse({ ...base, decision: "continue" }).success).toBe(false)
    expect(
      ExecutionCheckpoint.Result.safeParse({ ...base, decision: "finish", finalResponse: "Task complete." }).success,
    ).toBe(true)

    const parts = SessionPrompt._internals.checkpointFinalParts(
      [
        {
          id: "checkpoint-json",
          messageID: "assistant",
          sessionID: "session",
          type: "text",
          text: JSON.stringify({ decision: "finish", finalResponse: "Task complete." }),
        },
      ],
      { sessionID: "session", messageID: "assistant", finalResponse: "Task complete." },
    )
    expect(parts).toHaveLength(1)
    expect(parts[0].text).toBe("Task complete.")
  })

  test("normalizes a finish checkpoint while taskflow is still open", () => {
    const checkpoint = ExecutionCheckpoint.Result.parse({
      decision: "finish",
      finalResponse: "Everything is complete.",
      objectiveAssessment: "done",
      progressSummary: "verified",
      discoveries: [],
      completedWork: ["implementation"],
      remainingWork: [],
      failures: [],
      blockers: [],
      routeAssessment: "appropriate",
      planChanged: false,
      routeChanged: false,
      estimatedRemainingCalls: 0,
      nextActions: [],
    })
    const normalized = SessionPrompt._internals.normalizeCheckpointForOpenTaskflow(checkpoint, true)
    expect(normalized).toMatchObject({
      decision: "continue",
      requestedCalls: ExecutionCheckpoint.MIN_CHECKPOINT_CALLS,
      estimatedRemainingCalls: 1,
    })
    expect(normalized.finalResponse).toBeUndefined()
    expect(normalized.blockers.join(" ")).toContain("durable taskflow")
    expect(SessionPrompt._internals.normalizeCheckpointForOpenTaskflow(checkpoint, false)).toEqual(checkpoint)
  })

  test("final-gate rejection becomes an event-driven checkpoint", () => {
    expect(
      SessionPrompt._internals.isCheckpointContinuation({
        info: { id: "retry", sessionID: "session", role: "user", time: { created: 1 } },
        parts: [
          {
            id: "part",
            messageID: "retry",
            sessionID: "session",
            type: "text",
            synthetic: true,
            text: SessionPrompt._internals.reviewRetryText("Completion preconditions failed: open todo"),
          },
        ],
      } as any),
    ).toBe(true)
  })

  test("checkpoint delta preserves meaningful results without dumping raw output", () => {
    const delta = SessionPrompt._internals.checkpointDelta([
      {
        info: { id: "assistant", sessionID: "session", role: "assistant", time: { created: 20 } },
        parts: [
          {
            id: "tool",
            messageID: "assistant",
            sessionID: "session",
            type: "tool",
            callID: "call",
            tool: "bash",
            state: {
              status: "error",
              input: {},
              error: "test failed",
              time: { start: 20, end: 21 },
            },
          },
          { id: "compact", messageID: "assistant", sessionID: "session", type: "compaction", auto: true },
        ],
      } as any,
    ])
    expect(delta).toContain("tool bash [error]: test failed")
    expect(delta).toContain("conversation compaction recorded")
  })

  test("bounds shell output while preserving the newest complete text", () => {
    const limit = 96
    let output = SessionPrompt._internals.appendShellOutput("", "old:" + "x".repeat(120), limit)
    output = SessionPrompt._internals.appendShellOutput(output, "\nnewest-result", limit)

    expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(limit)
    expect(output).toStartWith("[earlier shell output truncated]\n")
    expect(output).toEndWith("newest-result")
    expect(output.match(/earlier shell output truncated/g)).toHaveLength(1)
  })

  test("persists a model-resolution failure once as the selected virtual model's assistant error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "atomcli", modelID: "atomcli-free" },
        })) as MessageV2.User
        const first = await SessionPrompt._internals.recordModelResolutionError({
          sessionID: session.id,
          user,
          messages: await Session.messages({ sessionID: session.id }),
          error: new Error("atomcli-free: no verified free model is currently available"),
        })
        const second = await SessionPrompt._internals.recordModelResolutionError({
          sessionID: session.id,
          user,
          messages: await Session.messages({ sessionID: session.id }),
          error: new Error("must not create a duplicate"),
        })
        const messages = await Session.messages({ sessionID: session.id })
        const failures = messages.filter(
          (message) => message.info.role === "assistant" && message.info.parentID === user.id,
        )

        expect(second.id).toBe(first.id)
        expect(failures).toHaveLength(1)
        expect(first.providerID).toBe("atomcli")
        expect(first.modelID).toBe("atomcli-free")
        expect(first.finish).toBeUndefined()
        expect(first.time.completed).toBeUndefined()
        expect(first.error?.data.message).toContain("no verified free model")
      },
    })
  })

  test("disables the actual tool set on the final step", () => {
    expect(SessionPrompt._internals.shouldResolveTools(false)).toBe(true)
    expect(SessionPrompt._internals.shouldResolveTools(true)).toBe(false)
  })

  test("distinguishes synthetic execution continuations from real user turns", () => {
    const base = {
      id: "message-continuation",
      sessionID: "session-continuation",
      role: "user" as const,
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "test", modelID: "fixture" },
    }
    expect(
      SessionPrompt._internals.isSyntheticContinuation({
        info: base,
        parts: [
          {
            id: "part-synthetic",
            messageID: base.id,
            sessionID: base.sessionID,
            type: "text",
            text: "retry",
            synthetic: true,
          },
        ],
      }),
    ).toBe(true)
    expect(
      SessionPrompt._internals.isSyntheticContinuation({
        info: { ...base, id: "message-real" },
        parts: [
          {
            id: "part-real",
            messageID: "message-real",
            sessionID: base.sessionID,
            type: "text",
            text: "a real follow-up",
          },
        ],
      }),
    ).toBe(false)
    const compaction: MessageV2.CompactionPart = {
      id: "part-compaction",
      messageID: base.id,
      sessionID: base.sessionID,
      type: "compaction",
      auto: true,
    }
    for (const auto of [true, false]) {
      expect(SessionPrompt._internals.isSyntheticContinuation({ info: base, parts: [{ ...compaction, auto }] })).toBe(
        true,
      )
    }
    expect(
      SessionPrompt._internals.isSyntheticContinuation({
        info: base,
        parts: [compaction, { ...compaction, type: "text", text: "new user request" }],
      }),
    ).toBe(false)
  })

  test("compaction continuation retains execution, objective, plan and consumed allowance", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
        ExecutionRuntime.recordObjective(execution.executionID, user.id, "Read-only audit")
        ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("test"))
        await ExecutionRuntime.createPlan({
          sessionID: session.id,
          execution,
          items: [{ id: "audit", resourceScope: "plan-item:audit" }],
        })
        ExecutionRuntime.admitToolCall(execution.executionID)
        const release = ExecutionRuntime.holdLease(execution)
        try {
          await SessionCompaction.create({ sessionID: session.id, agent: user.agent, model: user.model, auto: true })
          const compact = (await Session.messages({ sessionID: session.id })).at(-1)!
          expect(compact.parts).toEqual([expect.objectContaining({ type: "compaction", auto: true })])
          expect(SessionPrompt._internals.isSyntheticContinuation(compact)).toBe(true)
          const continued = await ExecutionRuntime.bindContinuation({
            sessionID: session.id,
            invocationID: compact.info.id,
            execution,
          })
          expect(continued.executionID).toBe(execution.executionID)
          expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
          expect(ExecutionRuntime.leaseSignal(continued).aborted).toBe(false)
          expect(ExecutionRuntime.snapshot(session.id).activeInvocations).toEqual([
            expect.objectContaining({ id: compact.info.id, state: "running" }),
          ])
          expect(ExecutionRuntime.objective(execution.executionID)?.objective).toBe("Read-only audit")
          expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(true)
          expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.toolCalls).toBe(1)
          ExecutionRuntime.admitToolCall(continued.executionID)
          expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.toolCalls).toBe(2)
          for (let call = 2; call < 30; call++) ExecutionRuntime.reserveToolCall(continued.executionID)
          expect(() => ExecutionRuntime.reserveToolCall(continued.executionID)).toThrow("checkpoint_required")
        } finally {
          release()
        }
      },
    })
  })

  test("a cancellation response does not answer later user messages", () => {
    const user = { id: "msg_080e_new" } as MessageV2.User
    const cancelled = { id: "msg_cancel_old", parentID: "msg_080d_old", finish: "error" } as MessageV2.Assistant
    const current = { id: "msg_080e_reply", parentID: user.id, finish: "stop" } as MessageV2.Assistant

    expect(SessionPrompt._internals.isFinishedResponse(user, cancelled)).toBe(false)
    expect(SessionPrompt._internals.isFinishedResponse(user, current)).toBe(true)
  })

  test("an old run cleanup cannot cancel its replacement", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_run_owner"
        const first = SessionPrompt._internals.start(sessionID)!
        SessionPrompt.cancel(sessionID)
        const replacement = SessionPrompt._internals.start(sessionID)!

        SessionPrompt._internals.finish(sessionID, first)

        expect(replacement.signal.aborted).toBe(false)
        expect(() => SessionPrompt.assertNotBusy(sessionID)).toThrow()
        SessionPrompt.cancel(sessionID)
      },
    })
  })

  test("normal run cleanup does not abort the completed run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_completed_owner"
        const owner = SessionPrompt._internals.start(sessionID)!

        SessionPrompt._internals.finish(sessionID, owner)

        expect(owner.signal.aborted).toBe(false)
        expect(() => SessionPrompt.assertNotBusy(sessionID)).not.toThrow()
      },
    })
  })

  test("puts the max-step instruction in system context without ending on an assistant turn", () => {
    const messages = [{ role: "user" as const, content: "Continue the task" }]
    const result = SessionPrompt._internals.prepareTurnContext(["base"], messages, true)

    expect(result.system).toHaveLength(2)
    expect(result.system[1]).toContain("MAXIMUM STEPS REACHED")
    expect(result.messages).toEqual(messages)
    expect(result.messages.at(-1)?.role).toBe("user")
  })

  test("does not alter normal turn context", () => {
    const system = ["base"]
    const messages = [{ role: "assistant" as const, content: "history" }]
    const result = SessionPrompt._internals.prepareTurnContext(system, messages, false)

    expect(result.system).toBe(system)
    expect(result.messages).toBe(messages)
  })

  test("omits tool schemas only for exact casual turns", () => {
    const decide = (prompt: string) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt,
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
      })

    expect(decide("Selam")).toBe(false)
    expect(decide("Naber?")).toBe(false)
    expect(decide("HI")).toBe(false)
    expect(decide("Selam, nasılsın")).toBe(false)
    expect(decide("Add an endpoint")).toBe(true)
    expect(decide("Yeni bir endpoint ekle")).toBe(true)
    expect(decide("Find why the app is slow")).toBe(true)
    expect(decide("Devam et")).toBe(true)
    // Greeting + substantive task must still load tools; otherwise the model
    // hallucinates calls the provider rejects as unavailable.
    expect(decide("Selam. Codex ile bu sessionda bir sürü şey yaptık devam edelim")).toBe(true)
    expect(decide("Selam, aracı düzelt ve test et")).toBe(true)
  })

  test("resolves common tool-call hallucinations instead of routing to invalid", async () => {
    const { LLM } = await import("@/core/session/llm")
    const available = { read: {}, bash: {}, skill: {}, taskflow: {}, agent: {}, grep: {} }
    expect(LLM.resolveToolCallName("Read", available)).toBe("read")
    expect(LLM.resolveToolCallName("read_file", available)).toBe("read")
    expect(LLM.resolveToolCallName("shell", available)).toBe("bash")
    expect(LLM.resolveToolCallName("default.skill", available)).toBe("skill")
    expect(LLM.resolveToolCallName("mcp__server__read", available)).toBe("read")
    // `task` is the legacy subagent-spawning name (permission id is still
    // `task`); it must resolve to `agent`, never to progress-tracking `taskflow`.
    expect(LLM.resolveToolCallName("task", available)).toBe("agent")
    expect(LLM.resolveToolCallName("subtask", available)).toBe("agent")
    expect(LLM.resolveToolCallName("taskflow_tool", available)).toBe("taskflow")
    expect(LLM.resolveToolCallName("totally_unknown_tool", available)).toBeUndefined()
  })

  test("skips taskflow reminders when taskflow is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { SessionPrompt } = await import("@/core/session/prompt")
        const base = {
          id: "message-reminder",
          sessionID: "session-reminder",
          role: "user" as const,
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        }
        const messages = [
          {
            info: base,
            parts: [
              {
                id: "part-reminder",
                messageID: base.id,
                sessionID: base.sessionID,
                type: "text" as const,
                text: "do a multi-step task",
              },
            ],
          },
        ]
        // Unavailable: no taskflow instruction may be injected.
        const blocked = SessionPrompt._internals.insertReminders({
          messages: structuredClone(messages) as never,
          agent: { name: "build" } as never,
          step: 5,
          taskflowAvailable: false,
        })
        expect(JSON.stringify(blocked)).not.toContain("taskflow")
        // Default (available): existing behavior unchanged, no throw.
        const allowed = SessionPrompt._internals.insertReminders({
          messages: structuredClone(messages) as never,
          agent: { name: "build" } as never,
          step: 5,
        })
        expect(Array.isArray(allowed)).toBe(true)
      },
    })
  })

  test("preserves tools for explicit agents, tool overrides, and continuing tool sessions", () => {
    const decide = (overrides: Partial<Parameters<typeof SessionPrompt._internals.shouldLoadTools>[0]>) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt: "Selam",
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
        ...overrides,
      })

    expect(decide({ explicitTools: true })).toBe(true)
    expect(decide({ providerID: "atomcli" })).toBe(true)
    expect(decide({ providerID: "opencode" })).toBe(true)
    expect(decide({ providerID: "openai" })).toBe(false)
    expect(decide({ bypassAgentCheck: true })).toBe(true)
    expect(decide({ prompt: "Continue", hasPriorToolActivity: true })).toBe(true)
  })

  test("builds deterministic review retry and blocked messages without exposing a candidate", () => {
    const retry = SessionPrompt._internals.reviewRetryText("src/a.ts must be fixed")
    const blocked = SessionPrompt._internals.reviewBlockedText("Reviewer unavailable")

    expect(retry).toContain("final response was withheld")
    expect(retry).toContain("src/a.ts must be fixed")
    expect(blocked).toContain("Completion is blocked")
    expect(blocked).toContain("Reviewer unavailable")
  })

  test("commits edits when review policy does not require a reviewer", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 1,
          max_attempts: 1,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: user.id,
          sessionID: session.id,
          type: "text",
          text: "update the tracked file",
        })
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: user.id,
        })
        const filepath = "tracked.txt"
        await Bun.write(`${tmp.path}/${filepath}`, "done")
        HarnessState.restoreEditedFile(session.id, filepath)
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.model.modelID,
          providerID: user.model.providerID,
          time: { created: Date.now() },
        })
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "Completed.",
        }
        const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
        const reviewDecision = (await evaluateReviewDecision(session.id)).decision
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          parts: [part],
          editedFiles: [filepath],
          requiresReview: false,
          reviewDecision,
          execution,
        })

        expect(HarnessState.needsReview(session.id)).toBe(true)
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
          }),
        ).toBe("committed")
        expect(ExecutionRuntime.pendingContinuations(session.id)).toHaveLength(0)
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: "completed",
        })
      },
    })
  })

  test("reports an open taskflow when the final step cannot retry", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 1,
          max_attempts: 1,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: user.id,
        })
        const messageID = Identifier.ascending("message")
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "Candidate response",
        }
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.model.modelID,
          providerID: user.model.providerID,
          time: { created: Date.now() },
        })
        HarnessState.startPlan(session.id, [{ id: "unfinished", name: "Unfinished work" }])
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          parts: [part],
          editedFiles: [],
          requiresReview: false,
          execution,
        })

        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe("blocked")
        expect(ExecutionRuntime.pendingContinuations(session.id)).toHaveLength(0)
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: "budget_exhausted",
          reason: { code: "step_limit" },
        })
        const messages = await Session.messages({ sessionID: session.id })
        const assistant = messages.find((message) => message.info.id === messageID)
        expect(assistant?.info).toMatchObject({ finish: "error" })
        const finalPart = assistant?.parts.find((item) => item.type === "text")
        expect(finalPart?.text).toContain("Candidate response")
        expect(finalPart?.text).toContain("the taskflow plan is still open")
        expect(finalPart?.metadata).toMatchObject({ blockerKind: "technical" })
      },
    })
  })

  test("projects an already identical completion without rewriting parts or finish", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const partID = Identifier.ascending("part")
        const completed = Date.now()
        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          parentID: Identifier.ascending("message"),
          sessionID: session.id,
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: completed, completed },
          finish: "stop",
        })
        const part = {
          id: partID,
          messageID,
          sessionID: session.id,
          type: "text" as const,
          text: "committed response",
        }
        await Session.updatePart(part)
        const updatePart = spyOn(Session, "updatePartGuarded")
        const updateMessage = spyOn(Session, "updateMessageGuarded")
        try {
          await SessionPrompt._internals.projectCompletion({
            executionID: "execution-projected",
            sessionID: session.id,
            messageID,
            ownerID: "owner",
            fence: 1,
            finish: "stop",
            parts: [part],
            editedFiles: [],
            digest: "digest",
            requiresReview: false,
            revision: 0,
            planRevision: 0,
            routeRevision: 1,
            policyVersion: 1,
            policyDigest: "policy",
            reviewRequirement: "not_required",
            reviewReasonCode: "no_mutations",
            requiredReviewers: 0,
            attemptLimit: 3,
            contentSnapshotDigest: "snapshot",
            projection: "projected",
            state: "committed",
            projectorID: "projector",
            projectionToken: "token",
            projectionLeaseExpiresAt: Date.now() + 10_000,
            sessionGeneration: 1,
          })
          expect(updatePart).not.toHaveBeenCalled()
          expect(updateMessage).not.toHaveBeenCalled()
        } finally {
          updatePart.mockRestore()
          updateMessage.mockRestore()
        }
      },
    })
  })

  test("abandons recovery projection when a durable session tombstone already exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Storage.tombstoneSessions([session.id])
        const result = await SessionPrompt._internals.projectAndAckCompletion({
          executionID: "execution-deleted-session",
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          ownerID: "owner",
          fence: 1,
          finish: "stop",
          parts: [],
          editedFiles: [],
          digest: "deleted-session-digest",
          requiresReview: false,
          revision: 0,
          planRevision: 0,
          routeRevision: 1,
          policyVersion: 1,
          policyDigest: "policy",
          reviewRequirement: "not_required",
          reviewReasonCode: "no_mutations",
          requiredReviewers: 0,
          attemptLimit: 3,
          contentSnapshotDigest: "snapshot",
          projection: "pending",
          state: "committed",
        })
        expect(result).toBe("abandoned")
        expect(await Storage.sessionGuard(session.id)).toMatchObject({ tombstone: true, generation: 2 })
      },
    })
  })

  test("projects a root cancellation outbox even when no assistant message exists yet", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "cancel before the provider responds",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const view = ExecutionRuntime.view(execution.executionID)!
        expect(
          ExecutionRuntime.requestCancel({
            requestID: "cancel-before-assistant",
            executionID: execution.executionID,
            sessionID: session.id,
            projectID: Instance.project.id,
            expectedVersion: view.version,
          }),
        ).toMatchObject({ accepted: true })

        const claim = ExecutionRuntime.claimCompletion(session.id, execution.executionID)
        expect(claim).toBeDefined()
        expect(await SessionPrompt._internals.projectAndAckCompletion(claim!)).toBe("projected")
        const messages = await Session.messages({ sessionID: session.id, excludePatches: false })
        const assistant = messages.find((message) => message.info.id === claim!.messageID)
        expect(assistant?.info).toMatchObject({ role: "assistant", parentID: userID, finish: "error" })
        expect(assistant?.parts).toEqual([
          expect.objectContaining({ type: "text", text: "This execution was cancelled." }),
        ])
        expect(ExecutionRuntime.view(execution.executionID)?.completion?.projection).toBe("projected")
      },
    })
  })

  test("records durable recovery when a committed completion has no projectable message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
          execution,
        })
        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: session.id,
          execution,
          digest: staged.digest,
        })

        expect(await SessionPrompt._internals.projectAndAckCompletion(committed)).toBe("recovery_required")
        expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
          recoveryRequired: true,
          completion: { projection: "recovery_required" },
        })
        expect(ExecutionRuntime.claimCompletion(session.id, execution.executionID)).toBeUndefined()
      },
    })
  })

  test("recovers from a model removed since the session was created", async () => {
    await Config.clearCache()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: "atomcli", modelID: "removed-free-model" },
          time: { created: Date.now() },
        })

        const selected = await SessionPrompt._internals.lastModel(session.id)
        expect(selected).not.toEqual({ providerID: "atomcli", modelID: "removed-free-model" })
      },
    })
  })
})
