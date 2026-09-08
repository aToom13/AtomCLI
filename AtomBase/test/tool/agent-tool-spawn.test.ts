import { describe, expect, test, mock, beforeEach } from "bun:test"
import "../preload"
import fs from "fs/promises"
import path from "path"

// Mock SubAgent.spawn so AgentTool spawn never hits a real model.
// The mock must be registered BEFORE agent-tool / orchestrate are imported.
const spawnMock = mock(async (args: any): Promise<any> => {
  const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
  const sessionId = "ses_" + Math.random().toString(36).slice(2, 14)
  await args.onSession?.({ sessionId, isNewSession: true })
  return {
    sessionId,
    isNewSession: true,
    output: isQA ? "Independent verification complete." : "Task output: analysis done.",
    parts: [],
    structuredOutput: isQA
      ? { verdict: "passed", summary: "Independent verification complete.", findings: [] }
      : undefined,
  }
})
let statusFallback: ((sessionId: string) => any) | undefined
const statusMock = mock(
  (sessionId: string): any =>
    statusFallback?.(sessionId) ?? {
      sessionId,
      runtime: "atom-inprocess",
      status: "waiting" as const,
      startedAt: 100,
      updatedAt: 200,
    },
)
const waitMock = mock(async (sessionId: string) => statusMock(sessionId))
const cancelMock = mock(async () => {})

mock.module("../../src/integrations/tool/subagent", () => ({
  SubAgent: {
    spawn: spawnMock,
    status: statusMock,
    wait: waitMock,
    cancel: cancelMock,
    capabilities: () => ({ wait: true, status: true, revive: true, steer: false }),
    buildFromAgent: (agent: any) => [
      ...(agent.permission ?? []),
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
    buildPermissions: (parent: any[]) => [
      ...parent,
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
    ],
  },
}))

const { AgentTool } = await import("@/integrations/tool/agent-tool")
const { Session } = await import("@/core/session")
const { Storage } = await import("@/core/storage/storage")
const { Identifier } = await import("@/core/id/id")
const { Instance } = await import("@/services/project/instance")
const { SessionTermination } = await import("@/core/session/termination")
const { SessionStatus } = await import("@/core/session/status")
const { HarnessState } = await import("@/core/session/harness-state")
const { Bus } = await import("@/core/bus")
const { TuiEvent } = await import("@/interfaces/cli/cmd/tui/event")
const { SubAgentRuntime } = await import("@/integrations/tool/subagent-runtime")
const { Config } = await import("@/core/config/config")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  statusFallback = (sessionId) => {
    const now = Date.now()
    return {
      sessionId,
      runtime: "atom-inprocess",
      status: SessionStatus.get(sessionId).type === "idle" ? "waiting" : "running",
      startedAt: now,
      updatedAt: now,
    }
  }
  spawnMock.mockReset()
  spawnMock.mockImplementation(async (args: any) => {
    const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
    const sessionId = "ses_" + Math.random().toString(36).slice(2, 14)
    await args.onSession?.({ sessionId, isNewSession: true })
    return {
      sessionId,
      isNewSession: true,
      output: isQA ? "Independent verification complete." : "Task output: analysis done.",
      parts: [],
      structuredOutput: isQA
        ? { verdict: "passed", summary: "Independent verification complete.", findings: [] }
        : undefined,
    }
  })
  statusMock.mockReset()
  statusMock.mockImplementation((sessionId: string) => statusFallback!(sessionId))
  waitMock.mockReset()
  waitMock.mockImplementation(async (sessionId: string) => statusMock(sessionId))
  cancelMock.mockReset()
  cancelMock.mockImplementation(async () => {})
})

function mockCtx(sessionID: string, messageID: string) {
  return {
    sessionID,
    messageID,
    callID: "call-123",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => {},
    ask: async () => {},
    extra: { bypassAgentCheck: true },
  }
}

async function createAssistantMessageContext() {
  const session = await Session.create({})
  const userMessageID = Identifier.create("message", false)
  const messageID = Identifier.create("message", false)
  await Storage.write(["message", session.id, userMessageID], {
    id: userMessageID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() - 1 },
    agent: "build",
    model: { providerID: "atomcli", modelID: "hy3-free" },
  })
  const msgInfo = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    parentID: userMessageID,
    time: { created: Date.now() },
    agent: "build",
    modelID: "hy3-free",
    providerID: "atomcli",
    mode: "",
  }
  await Storage.write(["message", session.id, messageID], msgInfo)
  return { session, messageID }
}

