import "../preload"
import { describe, expect, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"
import { ModelQuality } from "@/core/routing/model-quality"
import type { MessageV2 } from "@/core/session/message-v2"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

function messages(sessionID: string): MessageV2.WithParts[] {
  const userID = "message-user"
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 100 },
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
      } as MessageV2.User,
      parts: [
        {
          id: "part-user",
          sessionID,
          messageID: userID,
          type: "text",
          text: "inspect",
        },
      ],
    },
    {
      info: {
        id: "message-assistant",
        sessionID,
        role: "assistant",
        parentID: userID,
        time: { created: 110, completed: 200 },
        agent: "build",
        path: { cwd: "/", root: "/" },
        providerID: "provider",
        modelID: "model",
        cost: 0,
        tokens: { input: 4, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      } as MessageV2.Assistant,
      parts: [{ id: "part-assistant", sessionID, messageID: "message-assistant", type: "text", text: "done" }],
    },
  ]
}

describe("AgentEval.recordSession", () => {
  test.each([true, false])(
    "benchmark=%s preserves quality history while runtime observations still learn",
    async (benchmark) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await ModelQuality.initialize()
          const before = ModelQuality.snapshot()
          const sessionID = `session-learning-${benchmark}`
          const input = messages(sessionID)
          const followup = messages(sessionID)
          followup[0].info.id = "message-correction-user"
          followup[0].info.time.created = 300
          followup[0].parts = [{ ...followup[0].parts[0], text: "still wrong, inspect again" } as MessageV2.TextPart]
          followup[1].info.id = "message-correction-assistant"
          const assistant = followup[1].info as MessageV2.Assistant
          assistant.parentID = followup[0].info.id
          assistant.time = { created: 310, completed: 400 }
          for (const message of followup)
            message.parts = message.parts.map((part) => ({
              ...part,
              id: `${part.id}-followup`,
              messageID: message.info.id,
            }))
          if (benchmark)
            AgentEval.registerBenchmark(sessionID, { suite: "benchmark-learning", caseID: "learning", runID: "run" })
          try {
            const results = await AgentEval.recordSession(sessionID, [...input, ...followup])
            expect(results).toHaveLength(3)
            expect(await AgentEval.list(benchmark ? "benchmark-learning" : "runtime")).toHaveLength(benchmark ? 2 : 3)
            if (benchmark) expect(ModelQuality.snapshot()).toEqual(before)
            else {
              const category = results[0].category
              expect(ModelQuality.get("provider", "model", category)?.samples).toBe(
                (before["provider/model"]?.categories[category]?.samples ?? 0) + 3,
              )
            }
          } finally {
            AgentEval.unregisterBenchmark(sessionID)
          }
        },
      })
    },
  )

  test("records benchmark IDs once under concurrent capture", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const input = messages("session-eval")
        AgentEval.registerBenchmark("session-eval", { suite: "benchmark-test", caseID: "case-one", runID: "run-one" })
        await Promise.all([
          AgentEval.recordSession("session-eval", input),
          AgentEval.recordSession("session-eval", input),
        ])
        AgentEval.unregisterBenchmark("session-eval")
        const results = await AgentEval.list("benchmark-test")
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          id: "case-one",
          promptVersion: "run-one",
          automatic: true,
          providerID: "provider",
          modelID: "model",
        })
      },
    })
  })

  test.each([
    ["read", "error"],
    ["invalid", "completed"],
    ["invalid", "error"],
  ])("derives signals including a %s/%s tool failure from a completed turn", async (failedTool, failedStatus) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-signals"
        const input = messages(sessionID)
        input[1].parts = [
          {
            id: "part-test",
            sessionID,
            messageID: "message-assistant",
            type: "tool",
            callID: "call-test",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun test" },
              output: "1 pass",
              title: "Bash",
              metadata: { exit: 0 },
              time: { start: 120, end: 140 },
            },
          },
          {
            id: "part-review",
            sessionID,
            messageID: "message-assistant",
            type: "tool",
            callID: "call-review",
            tool: "review-gate",
            state: {
              status: "completed",
              input: {},
              output: "VERDICT: PASSED",
              title: "Review",
              metadata: {},
              time: { start: 141, end: 150 },
            },
          },
          {
            id: "part-error",
            sessionID,
            messageID: "message-assistant",
            type: "tool",
            callID: "call-error",
            tool: failedTool,
            state: {
              status: failedStatus,
              input: { filePath: "missing.ts" },
              error: "not found",
              output: "Invalid tool arguments",
              title: "Invalid Tool",
              metadata: {},
              time: { start: 151, end: 155 },
            },
          },
          {
            id: "part-retry",
            sessionID,
            messageID: "message-assistant",
            type: "retry",
            attempt: 1,
            error: { name: "APIError", data: { message: "transient" } },
            time: { created: 160 },
          },
          {
            id: "part-assistant",
            sessionID,
            messageID: "message-assistant",
            type: "text",
            text: "done",
          },
        ] as MessageV2.Part[]

        AgentEval.registerBenchmark(sessionID, { suite: "benchmark-signals", caseID: "signals", runID: "run" })
        const [result] = await AgentEval.recordSession(sessionID, input)
        AgentEval.unregisterBenchmark(sessionID)

        expect(result).toMatchObject({
          id: "signals",
          testsPassed: true,
          reviewerVerdict: "passed",
          toolCalls: 3,
          toolErrors: 1,
          retries: 1,
          inputTokens: 4,
          outputTokens: 2,
          durationMs: 100,
          success: true,
        })
      },
    })
  })

  test("counts all models used by an adaptive benchmark turn", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-adaptive"
        const input = messages(sessionID)
        const final = input[1].info as MessageV2.Assistant
        final.time.created = 150
        final.time.completed = 200
        input.splice(1, 0, {
          info: {
            ...final,
            id: "message-expert",
            providerID: "expert-provider",
            modelID: "expert-model",
            time: { created: 110, completed: 145 },
            finish: "tool-calls",
            tokens: { input: 6, output: 3, reasoning: 0, cache: { read: 2, write: 0 } },
          } as MessageV2.Assistant,
          parts: [
            {
              id: "part-expert-test",
              sessionID,
              messageID: "message-expert",
              type: "tool",
              callID: "call-expert-test",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "bun test" },
                output: "passed",
                title: "Bash",
                metadata: { exit: 0 },
                time: { start: 120, end: 140 },
              },
            },
          ],
        })
        AgentEval.registerBenchmark(sessionID, {
          suite: "adaptive-signals",
          caseID: "mixed-models",
          runID: "run-adaptive",
          routingMode: "adaptive",
        })
        try {
          const [result] = await AgentEval.recordSession(sessionID, input)
          expect(result).toMatchObject({
            providerID: "provider",
            modelID: "model",
            toolCalls: 1,
            testsPassed: true,
            inputTokens: 12,
            outputTokens: 5,
          })
        } finally {
          AgentEval.unregisterBenchmark(sessionID)
        }
      },
    })
  })

  test("marks a completed answer unsuccessful when an observed test command fails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-failed-test"
        const input = messages(sessionID)
        input[1].parts = [
          {
            id: "part-test-failed",
            sessionID,
            messageID: "message-assistant",
            type: "tool",
            callID: "call-test-failed",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun run typecheck" },
              output: "type error",
              title: "Bash",
              metadata: { exit: 1 },
              time: { start: 120, end: 140 },
            },
          },
          {
            id: "part-assistant-failed",
            sessionID,
            messageID: "message-assistant",
            type: "text",
            text: "done",
          },
        ] as MessageV2.Part[]
        const [result] = await AgentEval.recordSession(sessionID, input)
        expect(result.testsPassed).toBe(false)
        expect(result.success).toBe(false)
      },
    })
  })

  test("a corrected test run supersedes its earlier failure", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-repaired-test"
        const input = messages(sessionID)
        const testPart = (id: string, exit: number): MessageV2.ToolPart => ({
          id,
          sessionID,
          messageID: "message-assistant",
          type: "tool",
          callID: id,
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "bun test" },
            output: exit === 0 ? "passed" : "failed",
            title: "Bash",
            metadata: { exit },
            time: { start: exit === 0 ? 150 : 120, end: exit === 0 ? 170 : 140 },
          },
        })
        input[1].parts = [testPart("first-test", 1), testPart("second-test", 0), ...input[1].parts]
        const [result] = await AgentEval.recordSession(sessionID, input)
        expect(result.testsPassed).toBe(true)
        expect(result.toolCalls).toBe(2)
        expect(result.success).toBe(true)
      },
    })
  })

  test.each([
    ["stop", false],
    ["error", false],
    ["stop", true],
    ["error", true],
  ] as const)("terminal %s includes recovery calls before completion; continuation=%s", async (finish, continued) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `session-terminal-${finish}-${continued}`
        const [user, terminal] = messages(sessionID)
        terminal.info.id = `message-terminal-${finish}-${continued}`
        const info = terminal.info as MessageV2.Assistant
        info.finish = finish
        const continuation: MessageV2.WithParts = {
          info: { ...user.info, id: `message-continuation-${finish}`, time: { created: 120 } },
          parts: [
            {
              id: `part-continuation-${finish}`,
              sessionID,
              messageID: `message-continuation-${finish}`,
              type: "text",
              text: "Continue verification",
              synthetic: true,
            },
          ],
        }
        if (continued) {
          info.parentID = continuation.info.id
          info.time.created = 160
        }
        const recovery: MessageV2.WithParts = {
          info: {
            ...info,
            id: `message-recovery-${finish}`,
            parentID: continuation.info.id,
            finish: "tool-calls",
            time: { created: 150, completed: 190 },
            tokens: { input: 6, output: 3, reasoning: 0, cache: { read: 2, write: 0 } },
          },
          parts: [
            {
              id: `part-recovery-error-${finish}`,
              sessionID,
              messageID: `message-recovery-${finish}`,
              type: "tool",
              callID: `call-recovery-error-${finish}`,
              tool: "read",
              state: {
                status: "error",
                input: { filePath: "missing.ts" },
                error: "not found",
                time: { start: 160, end: 170 },
              },
            },
            {
              id: `part-recovery-test-${finish}`,
              sessionID,
              messageID: `message-recovery-${finish}`,
              type: "tool",
              callID: `call-recovery-test-${finish}`,
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "bun test" },
                output: "passed",
                title: "Bash",
                metadata: { exit: 0 },
                time: { start: 175, end: 190 },
              },
            },
          ],
        }
        const future: MessageV2.WithParts = {
          info: {
            ...(recovery.info as MessageV2.Assistant),
            id: `message-future-${finish}`,
            time: { created: 201, completed: 210 },
          },
          parts: recovery.parts,
        }
        const nextUser: MessageV2.WithParts = {
          info: { ...user.info, id: `message-next-user-${finish}`, time: { created: 195 } },
          parts: user.parts,
        }
        const nextTurn: MessageV2.WithParts = {
          info: {
            ...(recovery.info as MessageV2.Assistant),
            id: `message-next-turn-${finish}`,
            parentID: nextUser.info.id,
            time: { created: 196, completed: 199 },
          },
          parts: recovery.parts,
        }
        const [result] = await AgentEval.recordSession(sessionID, [
          future,
          nextTurn,
          nextUser,
          recovery,
          continuation,
          terminal,
          user,
        ])
        expect(result).toMatchObject({
          toolCalls: 2,
          toolErrors: 1,
          testsPassed: true,
          inputTokens: 12,
          outputTokens: 5,
          completed: finish === "stop",
          success: finish === "stop",
        })
      },
    })
  })

  test("uses the latest test across messages delivered newest first", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const lastExit of [0, 1]) {
          const sessionID = `session-reversed-tests-${lastExit}`
          const [user, final] = messages(sessionID)
          final.info.id = `message-final-${lastExit}`
          const runs = [1 - lastExit, lastExit].map((exit, index) => {
            const id = `message-test-${lastExit}-${index}`
            return {
              info: {
                ...final.info,
                id,
                time: { created: 101 + index, completed: 105 + index },
                finish: "tool-calls",
              },
              parts: [
                {
                  id: `part-${id}`,
                  sessionID,
                  messageID: id,
                  type: "tool",
                  callID: `call-${id}`,
                  tool: "bash",
                  state: {
                    status: "completed",
                    input: { command: "bun test" },
                    output: exit === 0 ? "passed" : "failed",
                    title: "Bash",
                    metadata: { exit },
                    time: { start: 103 + index, end: 105 + index },
                  },
                },
              ],
            } as MessageV2.WithParts
          })
          const input = [final, ...runs.toReversed(), user]
          const [result] = await AgentEval.recordSession(sessionID, input)
          expect(result.testsPassed).toBe(lastExit === 0)
          expect(result.success).toBe(lastExit === 0)
          expect(input[0]).toBe(final)
        }
      },
    })
  })
})
