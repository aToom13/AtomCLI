import z from "zod"
import { Tool } from "./tool"

export const InvalidTool = Tool.define("invalid", {
  description: "Do not use",
  parameters: z.object({
    tool: z.string().max(200),
    error: z.string().max(20_000),
  }),
  async execute(params) {
    return {
      title: "Invalid Tool",
      output: `Tool call '${params.tool}' was rejected. No action was applied. ${params.error} Correct the arguments using the current tool schema; if the tool name is unavailable, choose a permitted available tool.`,
      metadata: {},
    }
  },
})
