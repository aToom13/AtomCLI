import "../preload"
import { expect, spyOn, test } from "bun:test"
import { AgentEval } from "@/core/eval/harness"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { SessionProcessor } from "@/core/session/processor"
import { SessionPrompt } from "@/core/session/prompt"
import { LLM } from "@/core/session/llm"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionClassifier } from "@/core/routing/execution-classifier"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PromptFinalization } from "@/core/session/prompt/finalization"
import { SkillTool } from "@/integrations/tool/skill"

test("required skill selection completes before implementation tools are advertised", async () => {
  await using tmp = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
  await Bun.write(
    `${tmp.path}/.atomcli/skills/game-development/SKILL.md`,
    "---\nname: game-development\ndescription: Games\n---\nUse [renderer](references/renderer.md).",
  )
  await Bun.write(
    `${tmp.path}/.atomcli/skills/game-development/references/renderer.md`,
    "Projection and spatial controls.",
  )
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find((item) => item.capabilities.toolcall)!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Build a complete browser OS with functional 3D games using game-development",
      })
      let turns = 0
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              turns++
              if (turns === 2) {
                for (const name of ["write", "edit", "bash"]) expect(stream.tools[name]).toBeDefined()
                throw new Error("Preparation visibility verified")
              }
              expect(stream.tools.skill).toBeDefined()
              for (const name of ["write", "edit", "bash", "browser", "agent"])
                expect(stream.tools[name]).toBeUndefined()
              const args = { name: "game-development", references: ["references/renderer.md"], reason: "3D rendering" }
              const result = await (
                await SkillTool.init()
              ).execute(args, {
                sessionID: session.id,
                messageID: input.assistantMessage.id,
                callID: "prepare",
                agent: "agent",
                abort: stream.abort,
                metadata: () => {},
                ask: async () => {},
              } as never)
              await Session.updatePart({
                id: Identifier.ascending("part"),
                sessionID: session.id,
                messageID: input.assistantMessage.id,
                type: "tool",
                tool: "skill",
                callID: "prepare",
                state: { status: "completed", input: args, ...result, time: { start: Date.now(), end: Date.now() } },
              })
              input.assistantMessage.finish = "tool-calls"
              await Session.updateMessage(input.assistantMessage)
              return { status: "continue", terminalFinish: "tool-calls" }
            },
          }) as never,
      )
      try {
        await expect(SessionPrompt.loop(session.id)).rejects.toThrow("Preparation visibility verified")
        expect(turns).toBe(2)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
      }
    },
  })
}, 30_000)

test.each([
  [
    '<｜DSML｜invoke name="bash"><｜DSML｜parameter name="command">bun run build</｜DSML｜parameter></｜DSML｜invoke>',
    2,
  ],
  ['<invoke name="bash">bun run build</invoke>', 2],
  ["Build finished; browser verification remains.", 1],
] as const)("tool-free finalization reports durable stop reason for %s", async (text, expectedTurns) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Final report test" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Build browser game",
      })
      const admission = spyOn(ExecutionRuntime, "admitStep").mockImplementation(async (input) => {
        throw new ExecutionRuntime.BudgetExceededError("step_limit", input.execution!.executionID)
      })
      const allowance = spyOn(ExecutionRuntime, "allowance").mockReturnValue({
        extensions: ExecutionCheckpoint.MAX_EXTENSIONS,
      } as never)
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      let executionID = ""
      let reportTurns = 0
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream, options) {
              reportTurns++
              expect(Object.keys(stream.tools)).toEqual([])
              expect(stream.finalizationOnly).toBe(true)
              expect(options.deferText).toBe(true)
              expect(stream.system.join("\n")).not.toContain("If the user actually asked for work that needs tools")
              executionID = stream.execution.executionID
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
                    text,
                  },
                ],
              }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(reportTurns).toBe(expectedTurns)
        const messages = await Session.messages({ sessionID: session.id })
        const assistants = messages.filter((message) => message.info.role === "assistant")
        expect(assistants).toHaveLength(1)
        expect(assistants[0].info).toMatchObject({ finish: "error" })
        const report = assistants[0].parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(report).toContain("Execution step limit reached.")
        expect(PromptFinalization.isUserFacingReport(report)).toBe(true)
        expect(report).not.toContain("invoke")
        expect(ExecutionRuntime.view(executionID)).toMatchObject({ lifecycle: "terminal", outcome: "budget_exhausted" })
      } finally {
        processor.mockRestore()
        policy.mockRestore()
        allowance.mockRestore()
        admission.mockRestore()
      }
    },
  })
})

