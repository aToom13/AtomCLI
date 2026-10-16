import "../preload"
import { expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { PromptCompletion } from "@/core/session/prompt/completion"
import { HarnessState } from "@/core/session/harness-state"
import { BashTool } from "@/integrations/tool/bash"
import { EditTool } from "@/integrations/tool/edit"
import { ReadTool } from "@/integrations/tool/read"
import { tmpdir } from "../fixture/fixture"
import type { MessageV2 } from "@/core/session/message-v2"
import { Config } from "@/core/config/config"
import { SessionPrompt } from "@/core/session/prompt"
import { SessionProcessor } from "@/core/session/processor"
import { AgentEval } from "@/core/eval/harness"
import { Provider } from "@/integrations/provider/provider"

test.each([
  { correct: false, checkpoint: false, retry: false },
  { correct: false, checkpoint: true, retry: false },
  { correct: false, checkpoint: true, retry: true },
  { correct: true, checkpoint: false, retry: false },
  { correct: true, checkpoint: true, retry: false },
])("completion checks actual requested directory, not checkpoint prose: %j", async ({ correct, checkpoint, retry }) => {
  await using project = await tmpdir({ config: Config.Info.parse({ review: { auto: false } }) })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const session = await Session.create({})
      const user = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "test", modelID: "fixture" },
      })) as MessageV2.User
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "`test-debug` klasöründe TypeScript fonksiyonunu oluştur. Testleri çalıştır.",
      })
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback())
      const messageID = Identifier.ascending("message")
      await Session.updateMessage({
        id: messageID,
        sessionID: session.id,
        parentID: user.id,
        role: "assistant",
        agent: "build",
        modelID: "fixture",
        providerID: "test",
        path: { cwd: project.path, root: project.path },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      const target = path.join(project.path, "test-debug")
      const context = {
        sessionID: session.id,
        messageID,
        agent: "build",
        abort: new AbortController().signal,
        ask: async () => {},
        metadata: () => {},
      }
      const bash = await BashTool.init()
      await bash.execute({ command: "mkdir test-debug", description: "Create requested directory" }, context)
      const source = path.join(correct ? target : project.path, "uniqueNumbers.ts")
      await Bun.write(source, "export const value = 1\n")
      const read = await ReadTool.init()
      const readResult = await read.execute({ filePath: source }, context)
      const edit = await EditTool.init()
      await edit.execute(
        {
          filePath: source,
          oldString: "value = 1",
          newString: "value = 2",
          contentHash: readResult.metadata.contentHash,
        },
        context,
      )
      HarnessState.addEditedFile(session.id, source)
      if (checkpoint) {
        const result = ExecutionCheckpoint.conservativeContinue("Create requested deliverable")
        result.remainingWork = ["Confirm files really exist inside test-debug", "Verify tests"]
        result.blockers = ["Model-generated uncertainty is advisory, not an execution gate"]
        ExecutionRuntime.applyCheckpoint(execution.executionID, "file-location", result)
      }
      const candidate = await ExecutionRuntime.stageCompletion({
        sessionID: session.id,
        execution,
        messageID,
        finish: "stop",
        requiresReview: false,
        editedFiles: [source],
        parts: [
          {
            id: Identifier.ascending("part"),
            messageID,
            sessionID: session.id,
            type: "text",
            text: `\`${target}\` içinde fonksiyon düzeltildi. \`uniqueNumbers.ts\`: başarılı.`,
          },
        ],
      })
      const outcome = await PromptCompletion.resolveCompletion({
        sessionID: session.id,
        lastUser: user,
        execution,
        candidate,
        abort: context.abort,
        allowRetry: retry,
      })
      if (outcome !== "retry")
        ExecutionRuntime.finishInvocation(execution, outcome === "committed" ? "completed" : "failed")
      expect(outcome).toBe(correct ? "committed" : retry ? "retry" : "blocked")
      const view = ExecutionRuntime.view(execution.executionID)!
      expect(view.lifecycle).toBe(!correct && retry ? "active" : "terminal")
      if (!correct && retry) {
        const continuation = (await Session.messages({ sessionID: session.id })).at(-1)!
        const text = continuation.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(text).toContain("test-debug")
        expect(text).toContain("uniqueNumbers.ts")
        expect(text).not.toContain("independent review did not pass")
      } else {
        expect(view.outcome).toBe(correct ? "completed" : "budget_exhausted")
        expect(ExecutionRuntime.completion(execution.executionID)?.state).toBe("committed")
        expect(ExecutionRuntime.completion(execution.executionID)?.reviewRequirement).toBe("not_required")
        expect(ExecutionRuntime.snapshot(session.id).activeInvocations).toHaveLength(0)
      }
      if (!correct && !retry) {
        const texts = (await Session.messages({ sessionID: session.id }))
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(texts).toContain("test-debug")
        expect(texts).not.toContain("içinde fonksiyon düzeltildi")
      }
    },
  })
})

