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
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { PromptContext } from "@/core/session/prompt/context"
import { SessionCompaction } from "@/core/session/compaction"
import { SessionStatus } from "@/core/session/status"
import { tmpdir } from "../fixture/fixture"

describe("session prompt turn context", () => {
  test("routes simple conversational prompts to direct execution", () => {
    expect(SessionPrompt._internals.isDirectAnswer("Merhaba, saat kaç?", "agent")).toBe(true)
    expect(SessionPrompt._internals.isDirectAnswer("Fix the auth middleware", "agent")).toBe(false)
    expect(SessionPrompt._internals.isDirectAnswer("Bu projeyi incele", "agent")).toBe(false)
    expect(SessionPrompt._internals.isDirectAnswer("Merhaba", "build")).toBe(false)
  })

  test("recognizes explicit orchestration requests as a scope floor signal", () => {
    expect(SessionPrompt._internals.explicitOrchestration("Bu iş için alt agent oluştur")).toBe(true)
    expect(SessionPrompt._internals.explicitOrchestration("Paralel olarak iki modülü incele")).toBe(true)
    expect(SessionPrompt._internals.explicitOrchestration("Bu dosyayı oku ve açıkla")).toBe(false)
  })

  test("continuation prompts without work keywords keep the full toolset", () => {
    // Regression: these carry no keyword, so absence-of-keyword matching used to
    // classify them as a conversational turn, which produced a direct/answer
    // contract whose allowlist is empty and stranded the agent with no tools.
    for (const prompt of [
      "Devam et lütfen",
      "Devam",
      "Devam?",
      "Devam et lütfen bu zor bir görev",
      "Devam et lütfen. Bu işlerin çoğu bitmiş olabilir önce kontrol et",
      "bir bakar mısın",
      "şimdi ne yapıyoruz",
      "hadi başlayalım",
      "son durum nedir",
    ]) {
      expect(SessionPrompt._internals.isDirectAnswer(prompt, "agent")).toBe(false)
    }
  })

  test("short continuation inherits unfinished work contract only", () => {
    const contract = ExecutionContract.fallback("interactive game", {
      intent: "design",
      scope: "coordinated",
      needsMutation: true,
      expectedSurfaces: ["workspace", "browser"],
    })
    const executions = [
      { id: "current", lifecycle: "active", outcome: null },
      { id: "previous", lifecycle: "terminal", outcome: "budget_exhausted" },
    ]
    const getContract = (id: string) => (id === "previous" ? contract : undefined)
    expect(PromptContext.continuationContract("Devam", "current", executions, getContract)).toEqual(contract)
    expect(PromptContext.continuationContract("Continue!", "current", executions, getContract)).toEqual(contract)
    expect(PromptContext.continuationContract("Yeni görev", "current", executions, getContract)).toBeUndefined()
    expect(
      PromptContext.continuationContract(
        "Devam et",
        "current",
        [{ ...executions[0] }, { ...executions[1], outcome: "completed" }],
        getContract,
      ),
    ).toBeUndefined()
  })

  test("greetings and short questions stay conversational", () => {
    expect(SessionPrompt._internals.isDirectAnswer("Selam", "agent")).toBe(true)
    expect(SessionPrompt._internals.isDirectAnswer("nasılsın?", "agent")).toBe(true)
    expect(SessionPrompt._internals.isDirectAnswer("teşekkür ederim", "agent")).toBe(true)
    // Long prompts are never treated as a simple conversational turn.
    expect(SessionPrompt._internals.isDirectAnswer("Merhaba? ".repeat(60), "agent")).toBe(false)
  })

  test("direct answer excludes task tools but retains promotion controls", () => {
    const allowed = ExecutionPolicy.selectAllowedTools("direct", "answer")
    expect(allowed).toEqual([])

    expect(ExecutionPolicy.selectAllowedTools("focused", "change")).toContain("bash")
    expect(ExecutionPolicy.selectAllowedTools("coordinated", "change")).toEqual([
      "read",
      "edit",
      "write",
      "grep",
      "find",
      "bash",
      "lsp",
      "websearch",
      "webfetch",
      "todo",
      "agent",
      "static_check",
    ])
    expect(ExecutionPolicy.selectAllowedTools("direct", "inspect")).toEqual(["read", "grep", "find"])
  })

  test("every reachable non-coordinated contract still yields a usable toolset", () => {
    const scopes = ["direct", "focused", "coordinated"] as const
    const intents = ["answer", "inspect", "change", "operate", "design"] as const
    for (const scope of scopes) {
      for (const intent of intents) {
        const allowed = ExecutionPolicy.selectAllowedTools(scope, intent)
        expect(Array.isArray(allowed) || allowed === undefined).toBe(true)
      }
    }
  })

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
      routeDecision: "keep" as const,
      selfCritique: "No issues.",
      failedApproaches: [],
      whatToChanges: [],
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
      routeDecision: "keep" as const,
      selfCritique: "No issues.",
      failedApproaches: [],
      whatToChanges: [],
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

  test("checkpoint delta removes identical repeated observations", () => {
    const tool = {
      id: "tool",
      messageID: "assistant",
      sessionID: "session",
      type: "tool",
      callID: "call",
      tool: "bash",
      state: {
        status: "completed",
        input: {},
        output: "same result",
        time: { start: 20, end: 21 },
      },
    }
    const delta = SessionPrompt._internals.checkpointDelta([
      { info: { id: "one", sessionID: "session", role: "assistant", time: { created: 20 } }, parts: [tool] },
      { info: { id: "two", sessionID: "session", role: "assistant", time: { created: 21 } }, parts: [tool] },
    ] as any)
    expect(delta.match(/tool bash \[completed\]: same result/g)).toHaveLength(1)
  })

  test("checkpoint delta keeps the newest copy of a repeated result when earlier copies fall out of the window", () => {
    const toolPart = {
      id: "tool",
      messageID: "assistant",
      sessionID: "session",
      type: "tool",
      callID: "call",
      tool: "bash",
      state: {
        status: "completed",
        input: {},
        output: "12 pass, 0 fail",
        time: { start: 20, end: 21 },
      },
    }
    const messages = [
      { info: { id: "first", sessionID: "session", role: "assistant", time: { created: 20 } }, parts: [toolPart] },
      ...Array.from({ length: 120 }, (_, index) => ({
        info: { id: `filler-${index}`, sessionID: "session", role: "assistant", time: { created: 21 + index } },
        parts: [
          {
            id: `text-${index}`,
            messageID: `filler-${index}`,
            sessionID: "session",
            type: "text",
            synthetic: false,
            text: `filler work step ${index}`,
          },
        ],
      })),
      { info: { id: "latest", sessionID: "session", role: "assistant", time: { created: 141 } }, parts: [toolPart] },
    ]
    const delta = SessionPrompt._internals.checkpointDelta(messages as any)
    expect(delta).toContain("tool bash [completed]: 12 pass, 0 fail")
  })

  test("checkpoint delta preserves the red-to-green sequence with the newest verification last", () => {
    const tool = (output: string, status: "completed" | "error", id: string) => ({
      id,
      messageID: "assistant",
      sessionID: "session",
      type: "tool",
      callID: id,
      tool: "bash",
      state:
        status === "error"
          ? { status, input: {}, error: output, time: { start: 20, end: 21 } }
          : { status, input: {}, output, time: { start: 20, end: 21 } },
    })
    const messages = [
      {
        info: { id: "red", sessionID: "session", role: "assistant", time: { created: 20 } },
        parts: [tool("3 failed: parse, render, save", "error", "call-red")],
      },
      ...Array.from({ length: 30 }, (_, index) => ({
        info: { id: `filler-${index}`, sessionID: "session", role: "assistant", time: { created: 21 + index } },
        parts: [
          {
            id: `text-${index}`,
            messageID: `filler-${index}`,
            sessionID: "session",
            type: "text",
            synthetic: false,
            text: `fix step ${index}`,
          },
        ],
      })),
      {
        info: { id: "red-retry", sessionID: "session", role: "assistant", time: { created: 51 } },
        parts: [tool("3 failed: parse, render, save", "error", "call-red-retry")],
      },
      {
        info: { id: "green", sessionID: "session", role: "assistant", time: { created: 52 } },
        parts: [tool("5 pass, 0 fail", "completed", "call-green")],
      },
    ]
    const delta = SessionPrompt._internals.checkpointDelta(messages as any)
    expect(delta.match(/tool bash \[error\]: 3 failed: parse, render, save/g)).toHaveLength(1)
    expect(delta).toContain("tool bash [completed]: 5 pass, 0 fail")
    expect(delta.split("\n").at(-1)).toBe("tool bash [completed]: 5 pass, 0 fail")
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

  test("cancelled run cleanup clears a late busy status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_cancel_status"
        const owner = SessionPrompt._internals.start(sessionID)!
        SessionPrompt.cancel(sessionID)
        SessionStatus.set(sessionID, { type: "busy" })
        SessionPrompt._internals.finish(sessionID, owner)
        expect(SessionStatus.get(sessionID).type).toBe("idle")
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

        const coordinated = SessionPrompt._internals.insertReminders({
          messages: structuredClone(messages) as never,
          agent: { name: "build" } as never,
          step: 3,
          scope: "coordinated",
        })
        expect(JSON.stringify(coordinated)).toContain("<coordinated_plan>")
        const repeated = SessionPrompt._internals.insertReminders({
          messages: coordinated as never,
          agent: { name: "build" } as never,
          step: 4,
          scope: "coordinated",
        })
        expect(JSON.stringify(repeated).match(/<coordinated_plan>/g)).toHaveLength(1)

        const direct = SessionPrompt._internals.insertReminders({
          messages: structuredClone(messages) as never,
          agent: { name: "build" } as never,
          step: 1,
          scope: "direct",
        })
        expect(JSON.stringify(direct)).not.toContain("<coordinated_plan>")

        const unavailable = SessionPrompt._internals.insertReminders({
          messages: structuredClone(messages) as never,
          agent: { name: "build" } as never,
          step: 1,
          scope: "coordinated",
          taskflowAvailable: false,
        })
        expect(JSON.stringify(unavailable)).not.toContain("<coordinated_plan>")
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

  test("retries the commit when the staged content snapshot went stale", async () => {
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
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })) as MessageV2.User
        const userID = Identifier.ascending("message")
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "edit",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
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

        // An external writer (formatter, watcher, git hook) changes the file without
        // going through a tracked mutating tool call, so the revision still matches and
        // the commit is rejected on the content snapshot instead.
        await Bun.write(`${tmp.path}/${filepath}`, "changed by an external writer")

        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
          }),
        ).toBe("retry")
        // "retry" is only returned from the re-hydration path, and the execution must be
        // left live for the loop to re-enter rather than terminalized or thrown out of.
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({ lifecycle: "active" })
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  })
})
