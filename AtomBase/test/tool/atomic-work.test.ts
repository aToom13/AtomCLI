import "../preload"
import { expect, setDefaultTimeout, spyOn, test } from "bun:test"
import path from "path"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { runAutomaticTaskChecks } from "@/core/execution/task-verification"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { TaskTool } from "@/integrations/tool/task"
import { SubAgent } from "@/integrations/tool/subagent"
import { AtomicWork } from "@/integrations/tool/atomic-work"
import { TaskDispatch } from "@/integrations/tool/task-dispatch"
import { Command } from "@/interfaces/command"
import { command } from "@/core/session/prompt/command"
import { Provider } from "@/integrations/provider/provider"
import { Skill } from "@/integrations/skill"
import { Agent } from "@/integrations/agent/agent"
import { ToolRegistry } from "@/integrations/tool/registry"
import { WorkflowStateStore } from "@/integrations/tool/orchestrate/state"
import { WorkflowStore } from "@/core/orchestration/workflow-store"
import { ConfigMarkdown } from "@/core/config/markdown"
import { SessionPrompt } from "@/core/session/prompt"
import { tmpdir } from "../fixture/fixture"
import { ReviewV2 } from "@/core/verification/review-v2"
import { ProviderTransform } from "@/integrations/provider/transform"
import { TaskFlow, TaskFlowTool } from "@/integrations/tool/taskflow"
import { ToolRuntime } from "@/integrations/tool/runtime"
import z from "zod"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { OrchestrateTool } from "@/integrations/tool/orchestrate"
import { Config } from "@/core/config/config"
import { PermissionNext } from "@/util/permission/next"

// Bun 1.3.14 resets the preload's timeout between files; these workflows spawn real Git and test processes.
setDefaultTimeout(10_000)

const reviewOptIn = Config.Info.parse({ review: { auto: true } })

const automatic = [
  { id: "check", description: "Command succeeds", verification: "automatic" as const, command: "true" },
]
async function runtimeEvidence(sessionID: string, criterion: string, state: unknown, assertion: string) {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "acceptance.test.ts")
  await Bun.write(
    file,
    `import { test, expect } from "bun:test"\nconst state = ${JSON.stringify(state)}\ntest("acceptance fixture", () => { ${assertion} })\n`,
  )
  const start = Date.now()
  const process = Bun.spawn(["bun", "test", file], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  expect(exit).toBe(0)
  const output = stdout + stderr
  const messageID = Identifier.ascending("message")
  await Storage.write(["message", sessionID, messageID], {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: "msg_fixture",
    agent: "reviewer",
    providerID: "atomcli",
    modelID: "hy3-free",
    time: { created: start },
  })
  const input = { command: `bun test ${file}`, description: "Check current fixture state" }
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID,
    type: "tool",
    tool: "bash",
    callID: "runtime-check",
    state: {
      status: "completed",
      title: "Acceptance fixture",
      input,
      output,
      metadata: { exit },
      time: { start, end: Date.now() },
    },
  })
  return {
    criterion,
    setup: "Read current fixture state",
    action: "Execute fixture assertions",
    expected: "Fixture assertions pass",
    observed: "1 pass",
    evidence: [{ tool: "bash" as const, input: JSON.stringify(input), output: "1 pass" }],
  }
}
function globalReviews(ctx: Awaited<ReturnType<typeof setup>>["ctx"], worker: typeof SubAgent.spawn) {
  return async (config: SubAgent.SpawnConfig): Promise<SubAgent.SpawnResult> => {
    if (config.agent.name !== "reviewer" || !config.description.startsWith("Acceptance review: atomic_"))
      return worker(config)
    const tasks = ExecutionRuntime.tasks(ctx.extra.execution.executionID)
    const root = tasks.find((task) => task.atomic)!
    expect(config.parts[0]).toMatchObject({ text: expect.stringContaining(root.goal) })
    const reviewer = await Session.create({ parentID: ctx.sessionID })
    const bound = await ExecutionRuntime.resolveInvocation({
      sessionID: reviewer.id,
      invocationID: Identifier.ascending("message"),
      kind: "reviewer",
    })
    const checks = await Promise.all(
      root.acceptance
        .filter((item) => item.verification === "reviewer")
        .map(async (criterion) => ({
          criterionID: criterion.id,
          passed: true,
          evidence: "Integration fixture assertions",
          runtime: await runtimeEvidence(
            reviewer.id,
            criterion.description,
            {
              root,
              children: tasks.filter((task) => task.parentTaskID === root.id),
            },
            'expect(["submitted", "verifying"]).toContain(state.root.status); expect(state.children.length).toBeGreaterThan(0); expect(state.children.every(task => task.status === "accepted")).toBe(true)',
          ),
        })),
    )
    ExecutionRuntime.finishInvocation(bound, "completed")
    return {
      sessionId: reviewer.id,
      isNewSession: true,
      parts: [],
      output: "Integration fixture verified",
      structuredOutput: { checks },
    }
  }
}
async function setup() {
  const parent = await Session.create({})
  const child = await Session.create({ parentID: parent.id })
  const userID = Identifier.ascending("message")
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userID,
    sessionID: parent.id,
    role: "user",
    agent: "build",
    model: { providerID: "atomcli", modelID: "hy3-free" },
    time: { created: Date.now() },
  })
  await Storage.write(["message", parent.id, messageID], {
    id: messageID,
    sessionID: parent.id,
    parentID: userID,
    role: "assistant",
    agent: "build",
    modelID: "hy3-free",
    providerID: "atomcli",
    time: { created: Date.now() },
  })
  const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: userID })
  const ctx = {
    sessionID: parent.id,
    messageID,
    agent: "build",
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
    extra: { execution, bypassAgentCheck: true },
  }
  const root = await ExecutionRuntime.startAtomicWork({
    sessionID: parent.id,
    execution,
    messageID: userID,
    goal: "Inspect feature",
    agent: "build",
  })
  return { parent, child, ctx, root, execution, tool: await TaskTool.init() }
}