test.each([false, true])(
  "native prompt verifies file placement before terminal success: repair=%s",
  async (repair) => {
    await using project = await tmpdir({ config: { experimental: { execution_classification: false } } })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const provider = (await Provider.getProvider("atomcli"))!
        const model = Object.values(provider.models).find(
          (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
        )!
        const target = path.join(project.path, "test-debug")
        const fixed =
          "export function uniqueNumbers(numbers: number[]): number[] {\n  return numbers.filter((number, index) => numbers.indexOf(number) === index)\n}\n"
        const broken = fixed.replace("===", "!==")
        const tests =
          'import {test,expect} from "bun:test"\nimport {uniqueNumbers} from "./uniqueNumbers"\ntest("first-seen order",()=>expect(uniqueNumbers([3,1,3,2,1])).toEqual([3,1,2]))\n'
        let turns = 0
        let calls = 0
        const evaluations = spyOn(AgentEval, "executionPolicy").mockReturnValue({
          allowAuxiliarySummaries: false,
        } as never)
        const processor = spyOn(SessionProcessor, "create").mockImplementation(
          (input) =>
            ({
              message: input.assistantMessage,
              partFromToolCall: () => undefined,
              async process(stream, options) {
                if (options.captureCheckpointReasoning) {
                  const checkpoint = ExecutionCheckpoint.conservativeContinue("Verify requested directory")
                  checkpoint.requestedCalls = 4
                  return {
                    status: "continue",
                    terminalFinish: "stop",
                    deferredTextParts: [
                      {
                        id: Identifier.ascending("part"),
                        sessionID: session.id,
                        messageID: input.assistantMessage.id,
                        type: "text",
                        text: JSON.stringify(checkpoint),
                      },
                    ],
                  }
                }
                turns++
                expect(options.deferText).toBe(true)
                const call = async (tool: string, args: unknown) => {
                  const callID = `${tool}-${turns}-${++calls}`
                  const result = await stream.tools[tool].execute(args, {
                    toolCallId: callID,
                    abortSignal: stream.abort,
                    messages: [],
                  })
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    sessionID: session.id,
                    messageID: input.assistantMessage.id,
                    type: "tool",
                    tool,
                    callID,
                    state: {
                      status: "completed",
                      input: args as Record<string, unknown>,
                      title: result.title,
                      output: result.output,
                      metadata: result.metadata,
                      time: { start: Date.now(), end: Date.now() },
                    },
                  })
                  return result
                }
                const directory = repair && turns === 1 ? project.path : target
                if (turns === 1)
                  await call("bash", { command: "mkdir test-debug", description: "Create requested folder" })
                await call("write", {
                  filePath: path.join(directory, "uniqueNumbers.ts"),
                  content: turns === 1 ? broken : fixed,
                })
                await call("write", { filePath: path.join(directory, "uniqueNumbers.test.ts"), content: tests })
                HarnessState.addEditedFile(session.id, path.join(directory, "uniqueNumbers.ts"))
                HarnessState.addEditedFile(session.id, path.join(directory, "uniqueNumbers.test.ts"))
                if (turns === 1) {
                  const failed = await call("bash", {
                    command: "bun test ./uniqueNumbers.test.ts",
                    workdir: directory,
                    description: "Observe failing test first",
                  })
                  expect(failed.metadata.exit).toBe(1)
                  const read = await call("read", { filePath: path.join(directory, "uniqueNumbers.ts") })
                  await call("edit", {
                    filePath: path.join(directory, "uniqueNumbers.ts"),
                    oldString: "!==",
                    newString: "===",
                    contentHash: read.metadata.contentHash,
                  })
                }
                const passed = await call("bash", {
                  command: "bun test ./uniqueNumbers.test.ts",
                  workdir: directory,
                  description: "Verify corrected function",
                })
                expect(passed.metadata.exit).toBe(0)
                input.assistantMessage.finish = "stop"
                return {
                  status: "continue",
                  terminalFinish: "stop",
                  deferredTextParts: [
                    {
                      id: Identifier.ascending("part"),
                      sessionID: session.id,
                      messageID: input.assistantMessage.id,
                      type: "text",
                      text: `Created and tested \`uniqueNumbers.ts\` in \`${target}\`.`,
                    },
                  ],
                }
              },
            }) as never,
        )
        try {
          const result = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "agent",
            model: { providerID: model.providerID, modelID: model.id },
            parts: [
              {
                type: "text",
                text: "Create the TypeScript function in `test-debug`. Write a failing test, fix duplicate removal, run tests.",
              },
            ],
          })
          expect(turns).toBe(repair ? 2 : 1)
          expect(result.parts.some((part) => part.type === "text" && part.text.includes("Created and tested"))).toBe(
            true,
          )
          expect(await Bun.file(path.join(target, "uniqueNumbers.ts")).text()).toBe(fixed)
          expect(await Bun.file(path.join(target, "uniqueNumbers.test.ts")).text()).toBe(tests)
          expect(await Session.children(session.id)).toHaveLength(0)
          const execution = ExecutionRuntime.list({ sessionID: session.id }).items[0]
          expect(execution).toMatchObject({ lifecycle: "terminal", outcome: "completed" })
          expect(ExecutionRuntime.snapshot(session.id).activeInvocations).toHaveLength(0)
          expect(ExecutionRuntime.completion(execution.id)).toMatchObject({
            state: "committed",
            projection: "projected",
            reviewRequirement: "not_required",
            requiresReview: false,
          })
          const messages = await Session.messages({ sessionID: session.id })
          const finals = messages
            .flatMap((message) => message.parts)
            .filter((part) => part.type === "text" && part.text.includes("Created and tested"))
          expect(finals).toHaveLength(1)
        } finally {
          processor.mockRestore()
          evaluations.mockRestore()
        }
      },
    })
  },
  20_000,
)

