import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, ReasoningPart as ReasoningPartType } from "@atomcli/sdk/v2"
import { useSession } from "../context"

export function ReasoningPart(props: { last: boolean; part: ReasoningPartType; message: AssistantMessage }) {
    const { theme, subtleSyntax } = useTheme()
    const ctx = useSession()
    const content = createMemo(() => {
        // Filter out redacted reasoning chunks from OpenRouter
        // OpenRouter sends encrypted reasoning data that appears as [REDACTED]
        return props.part.text.replace("[REDACTED]", "").trim()
    })
    return (
        <Show when={content() && ctx.showThinking()}>
            <box
                id={"text-" + props.part.id}
                paddingLeft={2}
                marginTop={1}
                flexDirection="column"
                border={["left"]}
                customBorderChars={SplitBorder.customBorderChars}
                borderColor={theme.backgroundElement}
            >
                <code
                    filetype="markdown"
                    drawUnstyledText={false}
                    streaming={true}
                    syntaxStyle={subtleSyntax()}
                    content={"_Thinking:_ " + content()}
                    conceal={ctx.conceal()}
                    fg={theme.textMuted}
                />
            </box>
        </Show>
    )
}
