import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextPart as SDKTextPart } from "@atomcli/sdk/v2"
import { useSessionContext } from "../../context"

export function TextPart(props: { part: SDKTextPart }) {
    const ctx = useSessionContext()
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