test.each(["reject", "deny", "feedback"])(
  "advisory Atomic plan permits faithful recovery after review denial: %s",
  async (denial) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { tool, ctx: baseContext, root, execution } = await setup()
        const ctx = {
          ...baseContext,
          ask: async (request: any) => {
            expect(request.permission).toBe("review.require")
            asked++
            if (denial === "deny") throw new PermissionNext.DeniedError([])
            if (denial === "feedback") throw new PermissionNext.CorrectedError("No optional review")
            throw new PermissionNext.RejectedError()
          },
        }
        let asked = 0
        const denied = await tool.execute(
          {
            action: "plan",
            tasks: [{ id: "worker", prompt: "Inspect fixture", acceptance: automatic }],
            acceptance: [{ id: "audit", description: "Independent behavior check", verification: "reviewer" }],
          },
          ctx,
        )
        expect(denied.output).toContain("Do not repeat")
        expect(denied.output).toContain("never downgrade")
        expect(asked).toBe(1)
        expect(ExecutionRuntime.atomicRoot(execution.executionID)?.version).toBe(root.version)
        expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(1)
        const recovered = await tool.execute(
          {
            action: "plan",
            tasks: [{ id: "worker", prompt: "Inspect fixture", acceptance: automatic }],
            acceptance: automatic,
          },
          ctx,
        )
        expect(recovered.metadata.error).toBe(false)
        expect(asked).toBe(1)
        ExecutionRuntime.cancelExecution(execution)
      },
    })
  },
)

