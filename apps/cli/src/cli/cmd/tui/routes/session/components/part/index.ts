import { ReasoningPart } from "./ReasoningPart"
import { TextPart } from "./TextPart"
import { ToolPart } from "./ToolPart"

export const PART_MAPPING = {
    text: TextPart,
    tool: ToolPart,
    reasoning: ReasoningPart,
}

export { ReasoningPart, TextPart, ToolPart }
