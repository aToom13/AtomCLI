import "../preload"
import { expect, spyOn, test } from "bun:test"
import { APICallError } from "@ai-sdk/provider"
import fs from "fs/promises"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Identifier } from "@/core/id/id"
import { LLM } from "@/core/session/llm"
import { Session } from "@/core/session"
import { Provider } from "@/integrations/provider/provider"
import { AgentTool } from "@/integrations/tool/agent-tool"
import { SubAgent } from "@/integrations/tool/subagent"
import { WorkflowStateStore } from "@/integrations/tool/orchestrate/state"
import { PromptCompletion } from "@/core/session/prompt/completion"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("real workflow overlaps siblings, retries one session, preserves failure history, recovers verified artifacts", async () => {
  await using project = await tmpdir({
    config: { experimental: { execution_classification: false, smart_model_routing: false } },
  })
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const parent = await Session.create({})
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const userID = Identifier.ascending("message")
      const messageID = Identifier.ascending("message")
      await Session.updateMessage({
        id: userID,
        sessionID: parent.id,
        role: "user",
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })
      await Session.updateMessage({
        id: messageID,
        parentID: userID,
        sessionID: parent.id,
        role: "assistant",
        agent: "build",
        modelID: model.id,
        providerID: model.providerID,
        path: { cwd: project.path, root: project.path },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: parent.id, invocationID: userID })
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
        sessionID: parent.id,
        messageID,
        agent: "build",
        abort: new AbortController().signal,
        metadata() {},
        async ask(_request: { patterns: string[] }) {},
        extra: { execution, bypassAgentCheck: true },
      }
      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      const sessions = new Set<string>()
      const calls = new Map<string, number>()
      const terminal = new Set<string>()
      const evaluation = spyOn(AgentEval, "executionPolicy").mockReturnValue({
        allowAuxiliarySummaries: false,
        maxRetries: 0,
      } as never)
      const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
        const info = await Session.get(input.sessionID)
        const name = info.title.includes("] b ") ? "b" : info.title.includes("] c ") ? "c" : "a"
        sessions.add(input.sessionID)
        const count = (calls.get(name) ?? 0) + 1
        calls.set(name, count)
        if (name === "c") expect(terminal.has("a")).toBe(true)
        if (name !== "c" && count === 1) {
          if (sessions.size === 2) release()
          await barrier
        }
        if (name === "b" && count === 1)
          throw new APICallError({
            message: "Simulated HTTP 502",
            url: "https://fake.invalid",
            requestBodyValues: {},
            statusCode: 502,
            isRetryable: true,
          })
        if (name === "b") {
          await SubAgent.cancel(input.sessionID)
          throw new Error("Child cancelled during bounded task retry")
        }
        terminal.add(name)
        return {
          fullStream: (async function* () {
            yield { type: "text-start", id: `text-${name}` }
            yield {
              type: "text-delta",
              id: `text-${name}`,
              text: `<agent_result>{"status":"complete","summary":"${name} checked","failures":[]}</agent_result>`,
            }
            yield { type: "text-end", id: `text-${name}` }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            }
            yield { type: "finish" }
          })(),
        } as never
      })
      try {
        const agent = await AgentTool.init()
        expect(agent.description).toContain("Multiple independent tasks: workflow plan+execute")
        const plan = await agent.execute(
          {
            action: "workflow",
            workflow_action: "plan",
            tasks: [
              { id: "a", prompt: "Inspect module A", agent: "coder", owns: ["a.txt"], budget: { maxRetries: 0 } },
              {
                id: "b",
                prompt: "Inspect module B",
                agent: "coder",
                owns: ["b.txt", "b-target.txt"],
                budget: { maxRetries: 2 },
              },
              {
                id: "c",
                prompt: "Inspect module C after A",
                agent: "coder",
                dependsOn: ["a"],
                budget: { maxRetries: 0 },
              },
            ],
          },
          ctx,
        )
        const workflowId = plan.metadata.workflowId
        expect(plan.output).toContain('agent(action="workflow", workflow_action="execute"')
        expect(plan.output).not.toContain("orchestrate(")
        const result = await agent.execute({ action: "workflow", workflow_action: "execute", workflowId }, ctx)
        expect(result.metadata.status).toBe("failed")
        expect(calls.get("a")).toBe(1)
        expect(calls.get("b")).toBe(2)
        expect(calls.get("c")).toBe(1)
        const workflow = WorkflowStateStore.get(workflowId)!
        expect(workflow.results.a.status).toBe("completed")
        expect(workflow.results.c.status).toBe("completed")
        expect(workflow.results.b.invocationIDs).toHaveLength(2)
        const invocations = workflow.results.b.invocationIDs!.map((id) => ExecutionRuntime.invocation(id)!)
        expect(invocations.map((item) => item.state)).toEqual(["failed", "cancelled"])
        expect(new Set(invocations.map((item) => item.sessionID)).size).toBe(1)
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(true)
        const durable = ExecutionRuntime.tasks(execution.executionID).find((item) => item.id.endsWith(":b"))!
        const recovery = {
          taskId: "b",
          expectedVersion: durable.version,
          expectedRevision: durable.revision,
          artifacts: ["b.txt"],
          verificationCommand: "test -s b.txt",
        }
        await Bun.write(`${project.path}/a.txt`, "Another task's artifact")
        await fs.symlink("a.txt", `${project.path}/b.txt`)
        await expect(
          agent.execute({ action: "workflow", workflow_action: "recover", workflowId, recovery }, ctx),
        ).rejects.toThrow("Recovery artifact is outside task ownership")
        expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === durable.id)?.status).toBe(
          "failed",
        )
        await fs.unlink(`${project.path}/b.txt`)
        await Bun.write(`${project.path}/b-target.txt`, "Owned artifact with denied read permission")
        await fs.symlink("b-target.txt", `${project.path}/b.txt`)
        ctx.ask = async (request) => {
          if (request.patterns.includes(`${project.path}/b-target.txt`))
            throw new Error("Resolved artifact read denied")
        }
        await expect(
          agent.execute({ action: "workflow", workflow_action: "recover", workflowId, recovery }, ctx),
        ).rejects.toThrow("Resolved artifact read denied")
        expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === durable.id)?.status).toBe(
          "failed",
        )
        ctx.ask = async () => {}
        await fs.unlink(`${project.path}/b.txt`)
        await Bun.write(`${project.path}/b.txt`, "verified alternative result")
        await expect(
          agent.execute(
            {
              action: "workflow",
              workflow_action: "recover",
              workflowId,
              recovery: { ...recovery, verificationCommand: "false" },
            },
            ctx,
          ),
        ).rejects.toThrow("Recovery verification failed")
        expect(ExecutionRuntime.tasks(execution.executionID).find((item) => item.id === durable.id)?.status).toBe(
          "failed",
        )
        await agent.execute({ action: "workflow", workflow_action: "recover", workflowId, recovery }, ctx)
        expect(WorkflowStateStore.get(workflowId)?.status).toBe("completed")
        expect(ExecutionRuntime.hasUnresolvedExecutionTaskflow(execution.executionID)).toBe(false)
        expect(invocations.map((item) => ExecutionRuntime.invocation(item.id)?.state)).toEqual(["failed", "cancelled"])
        expect(ExecutionRuntime.checkpoints(execution.executionID).length).toBeLessThanOrEqual(3)
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: parent.id,
          messageID,
          finish: "stop",
          parts: [
            {
              id: Identifier.ascending("part"),
              sessionID: parent.id,
              messageID,
              type: "text",
              text: "All tasks verified; failed delegation recovered.",
            },
          ],
          editedFiles: [`${project.path}/b.txt`],
          requiresReview: false,
          execution,
        })
        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: parent.id,
          execution,
          digest: staged.digest,
        })
        expect(committed.outcome).toBe("completed")
        const claim = ExecutionRuntime.claimCompletion(parent.id, execution.executionID)!
        await PromptCompletion.projectCompletion(claim)
        expect(ExecutionRuntime.completion(execution.executionID)?.state).toBe("committed")
        expect(ExecutionRuntime.ackCompletion(claim).projected).toBe(true)
        expect(ExecutionRuntime.completion(execution.executionID)?.projection).toBe("projected")
        expect(
          (await Session.messages({ sessionID: parent.id })).find((item) => item.info.id === messageID)?.info,
        ).toMatchObject({ finish: "stop" })
        for (const sessionID of sessions)
          await AgentEval.recordSession(sessionID, await Session.messages({ sessionID }))
      } finally {
        stream.mockRestore()
        evaluation.mockRestore()
        release()
      }
    },
  })
}, 30_000)