test("failed verification survives synthetic completion retry and loss of in-memory logs", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const session = await Session.create({})
      const user = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "test", modelID: "fixture" },
      })) as MessageV2.User
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
      const messageID = Identifier.ascending("message")
      await Session.updateMessage({
        id: messageID,
        sessionID: session.id,
        parentID: user.id,
        role: "assistant",
        agent: "build",
        providerID: "test",
        modelID: "fixture",
        path: { cwd: project.path, root: project.path },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      await Bun.write(
        path.join(project.path, "broken.test.ts"),
        'import {test,expect} from "bun:test"\ntest("broken",()=>expect(false).toBe(true))\n',
      )
      const context = {
        sessionID: session.id,
        messageID,
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
      const args = { command: "bun test ./broken.test.ts", description: "Verify actual failing behavior" }
      const checked = await (await BashTool.init()).execute(args, context)
      expect(checked.metadata.exit).toBe(1)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID,
        sessionID: session.id,
        type: "tool",
        tool: "bash",
        callID: "failed-verification",
        state: {
          status: "completed",
          input: args,
          title: checked.title,
          output: checked.output,
          metadata: checked.metadata,
          time: { start: Date.now(), end: Date.now() },
        },
      })
      const candidate = await ExecutionRuntime.stageCompletion({
        sessionID: session.id,
        execution,
        messageID,
        finish: "stop",
        parts: [],
        editedFiles: [],
        requiresReview: false,
      })
      expect(
        await PromptCompletion.resolveCompletion({
          sessionID: session.id,
          lastUser: user,
          execution,
          candidate,
          abort: context.abort,
        }),
      ).toBe("retry")
      const continuation = (await Session.messages({ sessionID: session.id })).at(-1)!.info as MessageV2.User
      const continued = await ExecutionRuntime.bindContinuation({
        sessionID: session.id,
        invocationID: continuation.id,
        execution,
      })
      HarnessState.reset(session.id)
      const retried = await ExecutionRuntime.stageCompletion({
        sessionID: session.id,
        execution: continued,
        messageID: Identifier.ascending("message"),
        finish: "stop",
        parts: [],
        editedFiles: [],
        requiresReview: false,
      })
      expect(
        await PromptCompletion.resolveCompletion({
          sessionID: session.id,
          lastUser: continuation,
          execution: continued,
          candidate: retried,
          abort: context.abort,
          allowRetry: false,
        }),
      ).toBe("blocked")
      expect(ExecutionRuntime.view(execution.executionID)?.outcome).not.toBe("completed")
      ExecutionRuntime.finishInvocation(continued, "failed")
      expect(ExecutionRuntime.snapshot(session.id).activeInvocations).toHaveLength(0)
    },
  })
})
