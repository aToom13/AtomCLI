import "../preload"
import { expect, spyOn, test } from "bun:test"
import { APICallError } from "@ai-sdk/provider"
import fs from "fs/promises"
import path from "path"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"
import { LLM } from "@/core/session/llm"
import { Session } from "@/core/session"
import { SessionPrompt } from "@/core/session/prompt"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { PromptCompletion } from "@/core/session/prompt/completion"
import { Provider } from "@/integrations/provider/provider"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { SubAgent } from "@/integrations/tool/subagent"
import { WorkflowStateStore } from "@/integrations/tool/orchestrate/state"
import { PermissionNext } from "@/util/permission/next"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

// ponytail: native orchestration, deterministic transport; live provider validation is separate.
if (process.env.ATOMCLI_CHILD_COORDINATION_FIXTURE !== "1") {
  test("child coordination runs with native modules isolated from suite mocks", async () => {
    const child = Bun.spawn(["bun", "test", import.meta.path], {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...Bun.env, ATOMCLI_CHILD_COORDINATION_FIXTURE: "1" },
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
  test.each([
    "success",
    "ownership",
    "reported-ownership",
    "permission",
    "provider",
    "runtime",
    "timeout",
    "timeout-checkpoint",
    "result-repair",
    "result-invalid",
    "result-no-retry",
    "isolation-required",
  ] as const)(
    "native parallel child coordination: %s",
    async (mode) => {
      const timeout = mode.startsWith("timeout")
      const resultCase = mode.startsWith("result-")
      const reportFailure = timeout || mode === "result-invalid" || mode === "result-no-retry"
      await using workspace = await tmpdir({
        git: mode === "isolation-required",
        config: {
          lsp: false,
          experimental: { execution_classification: false, smart_model_routing: false },
          permission: { "*": "allow" },
        },
      })
      await Instance.provide({
        directory: workspace.path,
        fn: async () => {
          const permission = PermissionNext.fromConfig({ "*": "allow" })
          if (mode === "permission")
            permission.push({
              permission: "edit",
              pattern: path.relative(Instance.worktree, path.join(workspace.path, "test-agents/wordCount.ts")),
              action: "deny",
            })
          const root = await Session.create({ permission })
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
              await PermissionNext.ask({ ...request, sessionID: root.id, ruleset: permission })
            },
          }
          const agent = await AgentTool.init()
          await fs.mkdir(path.join(workspace.path, "test-agents"))
          const tasks = ["slugify", "wordCount"].map((stem) => ({
            id: stem,
            agent: "coder",
            prompt: `Implement ${stem} and tests in test-agents.`,
            model: `${model.providerID}/${model.id}`,
            owns: [`test-agents/${stem}.ts`, `test-agents/${stem}.test.ts`],
            budget: { maxRetries: resultCase ? (mode === "result-no-retry" ? 0 : 1) : 2 },
            isolation: mode === "isolation-required" ? ("required" as const) : ("auto" as const),
            ...(timeout ? { executionTimeoutSeconds: stem === "wordCount" ? 5 : 30 } : {}),
            acceptance: [
              {
                id: "tests",
                description: "Module tests pass",
                verification: "automatic" as const,
                command: `bun test ./test-agents/${stem}.test.ts`,
              },
            ],
          }))
          if (mode === "success") {
            const isolationRejected = await agent.execute(
              { action: "workflow", workflow_action: "plan", tasks: [{ ...tasks[0], isolation: "required" }] },
              ctx,
            )
            expect(isolationRejected.metadata.error).toBe(true)
            expect(isolationRejected.output).toContain("not a git worktree")
            expect(isolationRejected.metadata.workflowId).toBeUndefined()
            expect(await Session.children(root.id)).toHaveLength(0)
            expect(ExecutionRuntime.tasks(execution.executionID)).toHaveLength(0)
            expect(ExecutionRuntime.snapshot(root.id).blockers).toHaveLength(0)
            const invalid = await agent.execute(
              {
                action: "workflow",
                workflow_action: "plan",
                tasks: [{ ...tasks[1], owns: ["test-agents/wordCount*"] }],
              },
              ctx,
            )
            expect(invalid.metadata.error).toBe(true)
            expect(invalid.output).toContain("not glob patterns")
            expect(await Session.children(root.id)).toHaveLength(0)
            expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(false)
          }
          const plan = await agent.execute({ action: "workflow", workflow_action: "plan", tasks }, ctx)
          expect(plan.metadata.error, plan.output).not.toBe(true)
          const starts = new Map<string, number>()
          const calls = new Map<string, number>()
          const inputs = new Map<string, LLM.StreamInput>()
          const writeErrors = new Map<string, string>()
          const testOutputs = new Map<string, string>()
          let parentCalls = 0
          let parentVerified = false
          let checkpointReported = false
          let workflowResult: Awaited<ReturnType<typeof agent.execute>> | undefined
          const drained = Promise.withResolvers<void>()
          let release!: () => void
          const barrier = new Promise<void>((resolve) => {
            release = resolve
          })
          const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
            allowAuxiliarySummaries: false,
            maxRetries: 0,
          } as never)
          const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
            const session = await Session.get(input.sessionID)
            if (session.id === root.id) {
              parentCalls++
              if (parentCalls > 4) throw new Error("Parent entered a repeated report loop")
              return {
                fullStream: (async function* () {
                  if (!parentVerified) {
                    const checks = [
                      {
                        tool: "agent",
                        args: { action: "workflow", workflow_action: "execute", workflowId: plan.metadata.workflowId },
                      },
                      {
                        tool: "agent",
                        args: { action: "workflow", workflow_action: "status", workflowId: plan.metadata.workflowId },
                      },
                      {
                        tool: "bash",
                        args: {
                          command: "bun test ./test-agents/slugify.test.ts && test ! -e ./test-agents/wordCount.ts",
                          workdir: workspace.path,
                          description: "Parent verifies fast result and missing slow artifact",
                        },
                      },
                    ]
                    if (!timeout) checks[2].args.command = "bun test ./test-agents"
                    for (const [index, check] of checks.entries()) {
                      const id = `parent-${index}`
                      yield {
                        type: "tool-call",
                        toolCallId: id,
                        toolName: check.tool,
                        input: JSON.stringify(check.args),
                      }
                      const output = await input.tools[check.tool].execute!(check.args, {
                        toolCallId: id,
                        abortSignal: input.abort,
                        messages: [],
                      })
                      if (check.tool === "bash") expect((output as any).metadata.exit).toBe(0)
                      else if (index === 0) workflowResult = output as typeof workflowResult
                      else {
                        expect((output as any).output).toContain("failed")
                        // Public status must supply the durable root/task facts;
                        // forensic storage lookup is unnecessary for this report.
                        expect((output as any).metadata.execution).toMatchObject({
                          lifecycle: "active",
                          recoveryRequired: true,
                        })
                        expect((output as any).metadata.durableTasks.map((task: any) => task.status).sort()).toEqual([
                          "accepted",
                          "failed",
                        ])
                      }
                      yield { type: "tool-result", toolCallId: id, toolName: check.tool, input: check.args, output }
                    }
                    parentVerified = true
                    await expect(
                      ExecutionRuntime.stageCompletion({
                        sessionID: root.id,
                        execution,
                        messageID,
                        finish: "stop",
                        parts: [],
                        editedFiles: [],
                        requiresReview: false,
                      }),
                    ).rejects.toThrow(timeout ? "active_work" : "active_blocker")
                    expect(ExecutionRuntime.completion(execution.executionID)).toBeUndefined()
                    if (mode === "timeout-checkpoint") ExecutionRuntime.requestCheckpoint(execution.executionID)
                    yield {
                      type: "finish-step",
                      finishReason: "tool-calls",
                      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    }
                  } else {
                    const report = timeout
                      ? "Fast task accepted; parent tests passed. Slow task failed at its deadline; artifact absent. Workflow failed as expected. Provider settlement unavailable; no storage search or retry required."
                      : "Sibling task accepted; parent tests passed. Other task failed result validation; artifacts do not prove acceptance. Workflow failed. No storage search required."
                    const checkpoint =
                      input.system.some((text) => text.includes("<checkpoint_context>")) && !checkpointReported
                    if (checkpoint) checkpointReported = true
                    yield { type: "text-start", id: "parent-report" }
                    yield {
                      type: "text-delta",
                      id: "parent-report",
                      text: checkpoint
                        ? JSON.stringify({
                            ...ExecutionCheckpoint.conservativeContinue(),
                            decision: "finish",
                            requestedCalls: undefined,
                            finalResponse: report,
                            completedWork: ["Parent verified fast test"],
                            failures: ["Slow child timed out"],
                            remainingWork: [],
                            blockers: [],
                          })
                        : report,
                    }
                    yield { type: "text-end", id: "parent-report" }
                    yield {
                      type: "finish-step",
                      finishReason: "stop",
                      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                    }
                  }
                  yield { type: "finish" }
                })(),
              } as never
            }
            const stem = session.title.includes("] slugify ") ? "slugify" : "wordCount"
            const childDirectory = mode === "isolation-required" ? Instance.directory : workspace.path
            if (mode === "isolation-required") expect(childDirectory).not.toBe(workspace.path)
            inputs.set(stem, input)
            const count = (calls.get(stem) ?? 0) + 1
            calls.set(stem, count)
            if (count === 1) {
              starts.set(stem, Date.now())
              if (starts.size === 2) release()
              await barrier
            }
            if (stem === "wordCount" && mode === "provider" && count === 1)
              throw new APICallError({
                message: "Simulated HTTP 502",
                url: "https://fake.invalid",
                requestBodyValues: {},
                statusCode: 502,
                isRetryable: true,
              })
            if (stem === "wordCount" && mode === "runtime")
              throw new Error(
                "Execution stopped by runtime constraints: Hedef klasöre yazmak için gerekli araç izni yok.",
              )
            const denied = stem === "wordCount" && ["ownership", "reported-ownership", "permission"].includes(mode)
            const offset = mode === "provider" && stem === "wordCount" ? 1 : 0
            const step = count - offset
            const filePath = path.join(
              childDirectory,
              `test-agents/${denied && mode.includes("ownership") ? "word-count" : stem}${step === 2 ? ".test" : ""}.ts`,
            )
            const content =
              step === 1
                ? stem === "slugify"
                  ? 'export const slugify = (text: string) => text.toLocaleLowerCase("tr").replace(/[çğıöşü]/g, c => ({ç:"c",ğ:"g",ı:"i",ö:"o",ş:"s",ü:"u"})[c]!).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")'
                  : "export const wordCount = (text: string) => text.trim() ? text.trim().split(/\\s+/).length : 0"
                : stem === "slugify"
                  ? 'import {test,expect} from "bun:test"; import {slugify} from "./slugify"; test("Turkish",()=>expect(slugify("ÇĞ Iİ ÖŞÜ")).toBe("cg-ii-osu"))'
                  : 'import {test,expect} from "bun:test"; import {wordCount} from "./wordCount"; test("words",()=>{expect(wordCount(" one two\\nthree ")).toBe(3); expect(wordCount(" ")).toBe(0)})'
            return {
              fullStream: (async function* () {
                if ((timeout && stem === "wordCount") || (!denied && step === 3)) {
                  const id = `${stem}-${count}`
                  const slow = timeout && stem === "wordCount"
                  const args = {
                    command: slow ? "sleep 40" : `bun test ./test-agents/${stem}.test.ts 2>/dev/null`,
                    workdir: childDirectory,
                    description: slow ? "Controlled child delay" : "Verify generated module tests",
                  }
                  yield { type: "tool-call", toolCallId: id, toolName: "bash", input: JSON.stringify(args) }
                  try {
                    const output = await input.tools.bash.execute!(args, {
                      toolCallId: id,
                      abortSignal: input.abort,
                      messages: [],
                    })
                    if (!slow) expect((output as any).metadata.exit).toBe(0)
                    testOutputs.set(stem, (output as any).output)
                    yield { type: "tool-result", toolCallId: id, toolName: "bash", input: args, output }
                    input.abort.throwIfAborted()
                  } finally {
                    if (slow) drained.resolve()
                  }
                  yield {
                    type: "finish-step",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  }
                } else if (step <= (denied ? 1 : 2)) {
                  const id = `${stem}-${count}`
                  const args = { filePath, content }
                  yield { type: "tool-call", toolCallId: id, toolName: "write", input: JSON.stringify(args) }
                  try {
                    const result = await input.tools.write.execute!(args, {
                      toolCallId: id,
                      abortSignal: input.abort,
                      messages: [],
                    })
                    if (mode === "isolation-required")
                      expect(
                        await Bun.file(path.join(workspace.path, path.relative(childDirectory, filePath))).exists(),
                      ).toBe(false)
                    yield { type: "tool-result", toolCallId: id, toolName: "write", input: args, output: result }
                  } catch (error) {
                    if (mode !== "reported-ownership") throw error
                    writeErrors.set(stem, error instanceof Error ? error.message : String(error))
                    yield { type: "tool-error", toolCallId: id, toolName: "write", input: args, error }
                  }
                  yield {
                    type: "finish-step",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
                  }
                } else {
                  const malformedResult =
                    resultCase && stem === "wordCount" && (mode !== "result-repair" || count === 4)
                  if (resultCase && stem === "wordCount" && count > 4) {
                    const prompt = JSON.stringify(input.messages)
                    expect(prompt).toContain("Repair only the agent_result format")
                    expect(prompt).toContain("do not rerun tools or edit files")
                  }
                  yield { type: "text-start", id: stem }
                  yield {
                    type: "text-delta",
                    id: stem,
                    text: `<agent_result>${JSON.stringify({ status: denied ? "blocked" : "complete", summary: `${stem} checked`, failures: malformedResult ? [{ key: "editor-warning", value: "Optional type declaration unavailable", evidence: ["file:1"] }] : denied ? ["Native write did not apply"] : [], facts: denied ? [{ key: "write-denied", value: "Write denied", evidence: [writeErrors.get(stem)] }] : [] })}</agent_result>`,
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
            if (reportFailure)
              await Session.updatePart({
                id: Identifier.ascending("part"),
                sessionID: root.id,
                messageID: userID,
                type: "text",
                text: timeout
                  ? "Report the negative timeout test. Verify fast tests and missing slow artifact. Do not recover the failed workflow. Report unavailable forensic facts without further storage discovery."
                  : "Verify both modules' tests, then report result validation failure. Preserve accepted sibling. Do not recover or waive failed tasks, scan storage, or create more workflows.",
              })
            const report = reportFailure ? await SessionPrompt.loop(root.id) : undefined
            const result = reportFailure
              ? workflowResult!
              : await agent.execute(
                  { action: "workflow", workflow_action: "execute", workflowId: plan.metadata.workflowId },
                  ctx,
                )
            const workflow = WorkflowStateStore.get(plan.metadata.workflowId!)!
            expect(starts.size, result.output).toBe(2)
            expect(workflow.results.slugify.status, result.output).toBe("completed")
            expect(workflow.results.slugify.invocationIDs).toHaveLength(1)
            expect(SubAgent.status(workflow.results.slugify.sessionId!).status).toBe("completed")
            expect(ExecutionRuntime.invocation(workflow.results.slugify.invocationIDs![0])?.state).toBe("completed")
            const childMessages = await Session.messages({ sessionID: workflow.results.slugify.sessionId! })
            expect(
              childMessages
                .flatMap((message) => message.parts)
                .some((part) => part.type === "text" && part.text.includes('<agent_result>{"status":"complete"')),
            ).toBe(true)
            const word = workflow.results.wordCount
            if (timeout) {
              await drained.promise
              expect(result.metadata.status).toBe("failed")
              expect(word.status).toBe("failed")
              expect(word.invocationIDs).toHaveLength(1)
              expect(calls.get("wordCount")).toBe(1)
              expect(SubAgent.status(word.sessionId!).status).toBe("timed_out")
              expect(ExecutionRuntime.invocation(word.invocationIDs![0])?.state).toBe("failed")
              expect(ExecutionRuntime.blocker(`child:${word.invocationIDs![0]}`)?.resolutionCode).toBe("deadline")
              expect(await Bun.file(path.join(workspace.path, "test-agents/wordCount.ts")).exists()).toBe(false)
              expect(ExecutionRuntime.view(execution.executionID)?.unknownWork).toMatchObject([
                { invocationID: word.invocationIDs![0], kind: "tool:bash", state: "unknown" },
              ])
              expect(
                ExecutionRuntime.snapshot(root.id).blockers.some(
                  (blocker) => blocker.kind === "workflow" && blocker.state === "failed",
                ),
              ).toBe(true)
              expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(true)
              expect(
                ExecutionRuntime.finishInvocation({ ...execution, invocationID: word.invocationIDs![0] }, "completed"),
              ).toBe(false)
              expect(ExecutionRuntime.invocation(word.invocationIDs![0])?.state).toBe("failed")
              expect(ExecutionRuntime.invocation(workflow.results.slugify.invocationIDs![0])?.state).toBe("completed")
              expect(ExecutionRuntime.view(execution.executionID)?.outcome).not.toBe("completed")
              expect(parentVerified).toBe(true)
              expect(parentCalls).toBe(2)
              expect(
                report.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
              ).toContain("Provider settlement unavailable")
              expect(report.info).toMatchObject({ finish: "error" })
              expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
                lifecycle: "terminal",
                outcome: "blocked",
                terminalAt: expect.any(Number),
                recoveryRequired: true,
              })
              expect(ExecutionRuntime.completion(execution.executionID)).toMatchObject({
                state: "committed",
                outcome: "blocked",
                projection: "projected",
              })
              expect(
                ExecutionRuntime.tasks(execution.executionID)
                  .map((task) => task.status)
                  .sort(),
              ).toEqual(["accepted", "failed"])
              expect(ExecutionRuntime.invocation(word.invocationIDs![0])?.state).toBe("failed")
              expect(ExecutionRuntime.view(execution.executionID)?.unknownWork).toHaveLength(1)
              expect(workflow.status).toBe("failed")
              expect(calls.get("wordCount")).toBe(1)
              expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(checkpointReported ? 1 : 0)
            } else if (reportFailure) {
              expect(result.metadata.status).toBe("failed")
              expect(word.status).toBe("failed")
              expect(word.error).toContain("agent_result.failures")
              expect(word.invocationIDs).toHaveLength(mode === "result-no-retry" ? 1 : 2)
              expect(calls.get("wordCount")).toBe(mode === "result-no-retry" ? 4 : 5)
              expect(parentVerified).toBe(true)
              expect(parentCalls).toBe(2)
              expect(
                report.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
              ).toContain("failed result validation")
              expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
                lifecycle: "terminal",
                outcome: "blocked",
                terminalAt: expect.any(Number),
              })
              expect(ExecutionRuntime.completion(execution.executionID)).toMatchObject({
                state: "committed",
                outcome: "blocked",
                projection: "projected",
              })
              expect(
                ExecutionRuntime.tasks(execution.executionID)
                  .map((task) => task.status)
                  .sort(),
              ).toEqual(["accepted", "failed"])
              expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(checkpointReported ? 1 : 0)
            } else if (["ownership", "reported-ownership", "permission", "runtime"].includes(mode)) {
              expect(result.metadata.status).toBe("failed")
              expect(word.status).toBe("failed")
              expect(word.invocationIDs).toHaveLength(1)
              expect(result.output).not.toContain("Sub-agent prompt failed")
              expect(SubAgent.status(word.sessionId!).status).toBe(
                mode === "reported-ownership" ? "completed" : "failed",
              )
              expect(await Bun.file(path.join(workspace.path, "test-agents/word-count.ts")).exists()).toBe(false)
              expect(result.output).toContain(
                mode.includes("ownership")
                  ? "outside task ownership"
                  : mode === "permission"
                    ? "prevents you"
                    : "Hedef klasöre yazmak için gerekli araç izni yok.",
              )
              expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(true)
              expect(ExecutionRuntime.completion(execution.executionID)).toBeUndefined()
            } else {
              expect(result.metadata.status, result.output).toBe("completed")
              expect(word.invocationIDs).toHaveLength(mode === "provider" || mode === "result-repair" ? 2 : 1)
              expect(word.invocationIDs?.map((id) => ExecutionRuntime.invocation(id)?.state)).toEqual(
                mode === "provider"
                  ? ["failed", "completed"]
                  : mode === "result-repair"
                    ? ["completed", "completed"]
                    : ["completed"],
              )
              if (mode === "result-repair") expect(calls.get("wordCount")).toBe(5)
              expect(SubAgent.status(word.sessionId!).status).toBe("completed")
              expect(testOutputs.size).toBe(2)
              expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(false)
              expect((await fs.readdir(path.join(workspace.path, "test-agents"))).sort()).toEqual([
                "slugify.test.ts",
                "slugify.ts",
                "wordCount.test.ts",
                "wordCount.ts",
              ])
              for (const task of tasks) {
                const input = inputs.get(task.id)!
                const prompt = JSON.stringify(input.messages)
                expect(prompt).toContain("<task_ownership>")
                expect(prompt).toContain(task.owns[0])
                expect(prompt).toContain(task.owns[1])
                expect(prompt).toContain("not glob patterns")
                for (const tool of ["task", "todowrite", "todoread"]) expect(input.user.tools?.[tool]).toBe(false)
              }
              const staged = await ExecutionRuntime.stageCompletion({
                sessionID: root.id,
                messageID,
                finish: "stop",
                parts: [
                  {
                    id: Identifier.ascending("part"),
                    sessionID: root.id,
                    messageID,
                    type: "text",
                    text: result.output,
                  },
                ],
                editedFiles: tasks.flatMap((task) => task.owns.map((file) => path.join(workspace.path, file))),
                requiresReview: false,
                execution,
              })
              const committed = await ExecutionRuntime.commitCompletion({
                sessionID: root.id,
                execution,
                digest: staged.digest,
              })
              expect(committed.outcome).toBe("completed")
              const claim = ExecutionRuntime.claimCompletion(root.id, execution.executionID)!
              await PromptCompletion.projectCompletion(claim)
              expect(ExecutionRuntime.ackCompletion(claim).projected).toBe(true)
              expect(ExecutionRuntime.completion(execution.executionID)?.projection).toBe("projected")
              expect(ExecutionRuntime.checkpoints(execution.executionID)).toHaveLength(0)
            }
            expect(testOutputs.has("slugify")).toBe(true)
          } finally {
            stream.mockRestore()
            evaluation.mockRestore()
            release()
          }
        },
      })
    },
    30_000,
  )

  test.each(["call_limit", "step_limit"] as const)(
    "native budget stop publishes a durable report: %s",
    async (reason) => {
      await using workspace = await tmpdir({
        config: { experimental: { execution_classification: false }, permission: { "*": "allow" } },
      })
      await Instance.provide({
        directory: workspace.path,
        fn: async () => {
          const session = await Session.create({})
          const model = Object.values((await Provider.getProvider("atomcli"))!.models).find(
            (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
          )!
          const userID = Identifier.ascending("message")
          await Session.updateMessage({
            id: userID,
            sessionID: session.id,
            role: "user",
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            time: { created: Date.now() },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: userID,
            type: "text",
            text: "Verify the result and report any budget blocker.",
          })
          const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
            allowAuxiliarySummaries: false,
            maxRetries: 0,
          } as never)
          const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
            throw new ExecutionRuntime.BudgetExceededError(reason, input.execution!.executionID)
          })
          try {
            const report = await SessionPrompt.loop(session.id)
            const text = report.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
            expect(text).toContain(reason === "call_limit" ? "model-call limit" : "step limit")
            const execution = ExecutionRuntime.list({ sessionID: session.id }).items[0]
            expect(execution).toMatchObject({
              lifecycle: "terminal",
              outcome: "budget_exhausted",
              reason: { code: reason },
            })
            expect(ExecutionRuntime.completion(execution.id)).toMatchObject({
              state: "committed",
              projection: "projected",
            })
            expect(stream).toHaveBeenCalledTimes(1)
          } finally {
            stream.mockRestore()
            evaluation.mockRestore()
          }
        },
      })
    },
    20_000,
  )
}
