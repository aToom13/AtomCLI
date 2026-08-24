import z from "zod"
import type { MessageV2 } from "@/core/session/message-v2"
import type { Agent } from "../agent/agent"
import type { PermissionNext } from "@/util/permission/next"
import { Truncate } from "./truncation"

export namespace Tool {
  interface Metadata {
    [key: string]: any
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>
  }
  export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
    id: string
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: z.input<Parameters>,
        ctx: Context,
      ): Promise<{
        title: string
        metadata: M
        output: string
        attachments?: MessageV2.FilePart[]
      }>
      formatValidationError?(error: z.ZodError): string
    }>
  }

  type Definition<Parameters extends z.ZodType, M extends Metadata> = {
    description: string
    parameters: Parameters
    execute(
      args: z.output<Parameters>,
      ctx: Context,
    ): Promise<{
      title: string
      metadata: M
      output: string
      attachments?: MessageV2.FilePart[]
    }>
    formatValidationError?(error: z.ZodError): string
  }

  // UI renderers consume the normalized shape after validation/defaults.
  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.output<P> : never
  export type InferMetadata<T extends Info> = T extends Info<any, infer M> ? M : never

  /**
   * Default validation error formatter for Zod errors
   */
  function defaultFormatValidationError(toolId: string, error: z.ZodError): string {
    const issues = error.issues
    const messages: string[] = []

    for (const issue of issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root"
      messages.push(`  • ${path}: ${issue.message}`)
    }

    return `The ${toolId} tool received invalid arguments:\n${messages.join("\n")}\n\nPlease check the parameter types and try again.`
  }

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init:
      | ((ctx?: InitContext) => Promise<Definition<Parameters, Result>> | Definition<Parameters, Result>)
      | Definition<Parameters, Result>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        const execute = toolInfo.execute

        // Use custom formatValidationError or default
        const formatError = toolInfo.formatValidationError
          ? toolInfo.formatValidationError
          : (err: z.ZodError) => defaultFormatValidationError(id, err)

        return {
          ...toolInfo,
          execute: async (args, ctx) => {
            let parsed: z.output<Parameters>
            try {
              parsed = toolInfo.parameters.parse(args)
            } catch (error) {
              if (error instanceof z.ZodError) {
                throw new Error(formatError(error), { cause: error })
              }
              throw new Error(`The ${id} tool encountered an unexpected error: ${error}`, { cause: error })
            }
            const result = await execute(parsed, ctx)
            // skip truncation for tools that handle it themselves
            if (result.metadata.truncated !== undefined) {
              return result
            }
            const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
            return {
              ...result,
              output: truncated.content,
              metadata: {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
            }
          },
        }
      },
    }
  }
}
