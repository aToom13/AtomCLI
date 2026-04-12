import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { ReasoningPart as SDKReasoningPart } from "@atomcli/sdk/v2"
import { SplitBorder } from "@tui/component/border"
import { useSessionContext } from "../../context"

export function ReasoningPart(props: { part: SDKReasoningPart }) {
    const { theme, subtleSyntax } = useTheme()
    const ctx = useSessionContext()
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
