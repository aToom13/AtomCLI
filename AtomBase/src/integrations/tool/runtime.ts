import { Plugin } from "@/integrations/plugin"
import { Log } from "@/util/util/log"
import type { Tool } from "./tool"
import { SessionReplay } from "@/core/session/replay"
import { ToolAppliedError, ToolNotAppliedError } from "./runtime-error"

const READ_ONLY_TOOLS = new Set([
  "find",
  "grep",
  "invalid",
  "question",
  "model_control",
  "read",
  "skill",
  "webfetch",
  "websearch",
])

export namespace ToolRuntime {
  const log = Log.create({ service: "tool.runtime" })

  export const NotAppliedError = ToolNotAppliedError
  export const AppliedError = ToolAppliedError

  export type Result = {
    title: string
    output: string
    metadata: Record<string, any>
    attachments?: any[]
    [key: string]: any
  }

  export interface Middleware<Args = any, Output extends Result = Result> {
    before?(input: { tool: string; args: Args; context: Tool.Context }): Promise<Args | void>
    around?(
      input: { tool: string; args: Args; context: Tool.Context },
      next: (args: Args, context: Tool.Context) => Promise<Output>,
    ): Promise<Output>
    after?(input: { tool: string; args: Args; context: Tool.Context; result: Output }): Promise<Output | void>
  }

  export interface ExecuteInput<Args, Output extends Result> {
    tool: string
    args: Args
    context: Tool.Context
    execute(args: Args, context: Tool.Context): Promise<Output>
    mutating?: boolean | ((args: Args) => boolean)
    permission?(args: Args, context: Tool.Context): Promise<void>
    middleware?: Middleware<Args, Output>[]
    timeoutMs?: number
    redact?(result: Output): Promise<Output> | Output
  }

  function combinedSignal(parent: AbortSignal, timeoutMs?: number) {
    const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
    return timeout ? AbortSignal.any([parent, timeout]) : parent
  }

  function normalize<Output extends Result>(tool: string, result: Output): Output {
    if (!result || typeof result !== "object") throw new Error(`Tool ${tool} returned an invalid result`)
    if (typeof result.title !== "string") throw new Error(`Tool ${tool} returned an invalid title`)
    if (typeof result.output !== "string") throw new Error(`Tool ${tool} returned an invalid output`)
    if (!result.metadata || typeof result.metadata !== "object") result.metadata = {} as Output["metadata"]
    return result
  }

