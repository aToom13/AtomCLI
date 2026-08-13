import { For, Match, Switch } from "solid-js"
import { TodoItem } from "../../../../component/todo-item"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"
import { input } from "./utils"

// Kept for rendering historical sessions that contain the removed todowrite tool.
export function TodoWrite(props: any) {
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

export function GenericTool(props: ToolProps<any>) {
    return (
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
            {props.tool} {input(props.input)}
        </InlineTool>
    )
}
