import "../preload"
import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"
import { LLM } from "@/core/session/llm"
import { Session } from "@/core/session"
import { Provider } from "@/integrations/provider/provider"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { WorkflowStateStore } from "@/integrations/tool/orchestrate/state"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ReadTool } from "@/integrations/tool/read"
import { WriteTool } from "@/integrations/tool/write"
import { FindTool } from "@/integrations/tool/find"
import { BashTool } from "@/integrations/tool/bash"
import { SubAgent } from "@/integrations/tool/subagent"
import { WorkflowOwnership } from "@/integrations/tool/orchestrate/ownership"
import { Bus } from "@/core/bus"

// ponytail: deterministic model transport; a live provider run remains separate.
if (process.env.ATOMCLI_WORKFLOW_WORKSPACE_FIXTURE !== "1") {
  test("native workspace workflow runs without suite module mocks", async () => {
    const child = Bun.spawn(["bun", "test", import.meta.path], {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...Bun.env, ATOMCLI_WORKFLOW_WORKSPACE_FIXTURE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stdout + stderr).toBe(0)
  }, 60_000)
} else {
  test("child permission composition keeps parent exceptions and the base delegation denies", () => {
    const parent = PermissionNext.fromConfig({
      read: { "*": "allow", "*.env.*": "deny", "*.env.example": "allow" },
    })
    const rules = SubAgent.buildPermissions(parent, [{ permission: "task", pattern: "*", action: "allow" }])
    expect(PermissionNext.evaluate("read", "fixture.env.example", rules).action).toBe("allow")
    expect(PermissionNext.evaluate("read", "fixture.env.local", rules).action).toBe("deny")
    for (const permission of ["task", "todowrite", "todoread"])
      expect(PermissionNext.evaluate(permission, "*", rules).action).toBe("deny")
  })

  test("two owned coders overlap in a Git-free /tmp workspace; rejection leaves no tasks or blockers", async () => {
    await using workspace = await tmpdir({
      config: {
        experimental: { execution_classification: false, smart_model_routing: false },
        permission: { "*": "allow" },
      },
    })
    await using outside = await tmpdir()
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        const root = await Session.create({ permission: PermissionNext.fromConfig({ "*": "allow" }) })
        const model = Object.values((await Provider.getProvider("atomcli"))!.models).find(
          (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
        )!
        const userID = Identifier.ascending("message")
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: root.id,
          role: "user",
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          time: { created: Date.now() },
        })
        await Session.updateMessage({
          id: messageID,
          parentID: userID,
          sessionID: root.id,
          role: "assistant",
          agent: "build",
          modelID: model.id,
          providerID: model.providerID,
          path: { cwd: workspace.path, root: Instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: root.id, invocationID: userID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({
            intent: "change",
            scope: "coordinated",
            risk: "low",
            confidence: 1,
            needsMutation: true,
          }),
        )
        const ctx = {
          sessionID: root.id,
          messageID,
          agent: "build",
          abort: new AbortController().signal,
          metadata() {},
          extra: { execution },
          async ask(request: any) {
            await PermissionNext.ask({ ...request, sessionID: root.id, ruleset: root.permission! })
          },
        }
        const agent = await AgentTool.init()
        expect(agent.description).toContain(`Active session workspace: ${workspace.path}`)
        const tasks = [
          {
            id: "slug",
            prompt: "Implement slugify and test",
            owns: ["test-agents/slugify.ts", "test-agents/slugify.test.ts"],
          },
          {
            id: "words",
            prompt: "Implement wordCount and test",
            owns: ["test-agents/wordCount.ts", "test-agents/wordCount.test.ts"],
          },
        ].map((task) => ({
          ...task,
          agent: "coder",
          model: `${model.providerID}/${model.id}`,
          budget: { maxRetries: 0 },
          acceptance: [
            {
              id: "tests",
              description: "Module tests pass",
              verification: "automatic" as const,
              command: `bun test ./${task.owns[1]}`,
            },
          ],
        }))
        await fs.mkdir(path.join(workspace.path, "test-agents"))
        await fs.symlink(outside.path, path.join(workspace.path, "escape"))
        for (const invalid of [path.join(outside.path, "bad.ts"), "../bad.ts", "escape/nested/bad.ts"]) {
          const rejected = await agent.execute(
            { action: "workflow", workflow_action: "plan", tasks: [tasks[0], { ...tasks[1], owns: [invalid] }] },
            ctx,
          )
          expect(rejected.metadata.error).toBe(true)
          expect(rejected.metadata.workflowId).toBeUndefined()
          expect(await Session.children(root.id)).toHaveLength(0)
          expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(0)
          expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(false)
        }
        const plan = await agent.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: tasks.map((task) => ({ ...task, owns: task.owns.map((file) => path.join(workspace.path, file)) })),
          },
          ctx,
        )
        expect(plan.metadata.error, plan.output).not.toBe(true)
        const started = new Set<string>()
        let release!: () => void
        const barrier = new Promise<void>((resolve) => {
          release = resolve
        })
        const calls = new Map<string, number>()
        const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
          allowAuxiliarySummaries: false,
          maxRetries: 0,
        } as never)
        const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
          const session = await Session.get(input.sessionID)
          expect(session.metadata?.workflowOwnership).toBeDefined()
          const slug = session.title.includes("] slug ")
          const stem = slug ? "slugify" : "wordCount"
          const count = (calls.get(stem) ?? 0) + 1
          calls.set(stem, count)
          if (count === 1) {
            started.add(stem)
            if (started.size === 2) release()
            await barrier
            if (slug) {
              const deniedPath = path.join(workspace.path, "parent-denied.txt")
              await Bun.write(deniedPath, "fake parent-only fixture")
              await Session.update(root.id, (draft) => {
                draft.permission = [
                  ...(draft.permission ?? []),
                  { permission: "read", pattern: deniedPath, action: "deny" },
                ]
              })
              await Session.update(session.id, (draft) => {
                draft.permission = [
                  ...(draft.permission ?? []),
                  { permission: "read", pattern: deniedPath, action: "allow" },
                ]
              })
              await expect(
                input.tools.read.execute!(
                  { filePath: deniedPath },
                  {
                    toolCallId: "parent-denial",
                    abortSignal: input.abort,
                    messages: [],
                  },
                ),
              ).rejects.toThrow("prevents you")
            }
          }
          const files = [
            {
              filePath: path.join(workspace.path, `test-agents/${stem}.ts`),
              content: slug
                ? 'export const slugify = (text: string) => text.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, c => ({ç:"c",ğ:"g",ı:"i",ö:"o",ş:"s",ü:"u"})[c]!).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")'
                : "export const wordCount = (text: string) => text.trim() ? text.trim().split(/\\s+/).length : 0",
            },
            {
              filePath: path.join(workspace.path, `test-agents/${stem}.test.ts`),
              content: slug
                ? 'import {test,expect} from "bun:test"; import {slugify} from "./slugify"; test("Turkish",()=>expect(slugify("ÇĞ Iİ ÖŞÜ")).toBe("cg-ii-osu"))'
                : 'import {test,expect} from "bun:test"; import {wordCount} from "./wordCount"; test("words",()=>{expect(wordCount("  one  two\\nthree ")).toBe(3); expect(wordCount("  ")).toBe(0)})',
            },
          ]
          return {
            fullStream: (async function* () {
              if (count <= 2) {
                const id = `${stem}-${count}`
                yield { type: "tool-call", toolCallId: id, toolName: "write", input: JSON.stringify(files[count - 1]) }
                const result = await input.tools.write.execute!(files[count - 1], {
                  toolCallId: id,
                  abortSignal: input.abort,
                  messages: [],
                })
                yield {
                  type: "tool-result",
                  toolCallId: id,
                  toolName: "write",
                  input: files[count - 1],
                  output: result,
                }
                yield {
                  type: "finish-step",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }
              } else {
                yield { type: "text-start", id: stem }
                yield {
                  type: "text-delta",
                  id: stem,
                  text: `<agent_result>{"status":"complete","summary":"${stem} implemented","editedFiles":["${files[0].filePath}","${files[1].filePath}"],"failures":[]}</agent_result>`,
                }
                yield { type: "text-end", id: stem }
                yield {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                }
              }
              yield { type: "finish" }
            })(),
          } as never
        })
        try {
          const result = await agent.execute(
            { action: "workflow", workflow_action: "execute", workflowId: plan.metadata.workflowId },
            ctx,
          )
          expect(result.metadata.status, result.output).toBe("completed")
          expect(started.size).toBe(2)
          expect(ExecutionRuntime.tasks(execution.executionID).every((task) => task.status === "accepted")).toBe(true)
          expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(false)
          const workflow = WorkflowStateStore.get(plan.metadata.workflowId!)!
          expect(workflow.tasks.map((task) => task.owns)).toEqual(tasks.map((task) => task.owns))
          const verification = Bun.spawn(["bun", "test", "./test-agents"], {
            cwd: workspace.path,
            stdout: "pipe",
            stderr: "pipe",
          })
          const [stdout, stderr, code] = await Promise.all([
            new Response(verification.stdout).text(),
            new Response(verification.stderr).text(),
            verification.exited,
          ])
          expect(code, stdout + stderr).toBe(0)
          expect(stderr).toContain("2 pass")
          const blocker = await ExecutionRuntime.registerBlocker({
            sessionID: root.id,
            execution,
            blockerID: "failed-workflow",
            kind: "workflow",
            producerID: "wf_failed_workspace",
            resourceScope: "workflow:wf_failed_workspace",
          })
          const running = await ExecutionRuntime.transitionBlocker({
            sessionID: root.id,
            execution,
            blockerID: blocker.id,
            expectedVersion: blocker.version,
            state: "running",
          })
          await ExecutionRuntime.transitionBlocker({
            sessionID: root.id,
            execution,
            blockerID: blocker.id,
            expectedVersion: running.version,
            state: "failed",
            evidence: "permission denied",
          })
          expect(ExecutionRuntime.taskflowPlan(execution.executionID, root.id)).toHaveLength(0)
          const checkpoint = ExecutionRuntime.reconcileCheckpoint(
            execution.executionID,
            ExecutionCheckpoint.Result.parse({
              ...ExecutionCheckpoint.conservativeContinue(),
              decision: "finish",
              finalResponse: "Verified files exist.",
            }),
            root.id,
          )
          expect(checkpoint.decision).toBe("blocked")
          expect(checkpoint.remainingWork.join(" ")).toContain("wf_failed_workspace (failed)")
          expect(checkpoint.remainingWork.join(" ")).not.toContain("open steps: .")
        } finally {
          stream.mockRestore()
          evaluation.mockRestore()
        }
      },
    })
  }, 60_000)

  test("owned child preserves parent denies, canonical boundaries, and cross-tool rejection", async () => {
    await using workspace = await tmpdir()
    await using outside = await tmpdir()
    await Instance.provide({
      directory: workspace.path,
      fn: async () => {
        const denied = path.relative(Instance.worktree, path.join(workspace.path, "denied.ts"))
        const parent = await Session.create({
          permission: PermissionNext.fromConfig({
            "*": "allow",
            edit: { "*": "allow", [denied]: "deny" },
            read: { "*": "allow", [path.join(workspace.path, "denied.ts")]: "deny" },
            external_directory: { "*": "ask" },
          }),
        })
        const child = await Session.create({
          parentID: parent.id,
          permission: SubAgent.buildPermissions(parent.permission!),
        })
        const owns = ["owned.ts", "alias.ts", "target.ts", "denied.ts", "retarget.ts"]
        await Session.update(child.id, (draft) => {
          draft.metadata = { workflowOwnership: { root: workspace.path, owns } }
        })
        const ctx = {
          sessionID: child.id,
          messageID: Identifier.ascending("message"),
          agent: "coder",
          abort: new AbortController().signal,
          metadata() {},
          async ask(request: any) {
            await PermissionNext.ask({ ...request, sessionID: child.id, ruleset: child.permission! })
          },
        }
        const write = await WriteTool.init()
        const read = await ReadTool.init()
        const find = await FindTool.init()
        const bash = await BashTool.init()
        await expect(write.execute({ filePath: "denied.ts", content: "forbidden" }, ctx)).rejects.toThrow(
          "prevents you",
        )
        await Bun.write(path.join(workspace.path, "denied.ts"), "fake denied fixture")
        await expect(read.execute({ filePath: "denied.ts" }, ctx)).rejects.toThrow("prevents you")
        for (const filePath of ["other.ts", "../escape.ts", path.join(outside.path, "outside.ts")])
          await expect(write.execute({ filePath, content: "forbidden" }, ctx)).rejects.toThrow()
        await fs.symlink(outside.path, path.join(workspace.path, "link"))
        await expect(write.execute({ filePath: "link/nested/new.ts", content: "forbidden" }, ctx)).rejects.toThrow()
        await fs.symlink("other.ts", path.join(workspace.path, "owned.ts"))
        await expect(write.execute({ filePath: "owned.ts", content: "forbidden" }, ctx)).rejects.toThrow()
        await fs.unlink(path.join(workspace.path, "owned.ts"))
        const scoped = await WorkflowOwnership.scope(child.id)
        expect(scoped?.owns).toEqual(owns)
        const deniedTarget = path.relative(Instance.worktree, path.join(workspace.path, "target.ts"))
        const targetRules = [
          ...child.permission!,
          { permission: "edit", pattern: deniedTarget, action: "deny" as const },
        ]
        await Bun.write(path.join(workspace.path, "target.ts"), "fake target fixture")
        await fs.symlink("target.ts", path.join(workspace.path, "alias.ts"))
        await read.execute({ filePath: "alias.ts" }, ctx)
        await expect(
          write.execute(
            { filePath: "alias.ts", content: "forbidden" },
            {
              ...ctx,
              async ask(request) {
                await PermissionNext.ask({ ...request, sessionID: child.id, ruleset: targetRules })
              },
            },
          ),
        ).rejects.toThrow("prevents you")
        // A permission wait can change a path. Recheck before entering the write body.
        await expect(
          write.execute(
            { filePath: "retarget.ts", content: "forbidden" },
            {
              ...ctx,
              async ask() {
                await fs.symlink(path.join(outside.path, "retarget.ts"), path.join(workspace.path, "retarget.ts"))
              },
            },
          ),
        ).rejects.toThrow()
        const rejections: string[] = []
        const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, async (event) => {
          if (event.properties.permission !== "external_directory") return
          rejections.push(event.properties.sessionID)
          await PermissionNext.reply({ requestID: event.properties.id, reply: "reject" })
        })
        try {
          await expect(
            find.execute(
              { mode: "tree", pattern: "", path: outside.path },
              {
                ...ctx,
                sessionID: parent.id,
                async ask(request) {
                  await PermissionNext.ask({ ...request, sessionID: parent.id, ruleset: parent.permission! })
                },
              },
            ),
          ).rejects.toThrow("rejected permission")
          await expect(find.execute({ mode: "tree", pattern: "", path: outside.path }, ctx)).rejects.toThrow(
            "rejected permission",
          )
          await expect(
            bash.execute({ command: `ls ${outside.path}`, description: "Try denied child path" }, ctx),
          ).rejects.toThrow("rejected permission")
          expect(rejections).toEqual([parent.id, child.id, child.id])
        } finally {
          unsubscribe()
        }
        const shellTarget = path.join(outside.path, "shell-write.ts")
        // Arbitrary shell programs cannot bypass owns: shell writes are OS read-only.
        try {
          const result = await bash.execute(
            { command: `printf forbidden > ${shellTarget}`, description: "Check ownership sandbox" },
            { ...ctx, async ask() {} },
          )
          expect(result.metadata.exit).not.toBe(0)
        } catch (error) {
          expect(String(error)).toContain("Sandbox was required")
        }
        expect(await Bun.file(shellTarget).exists()).toBe(false)
        expect(await Bun.file(path.join(outside.path, "retarget.ts")).exists()).toBe(false)
        expect(await Bun.file(path.join(workspace.path, "other.ts")).exists()).toBe(false)
      },
    })
  }, 30_000)
}