  export async function execute<Args, Output extends Result>(input: ExecuteInput<Args, Output>): Promise<Output> {
    const started = Date.now()
    const context = {
      ...input.context,
      abort: combinedSignal(input.context.abort, input.timeoutMs),
    }
    const execution = context.extra?.execution
    const assertExecutionActive = async () => {
      if (!execution) return
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      await ExecutionRuntime.assertActive({ sessionID: context.sessionID, execution })
    }
    const ask = context.ask.bind(context)
    context.ask = async (request) => {
      try {
        await ask(request)
        if (context.abort.aborted) throw context.abort.reason ?? new Error(`Tool ${input.tool} was aborted`)
        await assertExecutionActive()
      } catch (error) {
        if (error instanceof NotAppliedError) throw error
        throw new NotAppliedError(error)
      }
    }
    let args = input.args

    args = (
      await Plugin.trigger(
        "tool.execute.before",
        { tool: input.tool, sessionID: context.sessionID, callID: context.callID ?? "" },
        { args },
      )
    ).args

    for (const middleware of input.middleware ?? []) {
      const replacement = await middleware.before?.({ tool: input.tool, args, context })
      if (replacement !== undefined) args = replacement as Args
    }

    await input.permission?.(args, context)
    if (context.abort.aborted) throw context.abort.reason ?? new Error(`Tool ${input.tool} was aborted`)
    await assertExecutionActive()

    const callID = context.callID ?? `runtime-${crypto.randomUUID()}`
    await SessionReplay.append({
      type: "tool.call",
      sessionID: context.sessionID,
      callID,
      tool: input.tool,
      args,
    })
    const operationID = execution
      ? `${execution.executionID}:${execution.invocationID}:${context.messageID}:${callID}:0`
      : undefined
    const mutating =
      typeof input.mutating === "function" ? input.mutating(args) : (input.mutating ?? !READ_ONLY_TOOLS.has(input.tool))
    let workVersion: number | undefined
    if (execution && operationID) {
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      const registered = await ExecutionRuntime.registerWork({
        sessionID: context.sessionID,
        execution,
        operationID,
        kind: `tool:${input.tool}`,
        mutating,
      })
      workVersion = registered.version
    }

    let bodyClaimed = false
    let bodyBegan = false
    let invoke = async (nextArgs: Args, nextContext: Tool.Context) => {
      if (bodyClaimed) throw new Error(`Tool ${input.tool} middleware attempted to invoke the operation more than once`)
      bodyClaimed = true
      if (nextContext.abort.aborted) throw nextContext.abort.reason ?? new Error(`Tool ${input.tool} was aborted`)
      await assertExecutionActive()
      if (execution && operationID && workVersion !== undefined) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        const began = await ExecutionRuntime.beginWork({
          sessionID: context.sessionID,
          execution,
          operationID,
          expectedVersion: workVersion,
        })
        workVersion = began.version
        bodyBegan = true
      }
      return input.execute(nextArgs, nextContext)
    }
    for (const middleware of [...(input.middleware ?? [])].reverse()) {
      if (!middleware.around) continue
      const next = invoke
      invoke = (nextArgs, nextContext) =>
        middleware.around!({ tool: input.tool, args: nextArgs, context: nextContext }, next)
    }
    let hooks
    try {
      hooks = await Plugin.list()
    } catch (error) {
      if (execution && operationID) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        await ExecutionRuntime.finishWork({
          sessionID: context.sessionID,
          execution,
          operationID,
          expectedVersion: workVersion!,
          state: "failed",
        }).catch((workError) => log.warn("failed to close prepared tool work", { workError, operationID }))
      }
      throw error
    }
    for (const hook of [...hooks].reverse()) {
      const around = hook["tool.execute.around"]
      if (!around) continue
      const next = invoke
      invoke = (nextArgs, nextContext) =>
        around(
          {
            tool: input.tool,
            sessionID: nextContext.sessionID,
            callID: nextContext.callID ?? "",
            args: nextArgs,
          },
          (replacement) => next(replacement as Args, nextContext),
        ) as Promise<Output>
    }

    let result: Output
    try {
      result = normalize(input.tool, await invoke(args, context))
    } catch (error) {
      const notApplied = error instanceof NotAppliedError
      const applied = error instanceof AppliedError
      if (execution && operationID) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        await ExecutionRuntime.finishWork({
          sessionID: context.sessionID,
          execution,
          operationID,
          expectedVersion: workVersion!,
          state: applied
            ? "completed"
            : notApplied
              ? "failed"
              : mutating && bodyBegan
                ? "unknown"
                : context.abort.aborted
                  ? "cancelled"
                  : "failed",
        }).catch((workError) => log.warn("failed to persist tool work failure", { workError, operationID }))
      }
      await SessionReplay.append({
        type: "tool.error",
        sessionID: context.sessionID,
        callID,
        tool: input.tool,
        error: error instanceof Error ? error.message : String(error),
        applied: applied || (mutating && bodyBegan && !notApplied),
      }).catch((replayError) => log.warn("failed to record tool execution error", { replayError }))
      throw error
    }

    await SessionReplay.append({
      type: "tool.applied",
      sessionID: context.sessionID,
      callID,
      tool: input.tool,
    }).catch((replayError) => log.warn("failed to record applied tool operation", { replayError }))

    try {
      if (input.redact) result = normalize(input.tool, await input.redact(result))

      for (const middleware of [...(input.middleware ?? [])].reverse()) {
        const replacement = await middleware.after?.({ tool: input.tool, args, context, result })
        if (replacement !== undefined) result = replacement as Output
        result = normalize(input.tool, result)
      }

      result = await Plugin.trigger(
        "tool.execute.after",
        { tool: input.tool, sessionID: context.sessionID, callID: context.callID ?? "" },
        result,
      )
    } catch (error) {
      if (execution && operationID) {
        const { ExecutionRuntime } = await import("@/core/execution/runtime")
        await ExecutionRuntime.finishWork({
          sessionID: context.sessionID,
          execution,
          operationID,
          expectedVersion: workVersion!,
          state: "completed",
        }).catch((workError) => log.warn("failed to close applied tool work", { workError, operationID }))
      }
      const appliedError = new AppliedError(input.tool, error)
      await SessionReplay.append({
        type: "tool.error",
        sessionID: context.sessionID,
        callID,
        tool: input.tool,
        error: appliedError.message,
        applied: true,
      }).catch((replayError) => log.warn("failed to record tool post-processing error", { replayError }))
      throw appliedError
    }

    await SessionReplay.append({
      type: "tool.result",
      sessionID: context.sessionID,
      callID,
      tool: input.tool,
      result,
    }).catch((replayError) => log.warn("failed to record tool result", { replayError }))
    if (execution && operationID) {
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      await ExecutionRuntime.finishWork({
        sessionID: context.sessionID,
        execution,
        operationID,
        expectedVersion: workVersion!,
        state: "completed",
      })
    }
    log.info("executed", { tool: input.tool, sessionID: context.sessionID, duration: Date.now() - started })
    return normalize(input.tool, result)
  }
}
