import type { Tool } from "@/tool/tool"
import type { ToolPart } from "@atomcli/sdk/v2"

export type ToolProps<T extends Tool.Info> = {
    input: Partial<Tool.InferParameters<T>>
    metadata: Partial<Tool.InferMetadata<T>>
    permission: Record<string, any>
    tool: string
    output?: string
    part: ToolPart
}
