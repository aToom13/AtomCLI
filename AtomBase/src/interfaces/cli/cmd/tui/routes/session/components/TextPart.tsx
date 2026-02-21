import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { AssistantMessage, TextPart as TextPartType } from "@atomcli/sdk/v2"
import { useSession } from "../context"
import { Focusable } from "../../../context/spatial"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../../../ui/toast"

export function TextPart(props: { last: boolean; part: TextPartType; message: AssistantMessage }) {
    const ctx = useSession()
    const { theme, syntax } = useTheme()
    const toast = useToast()
    return (
        <Show when={props.part.text.trim()}>
            <Focusable
                id={`text-part-${props.part.id}`}
                onPress={() => {
                    Clipboard.copy(props.part.text.trim())
                        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
                        .catch(toast.error)
                }}
            >
                {(focused: () => boolean) => (
                    <box
                        id={"text-" + props.part.id}
                        paddingLeft={3}
                        marginTop={1}
                        flexShrink={0}
                        backgroundColor={focused() ? theme.backgroundElement : undefined}
                    >
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
                )}
            </Focusable>
        </Show>
    )
}
