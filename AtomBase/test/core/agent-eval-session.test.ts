import { describe, expect, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"
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

  test("derives test, review, retry, tool, token, and duration signals from a completed turn", async () => {
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
            tool: "read",
            state: {
              status: "error",
              input: { filePath: "missing.ts" },
              error: "not found",
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
})