test("action-specific schema rejects mixed initial payload, preserves default run, and recovers without fallback", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, root, execution } = await setup()
      const plan = {
        action: "plan" as const,
        acceptance: automatic,
        tasks: [{ id: "worker", prompt: "Inspect fixture", acceptance: automatic }],
      }
      expect(
        tool.parameters.parse({ description: "Inspect", prompt: "Inspect fixture", subagent_type: "general" }).action,
      ).toBe("run")
      const mixed = {
        ...plan,
        definition: {},
        task_id: "browser-os",
        amendment: { messageID: "fake", classification: "amendment", evidence: "placeholder" },
        checks: [],
      }
      const agent = await AgentTool.init()
      expect(agent.parameters.safeParse(mixed).success).toBe(false)
      expect(
        ProviderTransform.schema(
          { providerID: "openai", api: { id: "test" } } as any,
          z.toJSONSchema(agent.parameters) as any,
        ).type,
      ).toBe("object")
      await expect(tool.execute(mixed, ctx)).rejects.toThrow("invalid arguments")
      await expect(
        AtomicWork.action({ ...plan, tasks: AtomicWork.Tasks.parse(plan.tasks), definition: {} }, ctx),
      ).rejects.toThrow("initial plan accepts only")
      expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(1)
      expect(ExecutionRuntime.atomicRoot(execution.executionID)?.atomic?.planned).toBe(false)
      await expect(
        tool.execute({ action: "revise", expectedVersion: root.version, tasks: plan.tasks }, ctx),
      ).rejects.toThrow("no plan to revise")
      const spawn = spyOn(SubAgent, "spawn")
      spawn.mockClear()
      try {
        await expect(
          tool.execute(
            {
              action: "run",
              task_id: "browser-os",
              description: "Fallback",
              prompt: "Build",
              subagent_type: "general",
            },
            ctx,
          ),
        ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
        expect(spawn).not.toHaveBeenCalled()
        for (const action of ["spawn", "workflow", "steer", "revive"] as const)
          await expect(
            (await AgentTool.init()).execute({ action, subagent_type: "general", prompt: "Fallback" }, ctx),
          ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
        await expect(
          (await OrchestrateTool.init()).execute({ action: "run", request: "Fallback" }, ctx),
        ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
        const flow = await TaskFlowTool.init()
        await expect(
          flow.execute({ action: "start", plan: [{ id: "foundation", name: "Build" }] }, ctx),
        ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
        const activation = spyOn(TaskFlow, "activateForWork")
        try {
          await ToolRuntime.execute({
            tool: "read",
            args: {},
            context: ctx,
            mutating: false,
            execute: async () => ({ title: "Fixture", output: "Empty workspace", metadata: {} }),
          })
          expect(activation).not.toHaveBeenCalled()
        } finally {
          activation.mockRestore()
        }
        await tool.execute(plan, ctx)
        expect(ExecutionRuntime.atomicRoot(execution.executionID)?.atomic?.planned).toBe(true)
        expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)?.goal).toBe(
          "Inspect feature",
        )
        await expect(tool.execute(plan, ctx)).rejects.toThrow("already planned")
        const schema = ProviderTransform.schema(
          { providerID: "9route", api: { id: "cx/gpt-6-luna", npm: "@ai-sdk/openai-compatible" } } as never,
          z.toJSONSchema(tool.parameters),
        ) as any
        const branch = (schema.oneOf ?? schema.anyOf).find((item: any) => item.properties?.action?.const === "plan")
        expect(branch.required).toEqual(expect.arrayContaining(["action", "tasks", "acceptance"]))
        expect(branch.properties.definition).toBeUndefined()
        expect(branch.additionalProperties).toBe(false)
        expect((await flow.execute({ action: "checkpoint" }, ctx)).metadata.status).toBe("checkpoint")
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("reviewer/parent commands are invalid; runtime evidence rejects grep, no-op, forged and stale calls", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, execution } = await setup()
      await expect(
        tool.execute(
          {
            action: "plan",
            acceptance: automatic,
            tasks: [
              {
                id: "worker",
                prompt: "Build game",
                acceptance: [{ id: "game", description: "Game moves", verification: "reviewer", command: "true" }],
              },
            ],
          },
          ctx,
        ),
      ).rejects.toThrow("Only automatic acceptance")
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Inspect",
              acceptance: [{ id: "manual", description: "Parent inspects result", verification: "parent" }],
            },
          ],
        },
        ctx,
      )
      const task = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === "worker")!
      await ExecutionRuntime.transitionTask({
        sessionID: ctx.sessionID,
        execution,
        taskID: task.id,
        expectedVersion: task.version,
        status: "running",
      })
      const running = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === task.id)!
      await ExecutionRuntime.transitionTask({
        sessionID: ctx.sessionID,
        execution,
        taskID: task.id,
        expectedVersion: running.version,
        status: "submitted",
        evidence: "Inspection finished",
      })
      await expect(
        tool.execute(
          {
            action: "verify",
            task_id: task.id,
            checks: [{ criterionID: "manual", verifier: "parent", passed: true, evidence: "Claim" }],
          },
          ctx,
        ),
      ).rejects.toThrow("requires runtime evidence")
      const check = await runtimeEvidence(
        ctx.sessionID,
        "Parent inspects result",
        { status: "submitted" },
        'expect(state.status).toBe("submitted")',
      )
      const messages = await Session.messages({ sessionID: ctx.sessionID, excludePatches: true })
      expect(ReviewV2.validateAcceptanceCheck(check, messages, 0)).toBeUndefined()
      expect(ReviewV2.validateAcceptanceCheck(check, messages, Date.now() + 1)).toContain("current review")
      for (const command of ["grep 'GTA|city|drive' index.html", "true", "bun test --help"]) {
        const forged = { ...check, evidence: [{ ...check.evidence[0], input: JSON.stringify({ command }) }] }
        expect(ReviewV2.validateAcceptanceCheck(forged, messages, 0)).toContain("current review")
      }
      await tool.execute(
        {
          action: "verify",
          task_id: task.id,
          checks: [
            { criterionID: "manual", verifier: "parent", passed: true, evidence: "Fixture assertions", runtime: check },
          ],
        },
        ctx,
      )
      expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === task.id)?.status).toBe("accepted")
    },
  })
})