describe("AgentTool spawn (blocking orchestrator behavior)", () => {
  test("spawn without required params throws validation error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const instance = await AgentTool.init({})
        const ctx = mockCtx("ses-test-1", Identifier.create("message", false))

        expect(instance.execute({ action: "spawn", prompt: "do something" }, ctx)).rejects.toThrow(
          "subagent_type, prompt, and description are required",
        )
      },
    })
  })

  test("spawn completes read-only analysis without a redundant reviewer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})

        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Analyze the codebase structure",
            description: "Analyze codebase",
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        expect(result.metadata?.error).toBe(false)
        expect(result.output).toContain("1 succeeded")
        expect(spawnMock).toHaveBeenCalled()
        // Read-only analysis uses the primary sub-agent result directly.
        const descriptions = spawnMock.mock.calls.map(([args]) => (args as any).description)
        expect(descriptions.some((d) => d && d.startsWith("[QA"))).toBe(false)
      },
    })
  })

  test("spawn preserves an existing parent taskflow and does not publish chain clears", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        HarnessState.startPlan(session.id, [
          { id: "inspect", name: "Inspect" },
          { id: "fix", name: "Fix" },
        ])
        let clearEvents = 0
        const unsubscribe = Bus.subscribe(TuiEvent.ChainClear, (event) => {
          if (event.properties.sessionID === session.id) clearEvents++
        })

        try {
          const instance = await AgentTool.init({})
          const result = await instance.execute(
            {
              action: "spawn",
              subagent_type: "explore",
              prompt: "Inspect the codebase structure",
              description: "Inspect codebase",
            },
            mockCtx(session.id, messageID),
          )

          expect(result.metadata?.status).toBe("completed")
          expect(HarnessState.getSteps(session.id).map((step) => step.name)).toEqual(["Inspect", "Fix"])
          expect(clearEvents).toBe(0)
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("spawn passes session_id through to the workflow task for session continuation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})

        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Analyze the codebase structure",
            description: "Analyze codebase",
            session_id: "ses-existing-123",
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        const spawnArgs = spawnMock.mock.calls.map(([args]) => args as any)
        const taskSpawn = spawnArgs.find((a) => a.description && !a.description.startsWith("[QA"))
        expect(taskSpawn?.sessionId).toBe("ses-existing-123")
      },
    })
  })

  test("spawn transports a validated structured result without parsing prose", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workingDirectories: string[] = []
        spawnMock.mockImplementation(async (args: any) => {
          workingDirectories.push(args.workingDirectory)
          const sessionId = "ses_typed_result"
          await args.onSession?.({ sessionId, isNewSession: true })
          return {
            sessionId,
            isNewSession: true,
            output: '<structured_output>{"summary":"done","count":2}</structured_output>',
            structuredOutput: { summary: "done", count: 2 },
            parts: [],
          }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Return the requested values",
            description: "Typed result",
            outputSchema: {
              type: "object",
              properties: { summary: { type: "string" }, count: { type: "integer" } },
              required: ["summary", "count"],
              additionalProperties: false,
            },
          },
          mockCtx(session.id, messageID),
        )

        expect(result.metadata?.structuredResults).toEqual({ typed_result: { summary: "done", count: 2 } })
        expect(result.output).not.toContain("<structured_output>")
        expect(workingDirectories[0]).not.toBe(tmp.path)
        expect(await fs.stat(workingDirectories[0]).catch(() => null)).toBeNull()
      },
    })
  })

  test("parallel write-capable tasks merge independent owned paths from isolated worktrees", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workingDirectories = new Set<string>()
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
          const sessionId = `ses_${isQA ? "qa" : "task"}_${Math.random().toString(36).slice(2, 8)}`
          await args.onSession?.({ sessionId, isNewSession: true })
          if (isQA) {
            return {
              sessionId,
              isNewSession: true,
              output: "Independent verification complete.",
              parts: [],
              structuredOutput: { verdict: "passed", summary: "Independent verification complete.", findings: [] },
            }
          }
          workingDirectories.add(args.workingDirectory)
          const file = args.description.includes("left") ? "src/auth-left.ts" : "src/auth-right.ts"
          await fs.mkdir(path.dirname(path.join(args.workingDirectory, file)), { recursive: true })
          await fs.writeFile(path.join(args.workingDirectory, file), `export const side = "${file}"\n`)
          return { sessionId, isNewSession: true, output: `Implemented ${file}`, parts: [] }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})
        const planned = await instance.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [
              {
                id: "left",
                prompt: "Implement the left auth helper",
                category: "coding",
                agent: "explore",
                owns: ["src/auth-left.ts"],
              },
              {
                id: "right",
                prompt: "Implement the right auth helper",
                category: "coding",
                agent: "explore",
                owns: ["src/auth-right.ts"],
              },
            ],
          },
          ctx,
        )
        const result = await instance.execute(
          { action: "workflow", workflow_action: "execute", workflowId: planned.metadata?.workflowId },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        expect(workingDirectories.size).toBe(2)
        expect(await fs.readFile(path.join(tmp.path, "src/auth-left.ts"), "utf8")).toContain("auth-left")
        expect(await fs.readFile(path.join(tmp.path, "src/auth-right.ts"), "utf8")).toContain("auth-right")
        for (const directory of workingDirectories) {
          expect(await fs.stat(directory).catch(() => null)).toBeNull()
        }
      },
    })
  })

  test("active in-process sessions reject steer with a controlled capability error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const child = await Session.create({ parentID: session.id, title: "Active child" })
        statusMock.mockImplementation((sessionId: string) => ({
          sessionId,
          runtime: "atom-inprocess",
          status: "running",
          startedAt: 100,
          updatedAt: 200,
        }))
        const instance = await AgentTool.init({})

        expect(
          instance.execute(
            {
              action: "steer",
              session_id: child.id,
              subagent_type: "explore",
              prompt: "Change direction",
              description: "Steer child",
            },
            mockCtx(session.id, messageID),
          ),
        ).rejects.toThrow("cannot steer an active turn")
      },
    })
  })

  test("revive continues the owned child session instead of creating a replacement", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const child = await Session.create({ parentID: session.id, title: "Revive child" })
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "revive",
            session_id: child.id,
            subagent_type: "explore",
            prompt: "Continue the previous investigation",
            description: "Revive investigation",
          },
          mockCtx(session.id, messageID),
        )

        expect(result.metadata?.status).toBe("completed")
        const taskSpawn = spawnMock.mock.calls
          .map(([args]) => args as any)
          .find((args) => !args.description?.startsWith("[QA"))
        expect(taskSpawn?.sessionId).toBe(child.id)
      },
    })
  })

  test("deleting a running child session does not resurrect it through retries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskSpawnCount = 0
        let reviewerSpawnCount = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
          if (isQA) {
            reviewerSpawnCount++
            return {
              sessionId: "ses_qa_unused",
              isNewSession: true,
              output: "Independent verification complete.",
              parts: [],
              structuredOutput: { verdict: "passed", summary: "Independent verification complete.", findings: [] },
            }
          }

          taskSpawnCount++
          await args.onSession?.({ sessionId: "ses_deleted_child", isNewSession: true })
          // The real server abort route records this in the same worker isolate
          // before SessionPrompt.cancel wakes the orchestrator.
          SessionTermination.mark("ses_deleted_child")
          // SessionPrompt can resolve normally with a partial assistant message
          // after abort; the marker still has to suppress QA and retry.
          return {
            sessionId: "ses_deleted_child",
            isNewSession: true,
            output: "Partial output produced before cancellation",
            parts: [],
          }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Keep analyzing until stopped",
            description: "Cancelable analysis",
          },
          mockCtx(session.id, messageID),
        )

        expect(taskSpawnCount).toBe(1)
        expect(reviewerSpawnCount).toBe(0)
        expect(result.metadata?.status).toBe("failed")
        expect(result.output).toContain("1 failed")

        const repeated = await instance.execute(
          {
            action: "workflow",
            workflow_action: "execute",
            workflowId: result.metadata?.workflowId,
          },
          mockCtx(session.id, messageID),
        )
        expect(repeated.metadata?.status).toBe("failed")
        expect(repeated.metadata?.error).toBe(true)
      },
    })
  })

  test("deleting a running reviewer session does not recreate the reviewer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskSpawnCount = 0
        let reviewerSpawnCount = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = typeof args.description === "string" && args.description.startsWith("[QA")
          if (!isQA) {
            taskSpawnCount++
            await args.onSession?.({ sessionId: "ses_task_under_review", isNewSession: true })
            HarnessState.addEditedFile("ses_task_under_review", "src/auth/token.ts")
            return {
              sessionId: "ses_task_under_review",
              isNewSession: true,
              output: "Task output awaiting review",
              parts: [],
            }
          }

          reviewerSpawnCount++
          await args.onSession?.({ sessionId: "ses_deleted_reviewer", isNewSession: true })
          SessionTermination.mark("ses_deleted_reviewer")
          // A streamed result may survive cancellation and resolve normally;
          // termination must win over that stale result.
          return {
            sessionId: "ses_deleted_reviewer",
            isNewSession: true,
            output: "Partial result before cancellation",
            parts: [],
            structuredOutput: { verdict: "passed", summary: "Partial result before cancellation.", findings: [] },
          }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Implement a function and fix the code bug, then submit it for review",
            description: "Cancelable reviewer",
          },
          mockCtx(session.id, messageID),
        )

        expect(taskSpawnCount).toBe(1)
        expect(reviewerSpawnCount).toBe(2)
        expect(result.metadata?.status).toBe("failed")
      },
    })
  })

  test("passes rejected QA findings to the worker retry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskRuns = 0
        let qaRuns = 0
        let retryPrompt = ""
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = args.description.startsWith("[QA")
          const sessionId = args.sessionId ?? `ses_${isQA ? "qa" : "task"}`
          await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
          if (isQA) {
            qaRuns++
            if (qaRuns === 1) {
              return {
                sessionId,
                output: "Rejected.",
                parts: [],
                structuredOutput: {
                  verdict: "rejected",
                  summary: "Unsafe token remains.",
                  findings: [
                    {
                      file: "src/auth/token.ts",
                      startLine: 1,
                      endLine: 1,
                      severity: "P1",
                      confidence: 1,
                      title: "Unsafe token",
                      evidence: 'export const token = "unsafe"',
                      recommendation: "Use a safe value.",
                    },
                  ],
                },
              }
            }
            return {
              sessionId,
              output: "Passed.",
              parts: [],
              structuredOutput: { verdict: "passed", summary: "Fixed.", findings: [] },
            }
          }
          taskRuns++
          retryPrompt = args.parts.map((part: any) => part.text ?? "").join("\n")
          await fs.mkdir(path.join(args.workingDirectory, "src/auth"), { recursive: true })
          await fs.writeFile(
            path.join(args.workingDirectory, "src/auth/token.ts"),
            `export const token = "${taskRuns === 1 ? "unsafe" : "safe"}"\n`,
          )
          return { sessionId, output: "Implemented token.", parts: [] }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Implement the authentication token helper",
            description: "Implement token",
          },
          mockCtx(session.id, messageID),
        )

        expect(result.metadata?.status).toBe("completed")
        expect(taskRuns).toBe(2)
        expect(qaRuns).toBe(4)
        expect(retryPrompt).toContain("Unsafe token remains")
      },
    })
  })

  test("retries malformed reviewer output without rerunning the worker", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let taskRuns = 0
        let qaRuns = 0
        const signals: AbortSignal[] = []
        spawnMock.mockImplementation(async (args: any) => {
          signals.push(args.signal)
          const isQA = args.description.startsWith("[QA")
          const sessionId = args.sessionId ?? `ses_${isQA ? "qa" : "task"}`
          await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
          if (isQA) {
            qaRuns++
            if (qaRuns === 1) {
              throw new SubAgentRuntime.OutputValidationError({
                code: "OUTPUT_MISSING",
                message: "missing structured output",
                issues: [],
              })
            }
            return {
              sessionId,
              output: "Passed.",
              parts: [],
              structuredOutput: { verdict: "passed", summary: "Verified.", findings: [] },
            }
          }
          taskRuns++
          await fs.mkdir(path.join(args.workingDirectory, "src/auth"), { recursive: true })
          await fs.writeFile(path.join(args.workingDirectory, "src/auth/token.ts"), 'export const token = "safe"\n')
          return { sessionId, output: "Implemented token.", parts: [] }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const ctx = mockCtx(session.id, messageID)
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Implement the authentication token helper",
            description: "Implement token",
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        expect(taskRuns).toBe(1)
        expect(qaRuns).toBe(4)
        expect(signals.every((signal) => signal === ctx.abort)).toBe(true)
      },
    })
  })

  test("uses configured reviewer count and review attempt limit for task QA", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.writeFile(
          path.join(tmp.path, "atomcli.json"),
          JSON.stringify({ review: { enabled: true, policy: "always", reviewer_count: 3, max_attempts: 1 } }),
        )
        await Config.clearCache()
        let taskRuns = 0
        let qaRuns = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = args.description.startsWith("[QA")
          const sessionId = args.sessionId ?? `ses_${isQA ? `qa_${qaRuns}` : "task"}`
          await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
          if (isQA) {
            qaRuns++
            return {
              sessionId,
              output: "Rejected.",
              parts: [],
              structuredOutput: {
                verdict: "rejected",
                summary: "Unsafe token remains.",
                findings: [
                  {
                    file: "src/auth/token.ts",
                    startLine: 1,
                    endLine: 1,
                    severity: "P1",
                    confidence: 1,
                    title: "Unsafe token",
                    evidence: 'export const token = "unsafe"',
                    recommendation: "Use a safe value.",
                  },
                ],
              },
            }
          }
          taskRuns++
          await fs.mkdir(path.join(args.workingDirectory, "src/auth"), { recursive: true })
          await fs.writeFile(path.join(args.workingDirectory, "src/auth/token.ts"), 'export const token = "unsafe"\n')
          return { sessionId, output: "Implemented token.", parts: [] }
        })

        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Implement the authentication token helper",
            description: "Configured QA",
          },
          mockCtx(session.id, messageID),
        )

        expect(result.metadata?.status).toBe("failed")
        expect(taskRuns).toBe(1)
        expect(qaRuns).toBe(3)
      },
    })
  })
})
