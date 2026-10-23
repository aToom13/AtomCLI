import { describe, expect, test, mock, beforeEach, afterAll, spyOn } from "bun:test"
import "../preload"
import fs from "fs/promises"
import path from "path"
import { SubAgent } from "@/integrations/tool/subagent"

const completedTaskOutput = (text: string) =>
  `${text}\n<agent_result>{"status":"complete","summary":"${text}","failures":[]}</agent_result>`

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

const capabilities = SubAgent.capabilities
const subagentSpies = [
  spyOn(SubAgent, "spawn").mockImplementation(spawnMock),
  spyOn(SubAgent, "status").mockImplementation(statusMock),
  spyOn(SubAgent, "wait").mockImplementation(waitMock),
  spyOn(SubAgent, "cancel").mockImplementation(cancelMock),
  spyOn(SubAgent, "capabilities").mockImplementation((runtime) => ({
    ...capabilities(runtime),
    wait: true,
    status: true,
    revive: true,
    steer: false,
  })),
  spyOn(SubAgent, "buildFromAgent").mockImplementation((agent: any) => [
    ...(agent.permission ?? []),
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
  ]),
  spyOn(SubAgent, "buildPermissions").mockImplementation((parent: any[]) => [
    ...parent,
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
  ]),
]
afterAll(() => {
  for (const spy of subagentSpies) spy.mockRestore()
})