test("native command is discoverable, rejects blank goal and carries native metadata", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Command.list()).map((item) => item.name)).toContain("atomic-work")
      const model = spyOn(Provider, "getModel").mockResolvedValue({} as never)
      let goal: string | undefined
      const deps = {
        lastModel: async () => ({ providerID: "test", modelID: "fixture" }),
        resolvePromptParts: async () => [],
        prompt: async (input: any, native?: string) => {
          goal = native
          expect(input.parts[0].text).toBe("/atomic-work Add profile")
          return { info: { id: "msg_native" }, parts: [] } as never
        },
      }
      try {
        await expect(
          command({ sessionID: "ses_native", command: "atomic-work", arguments: "   " }, deps),
        ).rejects.toThrow("nonempty goal")
        await command(
          {
            sessionID: "ses_native",
            command: "atomic-work",
            arguments: "Add profile",
            agent: "build",
            model: "test/fixture",
          },
          deps,
        )
        expect(goal).toBe("Add profile")
        const ctx = {
          sessionID: "ses_native",
          messageID: "msg_native",
          agent: "build",
          abort: new AbortController().signal,
          metadata() {},
          async ask() {},
        }
        await expect(
          (await TaskTool.init()).execute(
            {
              action: "plan",
              acceptance: automatic,
              tasks: [{ id: "worker", prompt: "Inspect", acceptance: automatic }],
            },
            ctx,
          ),
        ).rejects.toThrow("root session execution")
        expect((await ToolRegistry.tools("atomcli", await Agent.get("build"))).map((tool) => tool.id)).not.toContain(
          "task",
        )
        expect(
          (await ToolRegistry.tools("atomcli", await Agent.get("build"), new Set(["agent", "task"]))).map(
            (tool) => tool.id,
          ),
        ).not.toContain("task")
      } finally {
        model.mockRestore()
      }
    },
  })
})

test("agent Atomic Work profile accepts parent runtime evidence without spawning reviewers", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { ctx, child, root, execution } = await setup()
      const tool = await AgentTool.init()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [{ id: "worker", prompt: "Inspect feature", acceptance: automatic }],
        },
        ctx,
      )
      const planned = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === root.id)!
      expect(planned.acceptance.find((criterion) => criterion.id === "atomic-global-1")?.verification).toBe("parent")
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
        expect(config.agent.name).not.toBe("reviewer")
        return { sessionId: child.id, isNewSession: false, parts: [], output: "Inspection finished" }
      })
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("resumable")
        await tool.execute(
          {
            action: "verify",
            task_id: root.id,
            checks: [
              {
                criterionID: "atomic-global-1",
                verifier: "parent",
                passed: true,
                evidence: "Current integration verified",
                runtime: await runtimeEvidence(
                  ctx.sessionID,
                  "Inspect feature",
                  ExecutionRuntime.tasks(execution.executionID),
                  'expect(state.find(task => task.id === "worker").status).toBe("accepted")',
                ),
              },
            ],
          },
          ctx,
        )
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("completed")
        expect(ExecutionRuntime.tasks(execution.executionID).every((task) => task.status === "accepted")).toBe(true)
        expect(spawn).toHaveBeenCalledTimes(2)
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("global goal survives revision; reviewer infrastructure failure retries through needs_revision", async () => {
  await using tmp = await tmpdir({ config: reviewOptIn })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, execution, root } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [{ id: "worker", prompt: "Inspect fixture", acceptance: automatic }],
        },
        ctx,
      )
      const planned = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
      await tool.execute(
        {
          action: "revise",
          task_id: root.id,
          expectedVersion: planned.version,
          definition: { goal: "Inspect feature plus follow up" },
        },
        ctx,
      )
      const revised = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
      expect(revised.atomic?.originalGoal).toBe("Inspect feature")
      expect(
        revised.acceptance.filter((item) => item.id.startsWith("atomic-global-")).map((item) => item.description),
      ).toEqual(["Inspect feature", "Inspect feature plus follow up"])
      let reviews = 0
      const run = globalReviews(ctx, async () => ({
        sessionId: child.id,
        isNewSession: false,
        parts: [],
        output: "Inspection finished",
      }))
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
        if (config.agent.name === "reviewer" && ++reviews === 1) throw new Error("Fixture reviewer transport failed")
        return run(config)
      })
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("completed")
        const accepted = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
        expect(accepted).toMatchObject({ status: "accepted", execution: { attempts: 2 } })
        expect(accepted.evidence.join("\n")).toContain(
          "Verification infrastructure failed: Fixture reviewer transport failed",
        )
        expect(accepted.evidence.join("\n")).not.toContain("task is not running")
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("amendment before initial plan is classified without entering task revision", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, root, execution } = await setup()
      await ExecutionRuntime.queueAtomicMessage({
        sessionID: ctx.sessionID,
        execution,
        messageID: "msg_before_plan",
        text: "Add avatar too",
      })
      const current = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
      await tool.execute(
        {
          action: "revise",
          expectedVersion: current.version,
          amendment: {
            messageID: "msg_before_plan",
            classification: "amendment",
            evidence: "Extend the initial objective before decomposition",
          },
        },
        ctx,
      )
      expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(1)
      const classified = ExecutionRuntime.tasks(execution.executionID)[0]
      expect(classified.atomic?.planned).toBe(false)
      expect(classified.atomic?.originalGoal).toBe("Inspect feature")
      expect(classified.goal).toContain("Add avatar too")
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [{ id: "avatar", prompt: "Inspect feature and add avatar", acceptance: automatic }],
        },
        ctx,
      )
      expect(ExecutionRuntime.atomicRoot(execution.executionID)?.atomic?.planned).toBe(true)
      expect(ExecutionRuntime.atomicPending(execution.executionID)).toBe(false)
      expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === "avatar")?.revision).toBe(1)
    },
  })
})