test("a direct greeting advertises read and controls in the real prompt turn", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Tool availability test" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Selam",
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              expect(Object.keys(stream.tools).sort()).toEqual([
                "invalid",
                "model_control",
                "read",
                "scope_control",
                "skill",
              ])
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(processor).toHaveBeenCalledTimes(1)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
      }
    },
  })
})

test.each([
  ["explicit delegation", "Please spawn two subagents in parallel to build the two modules", undefined, "coordinated"],
  ["coordinated workflow", "Inspect the workflow across the API, CLI and SDK", "coordinated", "coordinated"],
  ["direct workflow", "Inspect the workflow", "direct", "focused"],
  ["focused workflow", "Inspect the workflow", "focused", "focused"],
] as const)("%s preserves required scope and tools", async (_name, prompt, classifiedScope, expectedScope) => {
  await using tmp = await tmpdir({
    git: true,
    config: { experimental: { execution_classification: classifiedScope !== undefined } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Coordinated advertised set" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: prompt,
      })
      const classifier = spyOn(ExecutionClassifier, "classify").mockResolvedValue({
        contract: ExecutionContract.fallback("fixture classifier", { scope: classifiedScope ?? "focused" }),
        durationMs: 0,
        cached: false,
        fallback: false,
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              const ids = Object.keys(stream.tools)
              const contract = ExecutionRuntime.getExecutionContract(stream.execution.executionID)
              expect(contract?.scope).toBe(expectedScope)
              expect(ids.includes("agent")).toBe(expectedScope === "coordinated")
              expect(ids.includes("todo")).toBe(expectedScope === "coordinated")
              expect(ids).not.toContain("taskflow")
              expect(ids).not.toContain("orchestrate")
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(processor).toHaveBeenCalledTimes(1)
        expect(classifier).toHaveBeenCalledTimes(classifiedScope ? 1 : 0)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
        classifier.mockRestore()
      }
    },
  })
})

test("a focused work prompt that asks for a checklist advertises the visible todo tool", async () => {
  await using tmp = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Focused checklist" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Keep a todo checklist: fix the parser, then add a regression test",
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              const ids = Object.keys(stream.tools)
              const contract = ExecutionRuntime.getExecutionContract(stream.execution.executionID)
              expect(contract?.scope).toBe("focused")
              expect(ids).toContain("todo")
              expect(ids).not.toContain("agent")
              expect(ids).not.toContain("taskflow")
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(processor).toHaveBeenCalledTimes(1)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
      }
    },
  })
})

test("a focused file-edit turn without a checklist keeps taskflow and orchestration tools hidden", async () => {
  await using tmp = await tmpdir({ git: true, config: { experimental: { execution_classification: false } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Focused edit without checklist" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Update the parser in src/parser.ts to handle empty input",
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              const ids = Object.keys(stream.tools)
              const contract = ExecutionRuntime.getExecutionContract(stream.execution.executionID)
              expect(contract?.scope).toBe("focused")
              expect(ids).toContain("edit")
              const editSchema = stream.tools.edit.inputSchema.jsonSchema
              for (const field of ["oldString", "newString", "replaceAll"])
                expect(editSchema.properties).not.toHaveProperty(field)
              expect(editSchema.required).toContain("operations")
              expect(editSchema.properties.operations.minItems).toBe(1)
              expect(editSchema.properties.operations.items.properties).toHaveProperty("oldString")
              expect(editSchema.properties.operations.items.properties).toHaveProperty("newString")
              for (const shape of [editSchema, editSchema.properties.operations.items]) {
                for (const field of ["contentHash", "startAnchor", "endAnchor"])
                  expect(shape.properties).not.toHaveProperty(field)
              }
              expect(ids).not.toContain("todo")
              expect(ids).not.toContain("agent")
              expect(ids).not.toContain("taskflow")
              expect(ids).not.toContain("orchestrate")
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(processor).toHaveBeenCalledTimes(1)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
      }
    },
  })
})

