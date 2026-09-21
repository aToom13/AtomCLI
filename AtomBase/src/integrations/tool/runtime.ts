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

const TASKFLOW_CONTROL_TOOLS = new Set(["model_control", "question", "taskflow"])

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
    effects?: Tool.ToolEffects | ((args: Args) => Tool.ToolEffects)
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

  function fingerprint(value: string) {
    return new Bun.CryptoHasher("sha256").update(value).digest("hex")
  }

  function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["description", "timeout", "timeoutMs"].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }

  export function semanticSignature(tool: string, args: unknown) {
    if (tool === "bash") {
      const input = args as { command?: unknown; workdir?: unknown }
      const command =
        typeof input?.command === "string"
          ? input.command.trim().replace(/\s+/g, " ")
          : Array.isArray(input?.command)
            ? input.command.map((item) => String(item).trim().replace(/\s+/g, " ")).join(" && ")
            : ""
      const workdir = typeof input?.workdir === "string" ? input.workdir.replace(/\/+$/, "") : ""
      return fingerprint(`bash:${command}:${workdir}`)
    }
    return fingerprint(`${tool}:${JSON.stringify(stableValue(args))}`)
  }

  export function changeRiskEvidence(tool: string, args: unknown) {
    if (tool !== "edit" && tool !== "write") return {}
    const input = args as {
      filePath?: unknown
      content?: unknown
      newString?: unknown
      operations?: Array<{ newString?: unknown }>
    }
    const filePath = typeof input?.filePath === "string" ? input.filePath.replaceAll("\\", "/") : ""
    const changedContent = [
      typeof input?.content === "string" ? input.content : "",
      typeof input?.newString === "string" ? input.newString : "",
      ...(Array.isArray(input?.operations)
        ? input.operations.map((operation) => (typeof operation?.newString === "string" ? operation.newString : ""))
        : []),
    ].join("\n")
    const text = `${filePath}\n${changedContent}`
    return {
      hasAuthOrSecurityEffect:
        /(^|\/)(auth|security|permissions?|credentials?|secrets?)(\/|[._-])/i.test(filePath) ||
        /\b(authenticate|authorization|permissions?|credentials?|password|oauth|jwt|access token)\b/i.test(
          changedContent,
        ),
      hasSchemaOrMigrationEffect:
        /(^|\/)(migrations?|schema)(\/|[._-])/i.test(filePath) ||
        /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|COLUMN)|\bmigrations?\b/i.test(changedContent),
      hasPublicApiEffect:
        /(^|\/)(api|routes?|openapi)(\/|[._-])/i.test(filePath) ||
        /(^|\/)src\/server\//i.test(filePath) ||
        /\b(app|router|server)\.(get|post|put|patch|delete)\s*\(/i.test(text),
    }
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
    const effects: Tool.ToolEffects =
      typeof input.effects === "function"
        ? input.effects(args)
        : (input.effects ?? {
            workspace: mutating ? "write" : "read",
            external: "none",
            reversible: !mutating,
            destructive: false,
            privileged: false,
          })
    let workVersion: number | undefined
    const actionSignature = semanticSignature(input.tool, args)
    const checkpointControl =
      context.extra?.checkpointRequired === true && ["taskflow", "model_control"].includes(input.tool)
    if (execution && operationID) {
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      // Checkpoint controls must remain usable even at a completely consumed
      // work slice. They still use work lifecycle tracking and model/step limits.
      if (!checkpointControl) ExecutionRuntime.reserveToolCall(execution.executionID)
      const targetPath = ["filePath", "path", "directory"]
        .map((key) => (args as any)?.[key])
        .find((value) => typeof value === "string")
      const targetOffset = ["offset", "line", "start"]
        .map((key) => (args as any)?.[key])
        .find((value) => typeof value === "number")
      const target = targetPath ? `${input.tool}:${targetPath}:${targetOffset ?? ""}` : undefined
      const registered = await ExecutionRuntime.registerWork({
        sessionID: context.sessionID,
        execution,
        operationID,
        kind: `tool:${input.tool}`,
        mutating,
      }).catch((error) => {
        if (!checkpointControl) ExecutionRuntime.releaseToolCall(execution.executionID)
        throw error
      })
      workVersion = registered.version
      ExecutionRuntime.recordToolCall(execution.executionID, undefined, {
        signature: actionSignature,
        family: input.tool,
        target,
      })
    }

    let bodyClaimed = false
    let bodyBegan = false
    let invoke = async (nextArgs: Args, nextContext: Tool.Context) => {
      if (bodyClaimed) throw new Error(`Tool ${input.tool} middleware attempted to invoke the operation more than once`)
      bodyClaimed = true
      if (nextContext.abort.aborted) throw nextContext.abort.reason ?? new Error(`Tool ${input.tool} was aborted`)
      await assertExecutionActive()
      if (execution && !TASKFLOW_CONTROL_TOOLS.has(input.tool)) {
        const { TaskFlow } = await import("./taskflow")
        await TaskFlow.activateForWork(nextContext, { tool: input.tool, args: nextArgs })
      }
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
        const errorFingerprint = fingerprint(
          `${input.tool}:${error instanceof Error ? `${error.name}:${error.message}` : String(error)}`,
        )
        if (applied) {
          const filePath = typeof (args as any)?.filePath === "string" ? (args as any).filePath : undefined
          ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
            filesRead: filePath && effects.workspace === "read" ? [filePath] : [],
            filesChanged: filePath && effects.workspace === "write" ? [filePath] : [],
            mutatingCalls: effects.workspace === "write" ? 1 : 0,
            externalCalls: effects.external !== "none" ? 1 : 0,
            hasDestructiveAction: effects.destructive,
            failureCount: 1,
            recentErrorFingerprints: [errorFingerprint],
          })
        } else {
          ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
            failureCount: 1,
            recentErrorFingerprints: [errorFingerprint],
            uncertainOutcome: mutating && bodyBegan && !notApplied,
          })
        }
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

    const semanticStatus = typeof result.metadata.status === "string" ? result.metadata.status : undefined
    const semanticExit = typeof result.metadata.exit === "number" ? result.metadata.exit : undefined
    const semanticFailure =
      (semanticStatus !== undefined && ["error", "blocked", "failed"].includes(semanticStatus)) ||
      (semanticExit !== undefined && semanticExit !== 0)
    if (execution) {
      const { ExecutionRuntime } = await import("@/core/execution/runtime")
      const filePath = typeof (args as any)?.filePath === "string" ? (args as any).filePath : undefined
      ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
        filesRead: filePath && effects.workspace === "read" ? [filePath] : [],
        filesChanged: filePath && effects.workspace === "write" ? [filePath] : [],
        mutatingCalls: effects.workspace === "write" ? 1 : 0,
        externalCalls: effects.external !== "none" ? 1 : 0,
        hasDestructiveAction: effects.destructive,
        ...changeRiskEvidence(input.tool, args),
        successfulToolCalls: semanticFailure ? 0 : 1,
        ...(semanticFailure
          ? {
              failureCount: 1,
              recentErrorFingerprints: [
                fingerprint(`${input.tool}:${semanticStatus ?? `exit:${semanticExit}`}:${result.output.slice(0, 500)}`),
              ],
            }
          : {}),
      })
      if (!semanticFailure && effects.workspace !== "write") {
        ExecutionRuntime.recordSemanticActionResult(
          execution.executionID,
          actionSignature,
          fingerprint(result.output.trim().replace(/\s+/g, " ")),
        )
      }
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
        state: semanticFailure ? "failed" : "completed",
      })
    }
    log.info("executed", { tool: input.tool, sessionID: context.sessionID, duration: Date.now() - started })
    return normalize(input.tool, result)
  }
}