test("weak automatic plan cannot bypass final original-goal reviewer runtime evidence", async () => {
  await using tmp = await tmpdir({ config: reviewOptIn })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, root, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [{ id: "worker", prompt: "Inspect fixture", acceptance: automatic }],
        },
        ctx,
      )
      const planned = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
      await tool.execute(
        {
          action: "revise",
          task_id: root.id,
          expectedVersion: planned.version,
          definition: { execution: { ...planned.execution!, maxRetries: 0 } },
        },
        ctx,
      )
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
        if (config.agent.name !== "reviewer")
          return { sessionId: child.id, isNewSession: false, parts: [], output: "Inspection finished" }
        const reviewer = await Session.create({ parentID: ctx.sessionID })
        const bound = await ExecutionRuntime.resolveInvocation({
          sessionID: reviewer.id,
          invocationID: Identifier.ascending("message"),
          kind: "reviewer",
        })
        ExecutionRuntime.finishInvocation(bound, "completed")
        return {
          sessionId: reviewer.id,
          isNewSession: true,
          parts: [],
          output: "PASS",
          structuredOutput: { checks: [{ criterionID: "atomic-global-1", passed: true, evidence: "All done" }] },
        }
      })
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("failed")
        const failed = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === root.id)!
        expect(failed.status).toBe("needs_revision")
        expect(failed.checks.find((item) => item.criterionID === "atomic-global-1")).toMatchObject({
          passed: false,
          evidence: expect.stringContaining("runtime evidence"),
        })
        expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === "worker")?.status).toBe(
          "accepted",
        )
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test.each([false, true])(
  "ledger projects lost workflow; ownership and git=%s constrain parallel dispatch",
  async (git) => {
    await using tmp = await tmpdir({ git, config: reviewOptIn })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { tool, ctx, root, child, execution } = await setup()
        await tool.execute(
          {
            action: "plan",
            acceptance: automatic,
            tasks: [
              { id: "left", prompt: "Inspect left", agent: "coder", owns: ["left"], acceptance: automatic },
              { id: "right", prompt: "Inspect right", agent: "coder", owns: ["right"], acceptance: automatic },
            ],
          },
          ctx,
        )
        WorkflowStateStore.delete(root.atomic!.workflowID)
        await WorkflowStore.remove(root.atomic!.workflowID)
        let active = 0
        let maximum = 0
        const calls: string[] = []
        let releaseParallel!: () => void
        const parallelStarted = new Promise<void>((resolve) => {
          releaseParallel = resolve
        })
        const spawn = spyOn(SubAgent, "spawn").mockImplementation(
          globalReviews(ctx, async (config) => {
            calls.push(config.description)
            maximum = Math.max(maximum, ++active)
            expect(config.permissions.filter((rule) => rule.permission === "task").at(-1)?.action).toBe("deny")
            if (git && calls.length <= 2) {
              if (active === 2) releaseParallel()
              await parallelStarted
            }
            active--
            return { sessionId: child.id, output: "Inspection finished", isNewSession: false, parts: [] }
          }),
        )
        try {
          const result = await tool.execute({ action: "execute" }, ctx)
          expect(result.metadata.status, result.output).toBe("completed")
          expect(maximum).toBe(git ? 2 : 1)
          expect(calls).toHaveLength(3)
          expect(ExecutionRuntime.tasks(execution.executionID).every((task) => task.status === "accepted")).toBe(true)
        } finally {
          spawn.mockRestore()
        }
      },
    })
  },
)

