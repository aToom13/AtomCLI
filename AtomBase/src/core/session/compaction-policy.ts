import { Config } from "@/core/config/config"
import type { Provider } from "@/integrations/provider/provider"
import { LLM } from "./llm"
import type { MessageV2 } from "./message-v2"

export namespace CompactionPolicy {
  export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    const context = input.model.limit.context
    if (context === 0) return false
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    const output = Math.min(input.model.limit.output, LLM.OUTPUT_TOKEN_MAX) || LLM.OUTPUT_TOKEN_MAX
    return count > context - output
  }
}
