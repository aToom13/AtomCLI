import "../preload"
import { expect, test } from "bun:test"
import path from "path"
import { StaticCheckTool } from "@/integrations/tool/static-check"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("static failures are failed evidence; source inspection never dirties artifacts or leaves unknown work", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const messageID = Identifier.ascending("message")
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
      ExecutionRuntime.setExecutionContract(execution.executionID, ExecutionContract.fallback("static evidence test"))
      const tool = await StaticCheckTool.init()
      const revision = ExecutionRuntime.mutationRevision(execution.executionID)
      const check = (args: { content?: string; file?: string }, callID: string) =>
        ToolRuntime.execute({
          tool: "static_check",
          args,
          mutating: tool.mutating,
          effects: tool.effects,
          context: {
            sessionID: session.id,
            messageID,
            callID,
            agent: "build",
            abort: new AbortController().signal,
            ask: async () => {},
            metadata: async () => {},
            extra: { execution },
          },
          execute: (args, context) => tool.execute(args, context),
        })
      const failed = await check({ content: "const repeated = 1; const repeated = 2" }, "duplicate")
      expect(failed.metadata.status).toBe("failed")
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.failureCount).toBe(1)
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.successfulToolCalls ?? 0).toBe(0)
      await expect(check({ file: path.join(tmp.path, "missing.js") }, "missing")).rejects.toThrow()
      expect((await check({ content: "const valid = 1" }, "valid")).metadata.status).toBe("passed")
      expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)?.successfulToolCalls).toBe(1)
      expect(ExecutionRuntime.mutationRevision(execution.executionID)).toBe(revision)
      expect(ExecutionRuntime.view(execution.executionID)?.unknownWork).toHaveLength(0)
    },
  })
})
