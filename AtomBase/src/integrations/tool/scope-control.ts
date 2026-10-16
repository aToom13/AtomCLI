import z from "zod"
import { Config } from "@/core/config/config"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { Tool } from "./tool"

export namespace ScopeControl {
  export const Info = Tool.define("scope_control", {
    description:
      "Inspect or increase this execution scope. Only the main conversation may escalate or reset. Use status first when a task may need cross-module work, sub-agents, or a durable workflow. Escalation is monotonic and requires a concrete reason; never claim it succeeded until runtime confirms it.",
    parameters: z.object({
      action: z.enum(["status", "escalate", "reset"]),
      target: ExecutionContract.Scope.optional(),
      reason: z.string().trim().max(1000).optional(),
    }),
    async execute(args, ctx) {
      const execution = ctx.extra?.execution as ExecutionRuntime.Context | undefined
      if (!execution) throw new Error("Scope control requires an active execution")
      if (args.action === "status") {
        const policy = ExecutionRuntime.getExecutionPolicy(execution.executionID)
        const contract = ExecutionRuntime.getExecutionContract(execution.executionID)
        const config = await Config.get()
        const settings = config.experimental?.scope_escalation
        const escalation = ExecutionRuntime.scopeEscalationStatus(ctx.sessionID)
        const max = settings?.max_per_session ?? 20
        const cooldownMs = settings?.cooldown_ms ?? 0
        const scope = policy?.scope ?? "focused"
        const nextScope = scope === "direct" ? "focused" : scope === "focused" ? "coordinated" : null
        return {
          title: "Execution scope",
          output: JSON.stringify({
            scope,
            floor: await SessionScopeFloor.merge(ctx.sessionID, "direct"),
            allowedTools: policy?.allowedTools,
            budget: policy?.budget,
            nextScope,
            nextPolicyTools: nextScope
              ? (ExecutionPolicy.selectAllowedTools(
                  nextScope,
                  contract?.intent ?? "change",
                  contract?.expectedSurfaces,
                  contract?.needsMutation,
                ) ?? "all registered tools")
              : null,
            nextAllowsSubagents: nextScope ? ExecutionPolicy.BUDGETS[nextScope].allowSubagents : false,
            escalation: {
              mode: settings?.mode ?? "ask",
              used: escalation.count,
              max,
              remaining: Math.max(0, max - escalation.count),
              cooldownUntil: escalation.last_at ? escalation.last_at + cooldownMs : null,
            },
          }),
          metadata: { error: false, scope, changed: false },
        }
      }
      if (ctx.sessionID !== execution.rootSessionID)
        throw new Error("Only the main conversation may change execution scope")
      const config = await Config.get()
      const mode = config.experimental?.scope_escalation?.mode ?? "ask"
      if (args.action === "reset") {
        if (mode === "off") throw new Error("Scope escalation is disabled")
        if (mode === "ask") {
          await ctx.ask({ permission: "scope_escalation", metadata: {}, patterns: ["reset"], always: ["*"] })
        }
        await SessionScopeFloor.reset(ctx.sessionID)
        const scope = ExecutionRuntime.getExecutionPolicy(execution.executionID)?.scope ?? "focused"
        return {
          title: "Execution scope reset",
          output: `Session scope floor reset for future turns; current execution remains ${scope}.`,
          metadata: { error: false, scope, changed: true },
        }
      }
      if (!args.target || args.target === "direct") throw new Error("Escalation target must be focused or coordinated")
      if (!args.reason) throw new Error("Scope escalation requires a concrete reason")
      if (mode === "off") throw new Error("Scope escalation is disabled")
      if (mode === "ask") {
        await ctx.ask({ permission: "scope_escalation", metadata: {}, patterns: [args.target], always: ["*"] })
      }
      const result = await ExecutionRuntime.escalateScope({
        sessionID: ctx.sessionID,
        execution,
        scope: args.target,
        reason: args.reason,
        actorID: ctx.agent ?? "model",
      })
      return {
        title: result.changed ? "Execution scope escalated" : "Execution scope unchanged",
        output: result.changed
          ? `Scope ${result.scope} approved by runtime; tools refresh on next step.`
          : `Execution already has ${result.scope} scope.`,
        metadata: { error: false, scope: result.scope, changed: result.changed },
      }
    },
  })
}