const { AgentTool } = await import("@/integrations/tool/agent-tool")
const { OrchestrateTool } = await import("@/integrations/tool/orchestrate")
const { abortWorkflow } = await import("@/integrations/tool/orchestrate/actions")
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
const { WorkflowFS } = await import("@/integrations/tool/workflow-fs")
const { WorkflowStateStore } = await import("@/integrations/tool/orchestrate/state")
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
  test("explicit reviewer spawn runs exactly one reviewer without nested QA", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const tool = await AgentTool.init()
        const result = await tool.execute(
          {
            action: "spawn",
            subagent_type: "reviewer",
            description: "Independent review",
            prompt: "Inspect changes and test results independently",
          },
          mockCtx(session.id, messageID),
        )
        expect(result.metadata.status).toBe("completed")
        expect(spawnMock).toHaveBeenCalledTimes(1)
        expect(spawnMock.mock.calls[0][0].agent.name).toBe("reviewer")
        expect(HarnessState.getReviewVerdict(session.id)).toBeUndefined()
      },
    })
  })

  test("permission denial terminalizes one-call workflow instead of leaking a planned slot", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = {
          ...mockCtx(session.id, messageID),
          extra: {},
          ask: async () => {
            throw new Error("denied")
          },
        }
        await expect((await OrchestrateTool.init()).execute({ request: "Inspect files" }, ctx)).rejects.toThrow(
          "denied",
        )
        const workflows = WorkflowStateStore.entries()
        expect(workflows.at(-1)?.[1]).toMatchObject({ status: "failed" })
      },
    })
  })

  test("abort during permission prompt never dispatches a child", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const ctx = {
          ...mockCtx(session.id, messageID),
          extra: {},
          ask: async () => {
            const [id] = WorkflowStateStore.entries().at(-1)!
            expect((await abortWorkflow({ workflowId: id }, session.id)).metadata.error).toBe(false)
          },
        }
        const result = await (await OrchestrateTool.init()).execute({ request: "Inspect files" }, ctx)
        expect(result.metadata?.status).toBe("failed")
        expect(spawnMock).not.toHaveBeenCalled()
      },
    })
  })

  test("one-call orchestration accepts plain request and checks task permission", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const permissions: string[] = []
        const ctx = {
          ...mockCtx(session.id, messageID),
          extra: {},
          ask: async (request: { patterns: string[] }) => {
            permissions.push(...request.patterns)
          },
        }
        const result = await (await OrchestrateTool.init()).execute({ request: "Analyze codebase structure" }, ctx)
        expect(result.metadata?.status).toBe("completed")
        expect(permissions).toEqual(["explore"])
        expect(spawnMock).toHaveBeenCalledTimes(1)
      },
    })
  })

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

  test.each(["missing", "incomplete", "complete"])(
    "owned coding result is validated even without edits: %s",
    async (status) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spawnMock.mockImplementation(async (args: any) => {
            const sessionId = args.sessionId ?? "ses_unchanged_coder"
            await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
            return {
              sessionId,
              parts: [],
              output:
                status === "missing"
                  ? "Not complete. index.html unchanged; patch failed; no verification ran."
                  : `<agent_result>${JSON.stringify({ status, summary: "No edits", failures: status === "complete" ? [] : ["Patch failed; gameplay unverified"] })}</agent_result>`,
            }
          })
          const { session, messageID } = await createAssistantMessageContext()
          const result = await (
            await AgentTool.init({})
          ).execute(
            {
              action: "spawn",
              subagent_type: "coder",
              prompt: "Repair index.html",
              description: "Repair game",
              owns: ["index.html"],
              isolation: "auto",
              validationMode: "strict",
            },
            mockCtx(session.id, messageID),
          )
          expect(result.metadata.status).toBe(status === "complete" ? "completed" : "failed")
          expect(result.output).toContain(status === "complete" ? "1 succeeded" : "0 succeeded")
        },
      })
    },
  )

  test.each(["complete", "incomplete"])("reviewer %s report returns product findings once", async (status) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let prompt = ""
        spawnMock.mockImplementation(async (args: any) => {
          prompt = args.parts.map((part: { text?: string }) => part.text ?? "").join("\n")
          await args.onSession?.({ sessionId: "ses_review_findings", isNewSession: true })
          return {
            sessionId: "ses_review_findings",
            parts: [],
            output: `<agent_result>${JSON.stringify({ status, productVerdict: "rejected", summary: "Inspection done; product fails", findings: ["3D interaction missing"], failures: status === "complete" ? [] : ["3D interaction missing"] })}</agent_result>`,
          }
        })
        const { session, messageID } = await createAssistantMessageContext()
        const result = await (
          await AgentTool.init({})
        ).execute(
          {
            action: "spawn",
            subagent_type: "reviewer",
            prompt: "Review two functional 3D games",
            description: "Review games",
          },
          mockCtx(session.id, messageID),
        )
        expect(spawnMock).toHaveBeenCalledTimes(1)
        expect(prompt).toContain("status describes whether the inspection is finished")
        expect(result.output).toContain("3D interaction missing")
        expect(result.output).toContain("rejected")
        expect(result.metadata.status).toBe(status === "complete" ? "completed" : "failed")
      },
    })
  })

  test("failed workflow archive write reports error without rerunning completed worker", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const write = spyOn(WorkflowFS, "writeSuccess").mockRejectedValue(new Error("disk full"))
        try {
          const { session, messageID } = await createAssistantMessageContext()
          const instance = await AgentTool.init({})
          const result = await instance.execute(
            { action: "spawn", subagent_type: "explore", prompt: "Inspect files", description: "Inspect files" },
            mockCtx(session.id, messageID),
          )
          expect(result.metadata?.status).toBe("completed")
          expect(result.output).toContain("Workflow output persistence failed: disk full")
          expect(spawnMock).toHaveBeenCalledTimes(1)
        } finally {
          write.mockRestore()
        }
      },
    })
  })

  test("retries an edited task that reports failed syntax before marking workflow complete", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let runs = 0
        let retryPrompt = ""
        spawnMock.mockImplementation(async (args: any) => {
          runs++
          const sessionId = args.sessionId ?? "ses_syntax_worker"
          await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
          HarnessState.addEditedFile(sessionId, path.join(tmp.path, "index.html"))
          retryPrompt = args.parts.map((part: { text?: string }) => part.text ?? "").join("\n")
          return {
            sessionId,
            output:
              runs === 1
                ? '<agent_result>{"status":"incomplete","summary":"Not ready","failures":["SyntaxError: Unexpected token ]"]}</agent_result>'
                : completedTaskOutput("Syntax fixed"),
            parts: [],
          }
        })
        const { session, messageID } = await createAssistantMessageContext()
        const instance = await AgentTool.init({})
        const result = await instance.execute(
          { action: "spawn", subagent_type: "coder", prompt: "Build browser app", description: "Browser app" },
          mockCtx(session.id, messageID),
        )
        expect(result.metadata?.status).toBe("completed")
        expect(runs).toBe(2)
        expect(retryPrompt).toContain("SyntaxError: Unexpected token ]")
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
        const child = await Session.create({ parentID: session.id })
        const ctx = mockCtx(session.id, messageID)
        const instance = await AgentTool.init({})

        const result = await instance.execute(
          {
            action: "spawn",
            subagent_type: "explore",
            prompt: "Analyze the codebase structure",
            description: "Analyze codebase",
            session_id: child.id,
          },
          ctx,
        )

        expect(result.metadata?.status).toBe("completed")
        const spawnArgs = spawnMock.mock.calls.map(([args]) => args as any)
        const taskSpawn = spawnArgs.find((a) => a.description && !a.description.startsWith("[QA"))
        expect(taskSpawn?.sessionId).toBe(child.id)
      },
    })
  })

  test("spawn rejects missing and foreign continuation sessions before dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, messageID } = await createAssistantMessageContext()
        const other = await Session.create({})
        const foreign = await Session.create({ parentID: other.id })
        const instance = await AgentTool.init({})
        for (const session_id of [session.id, foreign.id, "ses_missing_continuation"]) {
          await expect(
            instance.execute(
              {
                action: "spawn",
                subagent_type: "explore",
                prompt: "Continue",
                description: "Continue analysis",
                session_id,
              },
              mockCtx(session.id, messageID),
            ),
          ).rejects.toMatchObject({ applied: false })
        }
        expect(spawnMock).not.toHaveBeenCalled()
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
          return { sessionId, isNewSession: true, output: completedTaskOutput(`Implemented ${file}`), parts: [] }
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
        await fs.writeFile(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
        await Config.clearCache()
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
        await fs.writeFile(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
        await Config.clearCache()
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
              output: completedTaskOutput("Task output awaiting review"),
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
        expect(reviewerSpawnCount).toBe(1)
        expect(result.metadata?.status).toBe("failed")
      },
    })
  })

  test("passes rejected QA findings to the worker retry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.writeFile(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
        await Config.clearCache()
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
          return { sessionId, output: completedTaskOutput("Implemented token."), parts: [] }
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
        expect(qaRuns).toBe(2)
        expect(retryPrompt).toContain("Unsafe token remains")
      },
    })
  })

  test.each([false, true])("rejected QA repeats only with new evidence: %s", async (newEvidence) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
        await Config.clearCache()
        let taskRuns = 0
        let qaRuns = 0
        spawnMock.mockImplementation(async (args: any) => {
          const isQA = args.description.startsWith("[QA")
          const sessionId = args.sessionId ?? `ses_${isQA ? "qa" : "worker"}_unchanged`
          await args.onSession?.({ sessionId, isNewSession: !args.sessionId })
          if (isQA) {
            qaRuns++
            return {
              sessionId,
              parts: [],
              output: "Review done",
              structuredOutput:
                qaRuns === 1
                  ? {
                      verdict: "rejected",
                      summary: "Verification missing",
                      findings: [
                        {
                          file: "src/auth/token.ts",
                          startLine: 1,
                          endLine: 1,
                          severity: "P1",
                          confidence: 1,
                          title: "Verification missing",
                          evidence: 'export const token = "test-value"',
                          recommendation: "Verify token behavior",
                        },
                      ],
                    }
                  : { verdict: "passed", summary: "Verified", findings: [] },
            }
          }
          taskRuns++
          await fs.mkdir(path.join(args.workingDirectory, "src/auth"), { recursive: true })
          await Bun.write(path.join(args.workingDirectory, "src/auth/token.ts"), 'export const token = "test-value"\n')
          if (newEvidence && taskRuns > 1) {
            await Instance.provide({
              directory: args.workingDirectory,
              sessionDirectory: Instance.sessionDirectory,
              fn: async () => {
                HarnessState.pushExecutionLog(sessionId, {
                  command: "bun test token.test.ts",
                  output: "1 pass; token behavior verified",
                  exitCode: 0,
                })
              },
            })
          }
          return { sessionId, output: completedTaskOutput("Implemented token"), parts: [] }
        })
        const { session, messageID } = await createAssistantMessageContext()
        const result = await (
          await AgentTool.init({})
        ).execute(
          { action: "spawn", subagent_type: "coder", prompt: "Implement token helper", description: "Token helper" },
          mockCtx(session.id, messageID),
        )
        expect(taskRuns).toBe(2)
        expect(qaRuns).toBe(newEvidence ? 2 : 1)
        expect(result.metadata.status).toBe(newEvidence ? "completed" : "failed")
        if (!newEvidence) expect(result.output).toContain("No new workspace or verification evidence")
      },
    })
  })

  test("incomplete optional QA stays separate without rerunning the worker", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await fs.writeFile(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
        await Config.clearCache()
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
          return { sessionId, output: completedTaskOutput("Implemented token."), parts: [] }
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
        expect(qaRuns).toBe(1)
        expect(result.output).toContain("Independent Review:")
        expect(result.output).toContain("inconclusive")
        expect(WorkflowStateStore.get(result.metadata.workflowId)?.results.implement_token.review?.status).toBe(
          "inconclusive",
        )
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
          JSON.stringify({
            review: { auto: true, enabled: true, policy: "always", reviewer_count: 3, max_attempts: 1 },
          }),
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
          return { sessionId, output: completedTaskOutput("Implemented token."), parts: [] }
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