test("parent criteria pause dependencies, automatic bypass is rejected, then integration executes", async () => {
  await using tmp = await tmpdir({ config: reviewOptIn })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, root, child, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Inspect feature",
              acceptance: [{ id: "manual", description: "Parent inspects result", verification: "parent" }],
            },
          ],
        },
        ctx,
      )
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(
        globalReviews(ctx, async () => ({
          sessionId: child.id,
          output: "Inspection finished",
          isNewSession: false,
          parts: [],
        })),
      )
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("resumable")
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")?.status).toBe(
          "verifying",
        )
        await tool.execute(
          {
            action: "verify",
            task_id: "worker",
            checks: [
              {
                criterionID: "manual",
                verifier: "parent",
                passed: true,
                evidence: "Inspected fixture behavior",
                runtime: await runtimeEvidence(
                  ctx.sessionID,
                  "Parent inspects result",
                  ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker"),
                  'expect(state.status).toBe("verifying"); expect(state.evidence).toContain("Inspection finished")',
                ),
              },
            ],
          },
          ctx,
        )
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("completed")
        expect(spawn).toHaveBeenCalledTimes(3)
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === root.id)?.status).toBe(
          "accepted",
        )
        await expect(
          tool.execute(
            {
              action: "run",
              task_id: "worker",
              description: "Bypass",
              prompt: "Inspect feature",
              subagent_type: "coder",
            },
            ctx,
          ),
        ).rejects.toThrow("agent(action='execute')")
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("amendment during worker discards stale isolated patch without ordinary failure", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, root, child, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [{ id: "worker", prompt: "Add avatar", owns: ["avatar.txt"], acceptance: automatic }],
        },
        ctx,
      )
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
        await Bun.write(path.join(config.workingDirectory!, "avatar.txt"), "stale")
        await ExecutionRuntime.queueAtomicMessage({
          sessionID: ctx.sessionID,
          execution,
          messageID: "msg_amend",
          text: "Use new avatar format",
        })
        return {
          sessionId: child.id,
          output: '<agent_result>{"status":"complete","failures":[]}</agent_result>',
          parts: [],
          isNewSession: false,
        }
      })
      try {
        const result = await tool.execute({ action: "execute" }, ctx)
        expect(result.metadata.status, result.output).toBe("resumable")
        expect(await Bun.file(path.join(tmp.path, "avatar.txt")).exists()).toBe(false)
        const worker = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")!
        expect(worker).toMatchObject({ status: "needs_revision", execution: { attempts: 0 } })
        const current = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === root.id)!
        await tool.execute(
          {
            action: "revise",
            expectedVersion: current.version,
            amendment: {
              messageID: "msg_amend",
              classification: "amendment",
              evidence: "Avatar implementation affected",
            },
            tasks: [
              {
                id: "worker",
                expectedVersion: worker.version,
                prompt: "Add new avatar format",
                owns: ["avatar.txt"],
                acceptance: automatic,
              },
            ],
          },
          ctx,
        )
        expect(ExecutionRuntime.atomicPending(execution.executionID)).toBe(false)
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")?.revision).toBe(
          worker.revision + 1,
        )
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("amendment racing initial task transition pauses without worker failure", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, execution } = await setup()
      await tool.execute(
        { action: "plan", acceptance: automatic, tasks: [{ id: "worker", prompt: "Inspect", acceptance: automatic }] },
        ctx,
      )
      const transition = ExecutionRuntime.transitionTask
      let queued = false
      const race = spyOn(ExecutionRuntime, "transitionTask").mockImplementation(async (input) => {
        if (!queued && input.status === "running") {
          queued = true
          await ExecutionRuntime.queueAtomicMessage({
            sessionID: ctx.sessionID,
            execution,
            messageID: "msg_race",
            text: "Change target",
          })
        }
        return transition(input)
      })
      const spawn = spyOn(SubAgent, "spawn")
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("resumable")
        expect(spawn).not.toHaveBeenCalled()
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")).toMatchObject({
          status: "pending",
          execution: { attempts: 0 },
        })
      } finally {
        race.mockRestore()
        spawn.mockRestore()
      }
    },
  })
})

