import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import { ToolRuntime } from "./runtime"

const MAX_CALLS = 10
const MAX_CONCURRENCY = 4
const SAFE_TOOLS = new Set([
  "read",
  "find",
  "grep",
  "webfetch",
  "websearch",
  "codesearch",
  "finance_analyze",
  "system_health",
])

const parameters = z.object({
  tool_calls: z
    .array(
      z.object({
        tool: z.string().min(1).max(200).describe("The name of the tool to execute"),
        parameters: z.object({}).loose().describe("Parameters for the tool"),
      }),
    )
    .min(1, "Provide at least one tool call")
    .max(MAX_CALLS, `A batch can contain at most ${MAX_CALLS} tool calls`)
    .describe("Array of tool calls to execute in parallel"),
})

export const BatchTool = Tool.define("batch", async (initCtx) => {
  return {
    description: DESCRIPTION,
    parameters,
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params: z.infer<typeof parameters>, ctx) {
      const { Session } = await import("@/core/session")
      const { Identifier } = await import("@/core/id/id")

      const toolCalls = params.tool_calls
      const payloadBytes = Buffer.byteLength(JSON.stringify(toolCalls))
      if (payloadBytes > 1024 * 1024) throw new Error("Batch parameters exceed the 1 MiB limit")

      const { ToolRegistry } = await import("./registry")
      const providerID = (ctx.extra?.model as { providerID?: string } | undefined)?.providerID ?? ""
      const availableTools = await ToolRegistry.tools(providerID, initCtx?.agent, SAFE_TOOLS)
      const toolMap = new Map(availableTools.filter((tool) => SAFE_TOOLS.has(tool.id)).map((tool) => [tool.id, tool]))

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = Identifier.ascending("part")

        try {
          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys())
            throw new Error(
              `Tool '${call.tool}' cannot be batched. Only read-only, agent-allowed tools can run concurrently. Available tools: ${availableToolsList.join(", ") || "none"}`,
            )
          }
          const validatedParams = tool.parameters.parse(call.parameters)

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          const nestedContext = { ...ctx, callID: partID }
          const result = await ToolRuntime.execute({
            tool: call.tool,
            args: validatedParams,
            context: nestedContext,
            execute: (args, context) => tool.execute(args, context),
          })
          if (result.attachments?.length) {
            throw new Error("Attachment-producing reads cannot run in a batch; call the read tool directly")
          }

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments: result.attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      const results = new Array<Awaited<ReturnType<typeof executeCall>>>(toolCalls.length)
      let nextIndex = 0
      const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, toolCalls.length) }, async () => {
        while (nextIndex < toolCalls.length) {
          const index = nextIndex++
          results[index] = await executeCall(toolCalls[index])
        }
      })
      await Promise.all(workers)

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})
