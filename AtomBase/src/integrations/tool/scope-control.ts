import z from "zod"
import { Config } from "@/core/config/config"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { SessionScopeFloor } from "@/core/session/scope-floor"
import { MCP } from "@/integrations/mcp"
import { Global } from "@/core/global"
import { Auth } from "@/services/auth"
import { Provider } from "@/integrations/provider/provider"
import path from "node:path"
import { Tool } from "./tool"

export namespace ScopeControl {
  export async function diagnostics(model?: { providerID: string; id?: string; modelID?: string }) {
    const config = await Config.get()
    const provider = model ? await Provider.getProvider(model.providerID) : undefined
    const stored = model ? await Auth.get(model.providerID) : undefined
    return {
      paths: {
        root: Global.Path.root,
        config: Global.Path.config,
        data: Global.Path.data,
        auth: path.join(Global.Path.data, "auth.json"),
      },
      testHomeOverride: Boolean(process.env.ATOMCLI_TEST_HOME),
      configOverrides: {
        content: Boolean(process.env.ATOMCLI_CONFIG_CONTENT),
        file: Boolean(process.env.ATOMCLI_CONFIG),
      },
      currentModel: model ? { providerID: model.providerID, modelID: model.id ?? model.modelID } : null,
      provider: model
        ? {
            resolved: Boolean(provider),
            source: provider?.source ?? null,
            configured: Boolean(config.provider?.[model.providerID]),
            environmentCredentialPresent: Boolean(provider?.env.some((key) => Boolean(process.env[key]))),
            storedEntry: stored ? "present" : "not_observed",
            storedType: stored?.type ?? null,
          }
        : null,
      availability: "unverified",
      note: "No network probe. Missing stored or environment credentials do not prove access unavailable; config, OAuth, custom loaders and public providers may supply access. Provider errors must retain their actual reason.",
    }
  }

  export const Info = Tool.define("scope_control", {
    description:
      "Inspect execution scope, actual runtime/config/auth paths and secret-safe provider source diagnostics. Use status before diagnosing missing credentials. If classification omitted edit/write needed for the user's task, escalate with needsMutation=true, target=focused or the current scope, and a concrete reason; never weaken user read-only instructions. Only the main conversation may escalate or reset. Never claim success until runtime confirms it.",
    parameters: z.object({
      action: z.enum(["status", "escalate", "reset"]),
      target: ExecutionContract.Scope.optional(),
      needsMutation: z.literal(true).optional(),
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
        const mcpStatus = await MCP.status().catch(() => ({}) as Record<string, MCP.Status>)
        const mcpServers = Object.fromEntries(
          Object.entries(mcpStatus).map(([name, status]) => [name, { status: status.status }]),
        )
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
            mcpServers,
            diagnostics: await diagnostics(ctx.extra?.model),
            mcpToolsAreSeparateFromPolicy: true,
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
      const currentScope = ExecutionRuntime.getExecutionPolicy(execution.executionID)?.scope
      const mutationRecovery =
        args.needsMutation === true &&
        currentScope !== undefined &&
        ExecutionPolicy.SCOPE_RANK[args.target] <= ExecutionPolicy.SCOPE_RANK[currentScope]
      if (mode === "ask" && !mutationRecovery) {
        await ctx.ask({
          permission: "scope_escalation",
          metadata: { reason: args.reason, needsMutation: args.needsMutation === true },
          patterns: [args.target],
          always: ["*"],
        })
      }
      const result = await ExecutionRuntime.escalateScope({
        sessionID: ctx.sessionID,
        execution,
        scope: args.target,
        reason: args.reason,
        needsMutation: args.needsMutation,
        actorID: ctx.agent ?? "model",
      })
      return {
        title: result.changed ? "Execution scope escalated" : "Execution scope unchanged",
        output: result.changed
          ? `Scope ${result.scope} approved by runtime${args.needsMutation ? " with mutation tools" : ""}; tools refresh on next step. Agent restrictions and user permissions still apply.`
          : `Execution already has ${result.scope} scope.`,
        metadata: { error: false, scope: result.scope, changed: result.changed },
      }
    },
  })
}
