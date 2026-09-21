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
      output: `Unknown or unavailable tool '${params.tool}'. ${params.error} Respond with text only or use one of the available tools.`,
      metadata: {},
    }
  },
})
