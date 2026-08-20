import { Plugin } from "@/integrations/plugin"
import { Log } from "@/util/util/log"
import type { Tool } from "./tool"
import { SessionReplay } from "@/core/session/replay"

export namespace ToolRuntime {
  const log = Log.create({ service: "tool.runtime" })

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

    const callID = context.callID ?? `runtime-${Date.now()}`
    await SessionReplay.append({
      type: "tool.call",
      sessionID: context.sessionID,
      callID,
      tool: input.tool,
      args,
    })

    let invoke = (nextArgs: Args, nextContext: Tool.Context) => input.execute(nextArgs, nextContext)
    for (const middleware of [...(input.middleware ?? [])].reverse()) {
      if (!middleware.around) continue
      const next = invoke
      invoke = (nextArgs, nextContext) =>
        middleware.around!({ tool: input.tool, args: nextArgs, context: nextContext }, next)
    }
    for (const hook of [...(await Plugin.list())].reverse()) {
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
      await SessionReplay.append({
        type: "tool.error",
        sessionID: context.sessionID,
        callID,
        tool: input.tool,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
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
    await SessionReplay.append({
      type: "tool.result",
      sessionID: context.sessionID,
      callID,
      tool: input.tool,
      result,
    })
    log.info("executed", { tool: input.tool, sessionID: context.sessionID, duration: Date.now() - started })
    return normalize(input.tool, result)
  }
}
