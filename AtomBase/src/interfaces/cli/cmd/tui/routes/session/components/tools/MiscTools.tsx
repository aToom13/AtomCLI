import { For, Match, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TodoItem } from "../../../../component/todo-item"
import type { PatchTool } from "@/integrations/tool/patch"
import type { TodoWriteTool } from "@/integrations/tool/todo"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"
import { input } from "./utils"

export function Patch(props: ToolProps<typeof PatchTool>) {
    const { theme } = useTheme()
    return (
        <Switch>
            <Match when={props.output !== undefined}>
                <BlockTool title="# Patch" part={props.part}>
                    <box>
                        <text fg={theme.text}>{props.output?.trim()}</text>
                    </box>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
                    Patch
                </InlineTool>
            </Match>
        </Switch>
    )
}

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

export function GenericTool(props: ToolProps<any>) {
    return (
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
            {props.tool} {input(props.input)}
        </InlineTool>
    )
}
