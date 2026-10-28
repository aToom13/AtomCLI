import z from "zod"
import { Tool } from "./tool"

export const InvalidTool = Tool.define("invalid", {
  description: "Do not use",
  parameters: z.object({
    tool: z.string().max(200),
    error: z.string().max(20_000),
  }),
  async execute(params) {
    const recovery =
      ["edit", "write"].includes(params.tool) &&
      /unavailable tool/i.test(params.error) &&
      params.error.includes("scope_control")
        ? ' If the existing user task requires writes, request scope_control(action="escalate", target="focused", needsMutation=true, reason="explain the required file change"); use the current scope if already coordinated. Same-scope mutation recovery needs no scope approval. Wait for runtime confirmation, then use refreshed tools. This only recovers classification narrowing: agent, phase, file permissions and user read-only instructions remain binding. Never use Bash to bypass a denial.'
        : ""
    return {
      title: "Invalid Tool",
      output: `Tool call '${params.tool}' was rejected. No action was applied. ${params.error} Correct the arguments using the current tool schema; if the tool name is unavailable, choose a permitted available tool.${recovery}`,
      metadata: {},
    }
  },
})