test("Devam keeps tools and intent from unfinished prior execution", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Continuation test" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const modelRef = { providerID: model.providerID, modelID: model.id }
      const prior = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: modelRef,
        time: { created: Date.now() },
      })
      const previous = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: prior.id })
      ExecutionRuntime.setExecutionContract(
        previous.executionID,
        ExecutionContract.fallback("browser game", {
          intent: "design",
          scope: "focused",
          needsMutation: true,
          expectedSurfaces: ["workspace", "browser"],
        }),
      )
      ExecutionRuntime.cancelExecution(previous)
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: modelRef,
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Devam",
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process(stream) {
              const contract = ExecutionRuntime.getExecutionContract(stream.execution.executionID)
              expect(contract).toMatchObject({ intent: "design", scope: "focused", needsMutation: true })
              expect(Object.keys(stream.tools)).toContain("edit")
              expect(Object.keys(stream.tools)).toContain("write")
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        expect(processor).toHaveBeenCalledTimes(1)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
      }
    },
  })
})

test("dispatch filter removes user-disabled tools after prompt resolution", async () => {
  const tools = { read: {}, write: {}, edit: {} } as never
  const filtered = await LLM.filterToolsForDispatch({
    tools,
    user: { tools: { edit: false } } as never,
    agent: { name: "build", permission: [] } as never,
  })
  expect(Object.keys(filtered).sort()).toEqual(["read", "write"])
})

test("step limit enters checkpoint turn without repeatedly rejecting admission", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Step admission test" })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: "Selam",
      })
      const originalAdmitStep = ExecutionRuntime.admitStep
      let attempts = 0
      const admission = spyOn(ExecutionRuntime, "admitStep").mockImplementation(async (input) => {
        if (++attempts === 1) throw new ExecutionRuntime.BudgetExceededError("step_limit", input.execution!.executionID)
        return originalAdmitStep(input)
      })
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process() {
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(session.id)
        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.filter((message) => message.info.role === "assistant")).toHaveLength(1)
        expect(attempts).toBe(1)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
        admission.mockRestore()
      }
    },
  })
})

test("child step-limit report leaves parent execution active", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({ title: "Parent" })
      const child = await Session.create({ title: "Child", parentID: parent.id })
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const parentUser = Identifier.ascending("message")
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: parentUser })
      await ExecutionRuntime.inheritSession(parent.id, child.id)
      const childUser = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: child.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: child.id,
        messageID: childUser.id,
        type: "text",
        text: "Build the page",
      })
      const admission = spyOn(ExecutionRuntime, "admitStep").mockImplementation(async (input) => {
        throw new ExecutionRuntime.BudgetExceededError("step_limit", input.execution!.executionID)
      })
      const allowance = spyOn(ExecutionRuntime, "allowance").mockReturnValue({
        extensions: ExecutionCheckpoint.MAX_EXTENSIONS,
      } as never)
      const policy = spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as never)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            partFromToolCall: () => undefined,
            async process() {
              input.assistantMessage.finish = "stop"
              return { status: "stop" }
            },
          }) as never,
      )
      try {
        await SessionPrompt.loop(child.id)
        expect(ExecutionRuntime.view(execution.executionID)?.lifecycle).toBe("active")
        const retry = await ExecutionRuntime.resolveInvocation({
          sessionID: child.id,
          invocationID: Identifier.ascending("message"),
          kind: "child",
        })
        expect(retry.executionID).toBe(execution.executionID)
      } finally {
        processor.mockRestore()
        policy.mockRestore()
        allowance.mockRestore()
        admission.mockRestore()
      }
    },
  })
})