test("retry budget persists and failed command evidence remains needs_revision", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Inspect feature",
              budget: { maxRetries: 0 },
              acceptance: [{ ...automatic[0], command: "false" }],
            },
          ],
        },
        ctx,
      )
      const spawn = spyOn(SubAgent, "spawn").mockResolvedValue({
        sessionId: child.id,
        output: "Inspection finished",
      } as never)
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("failed")
        const worker = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")!
        expect(worker).toMatchObject({
          status: "needs_revision",
          execution: { attempts: 1 },
          checks: [{ passed: false, verifierID: "harness" }],
        })
        WorkflowStateStore.delete(ExecutionRuntime.atomicRoot(execution.executionID)!.atomic!.workflowID)
        await tool.execute({ action: "execute" }, ctx)
        expect(spawn).toHaveBeenCalledTimes(1)
        await expect(
          tool.execute(
            {
              action: "verify",
              task_id: "worker",
              checks: [{ criterionID: "check", verifier: "automatic", passed: true, evidence: "Claim" }],
            },
            ctx,
          ),
        ).rejects.toThrow("harness")
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("failed automatic check retries worker and accepts new evidence", async () => {
  await using tmp = await tmpdir({ config: reviewOptIn })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Fix behavior",
              budget: { maxRetries: 1 },
              acceptance: [{ ...automatic[0], command: "test -f ready" }],
            },
          ],
        },
        ctx,
      )
      let attempts = 0
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(
        globalReviews(ctx, async (config) => {
          if (config.description.endsWith("worker") && ++attempts === 2)
            await Bun.write(path.join(tmp.path, "ready"), "verified")
          return { sessionId: child.id, output: "Behavior inspected", parts: [], isNewSession: false }
        }),
      )
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("completed")
        expect(attempts).toBe(2)
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")).toMatchObject({
          status: "accepted",
          execution: { attempts: 2 },
          checks: [{ passed: true, verifierID: "harness" }],
        })
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("unknown agent and skill, required isolation, and unread skill prevent dispatch", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, ".atomcli/skills/fixture-skill/SKILL.md"),
        "---\nname: fixture-skill\ndescription: Test instructions\n---\nRead required instructions completely.\n",
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, root } = await setup()
      for (const extra of [
        { agent: "unknown-fixture-agent" },
        { skills: ["unknown-fixture-skill"] },
        { isolation: "required" as const },
      ])
        await expect(
          tool.execute(
            {
              action: "plan",
              acceptance: automatic,
              tasks: [{ id: "worker", prompt: "Inspect feature", acceptance: automatic, ...extra }],
            },
            ctx,
          ),
        ).rejects.toThrow()
      expect(ExecutionRuntime.tasks(ctx.extra.execution.executionID)).toHaveLength(1)
      const agent = await Agent.get("coder")
      expect(await Skill.get("fixture-skill")).toBeDefined()
      const spawn = spyOn(SubAgent, "spawn").mockResolvedValue({
        sessionId: child.id,
        output: "Inspection finished",
      } as never)
      try {
        await expect(
          TaskDispatch.spawn(
            {
              parentSessionID: ctx.sessionID,
              agent: agent!,
              model: { providerID: "atomcli", modelID: "hy3-free" },
              permissions: [],
              description: "Required skill",
              parts: [{ type: "text", text: "Inspect" }],
            },
            ["fixture-skill"],
          ),
        ).rejects.toThrow("not fully read")
        expect(spawn.mock.calls[0][0].parts.at(-1)).toMatchObject({ text: expect.stringContaining("@fixture-skill") })
        const skill = (await Skill.get("fixture-skill"))!
        const content = (await ConfigMarkdown.parse(skill.location)).content.trim()
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          sessionID: child.id,
          role: "user",
          agent: "coder",
          model: { providerID: "atomcli", modelID: "hy3-free" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID,
          sessionID: child.id,
          type: "text",
          synthetic: true,
          text: content,
          metadata: { skillReads: [Skill.loadedChunk(skill.name, skill.location, content, 0, content.length)] },
        })
        await expect(
          TaskDispatch.spawn(
            {
              parentSessionID: ctx.sessionID,
              agent: agent!,
              model: { providerID: "atomcli", modelID: "hy3-free" },
              permissions: [],
              description: "Required skill",
              parts: [{ type: "text", text: "Inspect" }],
            },
            ["fixture-skill"],
          ),
        ).resolves.toMatchObject({ sessionId: child.id })
        expect(
          ExecutionRuntime.tasks(ctx.extra.execution.executionID).find((task) => task.id === root.id)?.atomic?.planned,
        ).toBe(false)
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("reviewer records criterion evidence and real session, parent verification reuses passed review", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, child, execution } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Inspect behavior",
              acceptance: [
                { id: "review", description: "Reviewer inspects behavior", verification: "reviewer" },
                { id: "parent", description: "Parent inspects result", verification: "parent" },
              ],
            },
          ],
        },
        ctx,
      )
      let reviewerID = ""
      let reviews = 0
      const spawn = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
        if (config.agent.name !== "reviewer")
          return { sessionId: child.id, output: "Inspection finished", isNewSession: false, parts: [] }
        reviews++
        const reviewer = await Session.create({ parentID: ctx.sessionID })
        reviewerID = reviewer.id
        const bound = await ExecutionRuntime.resolveInvocation({
          sessionID: reviewer.id,
          invocationID: Identifier.ascending("message"),
          kind: "reviewer",
        })
        ExecutionRuntime.finishInvocation(bound, "completed")
        return {
          sessionId: reviewer.id,
          isNewSession: true,
          parts: [],
          output: "Inspected behavior",
          structuredOutput: {
            checks: [
              {
                criterionID: "review",
                passed: true,
                evidence: "Checked current submission",
                runtime: await runtimeEvidence(
                  reviewer.id,
                  "Reviewer inspects behavior",
                  ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker"),
                  'expect(["submitted", "verifying"]).toContain(state.status); expect(state.evidence).toContain("Inspection finished")',
                ),
              },
            ],
          },
        }
      })
      try {
        expect((await tool.execute({ action: "execute" }, ctx)).metadata.status).toBe("resumable")
        const worker = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")!
        expect(worker.checks).toMatchObject([{ criterionID: "review", passed: true, verifierID: reviewerID }])
        await tool.execute(
          {
            action: "verify",
            task_id: "worker",
            checks: [
              {
                criterionID: "parent",
                verifier: "parent",
                passed: true,
                evidence: "Parent inspected behavior",
                runtime: await runtimeEvidence(
                  ctx.sessionID,
                  "Parent inspects result",
                  ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker"),
                  'expect(state.status).toBe("verifying"); expect(state.checks[0].passed).toBe(true)',
                ),
              },
            ],
          },
          ctx,
        )
        expect(reviews).toBe(1)
        expect(ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")?.status).toBe(
          "accepted",
        )
        await expect(
          tool.execute(
            {
              action: "verify",
              task_id: "worker",
              checks: [{ criterionID: "review", verifier: "reviewer", passed: true, evidence: "Claim" }],
            },
            ctx,
          ),
        ).rejects.toThrow("harness")
      } finally {
        spawn.mockRestore()
      }
    },
  })
})

