import { createMemo, For, Match, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { QuestionTool } from "@/integrations/tool/question"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"

export function Question(props: ToolProps<typeof QuestionTool>) {
    const { theme } = useTheme()
    const count = createMemo(() => props.input.questions?.length ?? 0)

    function format(answer?: string[]) {
        if (!answer?.length) return "(no answer)"
        return answer.join(", ")
    }

    return (
        <Switch>
            <Match when={props.metadata.answers}>
                <BlockTool title="# Questions" part={props.part}>
                    <box>
                        <For each={props.input.questions ?? []}>
                            {(q, i) => (
                                <box flexDirection="row" gap={1}>
                                    <text fg={theme.textMuted}>{q.question}</text>
                                    <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                                </box>
                            )}
                        </For>
                    </box>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
                    Asked {count()} question{count() !== 1 ? "s" : ""}
                </InlineTool>
            </Match>
        </Switch>
    )
}
