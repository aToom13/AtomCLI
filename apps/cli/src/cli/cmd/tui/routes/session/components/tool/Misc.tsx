import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TodoWriteTool } from "@/tool/todo"
import { QuestionTool } from "@/tool/question"
import { TodoItem } from "../../../../component/todo-item"
import { BlockTool, InlineTool } from "./Common"
import type { ToolProps } from "../../types"
import { input } from "../../utils"

export function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
    return (
        <Switch>
            <Match when={props.metadata.todos?.length}>
                <BlockTool title="# Todos" part={props.part}>
                    <box>
                        <For each={props.input.todos ?? []}>
                            {(todo) => <TodoItem status={todo.status} content={todo.content} />}
                        </For>
                    </box>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
                    Updating todos...
                </InlineTool>
            </Match>
        </Switch>
    )
}

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

export function GenericTool(props: ToolProps<any>) {
    return (
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
            {props.tool} {input(props.input)}
        </InlineTool>
    )
}
