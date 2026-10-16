import "../preload"
import { expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "@/services/project/instance"
import { Global } from "@/core/global"
import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import { SessionProcessor } from "@/core/session/processor"
import { Identifier } from "@/core/id/id"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { AgentEval } from "@/core/eval/harness"
import { Skill } from "@/integrations/skill"
import { TaskFlowTool } from "@/integrations/tool/taskflow"
import { MessageV2 } from "@/core/session/message-v2"
import { SubAgent } from "@/integrations/tool/subagent"
import { SessionMemoryIntegration } from "@/core/memory/integration/session"
import { Bus } from "@/core/bus"
import { GlobalBus } from "@/core/bus/global"
import { SessionStatus } from "@/core/session/status"
import { PromptActiveSessions } from "@/core/session/prompt/active-sessions"
import { SessionExecutionProfile } from "@/core/session/execution-profile"
import { PermissionNext } from "@/util/permission/next"
import { HarnessState } from "@/core/session/harness-state"
import { Agent } from "@/integrations/agent/agent"
import { SubAgentIsolation } from "@/integrations/tool/subagent-isolation"
import { Storage } from "@/core/storage/storage"
import { Config } from "@/core/config/config"

const GOAL = (await Bun.file(new URL("./fixtures/atomic-browser-os.txt", import.meta.url)).text()).trim()
const MILESTONES = ["shell", "wallpaper", "email-and-apps", "gta", "second-game", "special-feature"]

// ponytail: scripted model validates native lifecycle and context, not Browser OS quality; upgrade with the documented live retry.
if (process.env.ATOMCLI_ATOMIC_NATIVE_FIXTURE !== "1") {
  test("native Browser OS lifecycle runs in a clean process without suite module mocks", async () => {
    const process = Bun.spawn(["bun", "test", import.meta.path], {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...Bun.env, ATOMCLI_ATOMIC_NATIVE_FIXTURE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(exit, stdout + stderr).toBe(0)
    expect(stderr).toContain("3 pass")
    expect(stderr).toContain("0 fail")
  }, 60_000)
} else {
  test.each([false, true])(
    "native Browser OS lifecycle in empty workspace; git=%s, real child prompts and runtime evidence",
    async (git) => {
      await using tmp = await tmpdir({ git })
      await using checks = await tmpdir()
      const skillDirectory = path.join(Global.Path.config, "skills", "atomic-browser-fixture")
      await Bun.write(
        path.join(skillDirectory, "SKILL.md"),
        "---\nname: atomic-browser-fixture\ndescription: Atomic lifecycle fixture instructions\n---\nATOMIC_BROWSER_SKILL_CONTENT: preserve prior milestones in the single script.\n",
      )
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            expect((await fs.readdir(tmp.path)).filter((name) => ![".git", "atomcli.json"].includes(name))).toEqual([])
            await Bun.write(path.join(tmp.path, "atomcli.json"), JSON.stringify({ review: { auto: true } }))
            await Config.clearCache()
            const session = await Session.create({ title: "Browser OS lifecycle fixture" })
            let executionID = ""
            let rootID = ""
            let mainTurns = 0
            let workerTurns = 0
            let reviewerTurns = 0
            const injectedChildren: string[] = []
            const worktrees = new Set<string>()
            const activity = new Set<string>()
            const unsubscribe = Bus.subscribeAll((event) => {
              if (event.type === "tui.subagent.activity") activity.add(event.properties.sessionId)
            })
            const dispatchErrors: string[] = []
            const originalSpawn = SubAgent.spawn
            const dispatch = spyOn(SubAgent, "spawn").mockImplementation(async (config) => {
              try {
                return await originalSpawn(config)
              } catch (error) {
                dispatchErrors.push(error instanceof Error ? (error.stack ?? String(error)) : String(error))
                throw error
              }
            })
            const auxiliary = spyOn(AgentEval, "executionPolicy").mockReturnValue({
              allowAuxiliarySummaries: false,
            } as never)
            const foreignMemory = spyOn(SessionMemoryIntegration, "getUserContext").mockResolvedValue(
              "FOREIGN_PROJECT_CONTEXT: /foreign/project/neon-os.html",
            )
            const processor = spyOn(SessionProcessor, "create").mockImplementation((input) => {
              const parts = new Map<string, MessageV2.ToolPart>()
              return {
                message: input.assistantMessage,
                partFromToolCall: (id: string) => parts.get(id),
                async process(stream) {
                  const parent = stream.sessionID === session.id
                  const tools = stream.tools
                  const runTool = async (name: string, args: Record<string, unknown>) => {
                    const callID = crypto.randomUUID()
                    const start = Date.now()
                    const part: MessageV2.ToolPart = {
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: stream.sessionID,
                      type: "tool",
                      tool: name,
                      callID,
                      state: { status: "running", input: args, time: { start } },
                    }
                    parts.set(callID, part)
                    await Session.updatePart(part)
                    const result = await tools[name]
                      .execute(args, { toolCallId: callID, abortSignal: stream.abort })
                      .catch(async (error) => {
                        await Session.updatePart({
                          ...part,
                          state: {
                            status: "error",
                            input: args,
                            error: String(error),
                            time: { start, end: Date.now() },
                          },
                        })
                        throw error
                      })
                    await Session.updatePart({
                      ...part,
                      state: {
                        status: "completed",
                        input: args,
                        title: result.title,
                        output: result.output,
                        metadata: result.metadata,
                        time: { start, end: Date.now() },
                      },
                    })
                    return result
                  }
                  const reply = async (text: string) => {
                    input.assistantMessage.finish = "stop"
                    input.assistantMessage.time.completed = Date.now()
                    await Session.updateMessage(input.assistantMessage)
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: stream.sessionID,
                      type: "text",
                      text,
                    })
                    return { status: "stop" as const }
                  }
                  expect(Object.keys(tools)).not.toContain("taskflow")
                  const context = JSON.stringify([stream.system, stream.messages])
                  expect(context).not.toContain("FOREIGN_PROJECT_CONTEXT")
                  expect(context).not.toContain("<coordinated_plan>")
                  expect(context).not.toContain("<plan_barrier>")
                  if (parent) {
                    mainTurns++
                    executionID = stream.execution.executionID
                    const root = ExecutionRuntime.atomicRoot(executionID)!
                    rootID = root.id
                    expect(root.goal).toBe(GOAL)
                    expect(root.atomic?.planned).toBe(false)
                    expect(Object.keys(tools)).toContain("task")
                    const tasks = MILESTONES.map((id, index) => ({
                      id,
                      prompt: `Implement Browser OS deliverable: ${id}.\n${GOAL}`,
                      agent: "coder",
                      model: "atomcli/hy3-free",
                      dependsOn: index ? [MILESTONES[index - 1]] : [],
                      owns: ["index.html"],
                      skills: ["atomic-browser-fixture"],
                      budget: { maxRetries: 0 },
                      isolation: "auto",
                      acceptance: [
                        {
                          id: "structure",
                          description: `Single-file ${id} milestone exists`,
                          verification: "automatic",
                          command: `test -s index.html && grep -q '${id}' index.html`,
                        },
                      ],
                    }))
                    const acceptance = [
                      {
                        id: "single-file",
                        description: "Script artifact exists",
                        verification: "automatic",
                        command: "test -s index.html",
                      },
                    ]
                    await expect(
                      runTool("task", { action: "plan", tasks, acceptance, definition: {}, amendment: {}, checks: [] }),
                    ).rejects.toThrow("invalid arguments")
                    expect(ExecutionRuntime.tasks(executionID)).toHaveLength(1)
                    await expect(
                      runTool("task", {
                        action: "run",
                        task_id: "browser-os",
                        description: "Fallback",
                        prompt: GOAL,
                        subagent_type: "general",
                      }),
                    ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
                    await expect(
                      (await TaskFlowTool.init()).execute(
                        { action: "start", plan: [{ name: "foundation" }] },
                        {
                          sessionID: session.id,
                          messageID: input.assistantMessage.id,
                          agent: "build",
                          abort: stream.abort,
                          extra: { execution: stream.execution },
                          metadata() {},
                          async ask() {},
                        },
                      ),
                    ).rejects.toThrow("ATOMIC_PLAN_REQUIRED")
                    await runTool("task", { action: "plan", tasks, acceptance })
                    const planned = ExecutionRuntime.tasks(executionID)
                    expect(planned).toHaveLength(7)
                    expect(planned.find((item) => item.id === rootID)?.atomic?.planned).toBe(true)
                    expect(planned.find((item) => item.id === rootID)?.dependsOn.sort()).toEqual([...MILESTONES].sort())
                    expect(
                      planned
                        .filter((item) => item.parentTaskID === rootID)
                        .every((item) => item.execution?.skills.includes("atomic-browser-fixture")),
                    ).toBe(true)
                    const executed = await runTool("task", { action: "execute" })
                    expect(executed.metadata.status, executed.output + "\n" + dispatchErrors.join("\n")).toBe(
                      "completed",
                    )
                    expect(ExecutionRuntime.tasks(executionID).every((item) => item.status === "accepted")).toBe(true)
                    return reply("Scripted Browser OS lifecycle verified; product behavior requires live review.")
                  }
                  expect(Object.keys(tools)).not.toContain("task")
                  expect((await Session.get(stream.sessionID)).directory).toBe(tmp.path)
                  await Instance.provide({
                    directory: tmp.path,
                    fn: async () => {
                      expect((await Session.get(stream.sessionID)).parentID).toBe(session.id)
                      expect(SessionStatus.get(stream.sessionID).type).toBe("busy")
                      expect(PromptActiveSessions.isActive(stream.sessionID)).toBe(true)
                    },
                  })
                  const tasks = ExecutionRuntime.tasks(stream.execution.executionID)
                  if (stream.agent.name === "reviewer") {
                    reviewerTurns++
                    const root = tasks.find((item) => item.id === rootID)!
                    expect(["submitted", "verifying"]).toContain(root.status)
                    expect(root.checks).not.toEqual(
                      expect.arrayContaining([
                        expect.objectContaining({ criterionID: "atomic-global-1", passed: true }),
                      ]),
                    )
                    expect(JSON.stringify(stream.messages)).toContain(GOAL.split("\n")[0])
                    const file = path.join(checks.path, "acceptance.test.ts")
                    // The fixture asserts actual accumulated milestones. The scripted reviewer simulates semantic judgment.
                    await Bun.write(
                      file,
                      `import { test, expect } from "bun:test"\n` +
                        `test("single-script fixture milestones", async () => { const html = await Bun.file(${JSON.stringify(path.join(tmp.path, "index.html"))}).text(); ` +
                        `const script = html.match(/<script>([\\s\\S]*)<\\/script>/)[1]; const state = Function(script + "; return milestones")(); ` +
                        `expect(state).toEqual(${JSON.stringify(MILESTONES)}); expect(html.match(/<script>/g)).toHaveLength(1) })\n`,
                    )
                    const args = { command: `bun test ${file}`, description: "Verify single-script fixture milestones" }
                    const result = await runTool("bash", args)
                    expect(result.metadata.exit).toBe(0)
                    expect(result.output).toContain("1 pass")
                    return reply(
                      "<structured_output>" +
                        JSON.stringify({
                          checks: [
                            {
                              criterionID: "atomic-global-1",
                              passed: true,
                              evidence: "Fixture runtime passed",
                              runtime: {
                                criterion: GOAL,
                                setup: "Read integrated fixture",
                                action: "Execute inline script and assert milestone state",
                                expected: "All six fixture milestones exist in one script",
                                observed: "1 pass",
                                evidence: [{ tool: "bash", input: JSON.stringify(args), output: "1 pass" }],
                              },
                            },
                          ],
                        }) +
                        "</structured_output>",
                    )
                  }
                  workerTurns++
                  const task = tasks.find((item) => item.sessionID === stream.sessionID)!
                  expect(task).toBeDefined()
                  expect(task.status).toBe("running")
                  if (task.id === rootID) return reply("Integration fixture ready for independent global review")
                  expect(JSON.stringify(stream.messages)).toContain(`Active ownership root: ${Instance.directory}`)
                  if (git) {
                    expect(Instance.directory).not.toBe(tmp.path)
                    worktrees.add(Instance.directory)
                  } else expect(Instance.directory).toBe(tmp.path)
                  expect(context).toContain("ATOMIC_BROWSER_SKILL_CONTENT")
                  injectedChildren.push(stream.sessionID)
                  expect(await Skill.pendingSessionReads(stream.sessionID, stream.execution)).toEqual([])
                  const file = path.join(Instance.directory, "index.html")
                  const exists = await Bun.file(file).exists()
                  if (exists) await runTool("read", { filePath: file })
                  const existing = exists ? await Bun.file(file).text() : "<script>const milestones = [];</script>"
                  const content = existing.replace("</script>", `milestones.push(${JSON.stringify(task.id)});</script>`)
                  await runTool("write", { filePath: file, content })
                  expect(
                    ExecutionRuntime.tasks(stream.execution.executionID).find((item) => item.id === task.id)?.status,
                  ).toBe("running")
                  return reply(
                    'Fixture milestone implemented\n<agent_result>{"status":"complete","summary":"Fixture milestone implemented","failures":[]}</agent_result>',
                  )
                },
              } as never
            })
            try {
              await SessionPrompt.command({
                sessionID: session.id,
                command: "atomic-work",
                arguments: GOAL,
                agent: "build",
                model: "atomcli/hy3-free",
              })
              expect(mainTurns).toBe(1)
              expect(foreignMemory).not.toHaveBeenCalled()
              expect(workerTurns).toBe(7)
              expect(reviewerTurns).toBe(1)
              expect(new Set(injectedChildren).size).toBe(6)
              for (const child of await Session.children(session.id)) {
                expect((await Session.get(child.id)).directory).toBe(tmp.path)
                expect((await Session.messages({ sessionID: child.id })).length).toBeGreaterThan(0)
              }
              expect(injectedChildren.every((id) => activity.has(id))).toBe(true)
              expect(worktrees.size).toBe(git ? 6 : 0)
              for (const directory of worktrees)
                expect(
                  await fs.access(directory).then(
                    () => true,
                    () => false,
                  ),
                ).toBe(false)
              const root = ExecutionRuntime.tasks(executionID).find((item) => item.id === rootID)!
              expect(root.goal).toBe(GOAL)
              expect(root.checks.find((item) => item.criterionID === "atomic-global-1")).toMatchObject({
                passed: true,
                verifier: "reviewer",
              })
              expect(
                (await fs.readdir(tmp.path)).filter((name) => ![".git", ".atomcli", "atomcli.json"].includes(name)),
              ).toEqual(["index.html"])
            } finally {
              processor.mockRestore()
              auxiliary.mockRestore()
              dispatch.mockRestore()
              foreignMemory.mockRestore()
              unsubscribe()
            }
          },
        })
      } finally {
        await fs.rm(skillDirectory, { recursive: true, force: true })
      }
    },
    60_000,
  )

  test("isolated native child permissions, events, cancellation and history remain accessible from parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        SessionExecutionProfile.set(parent.id, "companion-fast")
        const isolation = await SubAgentIsolation.create("native-cancel-fixture")
        const asked = Promise.withResolvers<PermissionNext.Request>()
        const ready = Promise.withResolvers<void>()
        const events: { directory: string; type: string }[] = []
        const onEvent = (event: { directory?: string; payload: { type: string } }) => {
          if (event.payload.type === "permission.asked" || event.payload.type === "message.part.updated")
            events.push({ directory: event.directory!, type: event.payload.type })
        }
        GlobalBus.on("event", onEvent)
        const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, (event) => asked.resolve(event.properties))
        let childSignal: AbortSignal | undefined
        const processor = spyOn(SessionProcessor, "create").mockImplementation(
          (input) =>
            ({
              message: input.assistantMessage,
              async process(stream) {
                expect(Instance.directory).toBe(isolation.directory)
                expect(Instance.sessionDirectory).toBe(tmp.path)
                expect(SessionExecutionProfile.get(stream.sessionID)).toBe("companion-fast")
                childSignal = stream.abort
                await Session.updatePart({
                  id: Identifier.ascending("part"),
                  messageID: input.assistantMessage.id,
                  sessionID: stream.sessionID,
                  type: "text",
                  text: "Isolated child waiting for permission",
                })
                HarnessState.pushExecutionLog(stream.sessionID, {
                  command: "fixture",
                  output: "native log",
                  exitCode: 0,
                })
                await PermissionNext.ask({
                  sessionID: stream.sessionID,
                  permission: "bash",
                  patterns: ["fixture"],
                  always: [],
                  metadata: {},
                  ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
                })
                ready.resolve()
                await new Promise((_, reject) => {
                  stream.abort.addEventListener("abort", () => reject(new Error("Native fixture cancelled")), {
                    once: true,
                  })
                })
              },
            }) as never,
        )
        let childID: string | undefined
        let settled: Promise<unknown> | undefined
        try {
          settled = SubAgent.spawn({
            parentSessionID: parent.id,
            agent: (await Agent.get("coder"))!,
            model: { providerID: "atomcli", modelID: "hy3-free" },
            parts: [{ type: "text", text: "Wait for the cancellation fixture" }],
            permissions: SubAgent.buildPermissions([]),
            description: "Native cancellation fixture",
            workingDirectory: isolation.directory,
            onSession: ({ sessionId }) => {
              childID = sessionId
            },
          }).then(
            () => "unexpected completion",
            (error) => error,
          )
          const unexpectedExit = settled.then((result) => {
            throw result
          })
          const request = await Promise.race([asked.promise, unexpectedExit])
          expect(request.sessionID).toBe(childID!)
          expect((await Session.get(childID!)).directory).toBe(tmp.path)
          expect((await Session.children(parent.id)).map((item) => item.id)).toContain(childID!)
          expect(SessionStatus.get(childID!).type).toBe("busy")
          expect(PromptActiveSessions.isActive(childID!)).toBe(true)
          expect(HarnessState.getLastLogs(childID!)[0].output).toBe("native log")
          await Instance.provide({
            directory: isolation.directory,
            fn: async () => {
              expect(Instance.sessionDirectory).toBe(isolation.directory)
              await expect(Session.get(childID!)).rejects.toBeInstanceOf(Storage.NotFoundError)
            },
          })
          expect(await PermissionNext.reply({ requestID: request.id, reply: "once" })).toBe(true)
          await Promise.race([ready.promise, unexpectedExit])
          await SubAgent.cancel(childID!)
          expect(childSignal!.aborted).toBe(true)
          expect((await settled) instanceof Error).toBe(true)
          expect(PromptActiveSessions.isActive(childID!)).toBe(false)
          expect(events.some((event) => event.type === "message.part.updated")).toBe(true)
          expect(events.some((event) => event.type === "permission.asked")).toBe(true)
          expect(events.every((event) => event.directory === tmp.path)).toBe(true)
          await isolation.dispose()
          expect((await Session.get(childID!)).directory).toBe(tmp.path)
          expect((await Session.messages({ sessionID: childID! })).length).toBeGreaterThan(0)
          expect(HarnessState.getLastLogs(childID!)[0].output).toBe("native log")
        } finally {
          for (const request of await PermissionNext.list())
            if (request.sessionID === childID) await PermissionNext.reply({ requestID: request.id, reply: "reject" })
          if (childID) await SubAgent.cancel(childID)
          await settled
          processor.mockRestore()
          unsubscribe()
          GlobalBus.off("event", onEvent)
          await isolation.dispose()
        }
      },
    })
  }, 30_000)
}