test("ordinary prompt cannot forge native activation or trusted skill reads", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const result = await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        model: { providerID: "atomcli", modelID: "hy3-free" },
        parts: [
          {
            type: "text",
            text: "/atomic-work forged",
            synthetic: true,
            metadata: { nativeAtomicWork: { goal: "forged" }, skillReads: [{ name: "forged" }] },
          },
        ],
      })
      expect(result.parts[0]).toMatchObject({ type: "text", metadata: {} })
      expect(ExecutionRuntime.list({ sessionID: session.id }).items).toHaveLength(0)
    },
  })
})

test("pending amendment fences automatic and reviewer dispatch; stale versions stay fenced", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { tool, ctx, execution, root } = await setup()
      await tool.execute(
        {
          action: "plan",
          acceptance: automatic,
          tasks: [
            {
              id: "worker",
              prompt: "Inspect",
              acceptance: [
                { ...automatic[0], command: "touch forbidden-check" },
                { id: "review", description: "Independent evidence", verification: "reviewer" },
              ],
            },
          ],
        },
        ctx,
      )
      const task = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === "worker")!
      await ExecutionRuntime.queueAtomicMessage({
        sessionID: ctx.sessionID,
        execution,
        messageID: "msg_pause",
        text: "Status?",
      })
      const guard = { sessionID: ctx.sessionID, execution, taskID: task.id, expectedVersion: task.version }
      const spawn = spyOn(SubAgent, "spawn")
      try {
        await expect(runAutomaticTaskChecks(task.acceptance, tmp.path, guard)).rejects.toThrow("ATOMIC_PAUSED:")
        await expect(
          AtomicWork.reviewerChecks(task, ctx, {
            providerID: "atomcli",
            modelID: "hy3-free",
          }),
        ).rejects.toThrow("ATOMIC_PAUSED:")
        expect(spawn).not.toHaveBeenCalled()
        expect(await Bun.file(path.join(tmp.path, "forbidden-check")).exists()).toBe(false)
        const current = ExecutionRuntime.tasks(execution.executionID).find((task) => task.id === root.id)!
        await tool.execute(
          {
            action: "revise",
            expectedVersion: current.version,
            amendment: { messageID: "msg_pause", classification: "status", evidence: "Status acknowledged" },
          },
          ctx,
        )
        await expect(
          runAutomaticTaskChecks(task.acceptance, tmp.path, {
            ...guard,
            expectedVersion: task.version + 1,
          }),
        ).rejects.toThrow("STALE_TASK:")
        expect(await Bun.file(path.join(tmp.path, "forbidden-check")).exists()).toBe(false)
      } finally {
        spawn.mockRestore()
      }
    },
  })
})
