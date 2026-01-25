import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { AssistantMessage, TextPart as TextPartType } from "@atomcli/sdk/v2"
import { useSession } from "../context"

export function TextPart(props: { last: boolean; part: TextPartType; message: AssistantMessage }) {
    const ctx = useSession()
    const { theme, syntax } = useTheme()
    return (
        <Show when={props.part.text.trim()}>
            <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
                <code
                    filetype="markdown"
                    drawUnstyledText={false}
                    streaming={true}
                    syntaxStyle={syntax()}
                    content={props.part.text.trim()}
                    conceal={ctx.conceal()}
                    fg={theme.text}
                />
            </box>
        </Show>
    )
}
