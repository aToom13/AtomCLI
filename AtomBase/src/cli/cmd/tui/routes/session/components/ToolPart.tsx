import { createMemo, Match, Show, Switch } from "solid-js"
import { useSync } from "@tui/context/sync"
import type { AssistantMessage, ToolPart as ToolPartType } from "@atomcli/sdk/v2"
import { useSession } from "../context"
import {
    Bash,
    CodeSearch,
    Edit,
    GenericTool,
    Glob,
    Grep,
    List,
    Patch,
    Question,
    Read,
    Task,
    TodoWrite,
    WebFetch,
    WebSearch,
    Write,
} from "./tools"

export function ToolPart(props: { last: boolean; part: ToolPartType; message: AssistantMessage }) {
    const ctx = useSession()
    const sync = useSync()

    // Hide tool if showDetails is false and tool completed successfully
    const shouldHide = createMemo(() => {
        if (ctx.showDetails()) return false
        if (props.part.state.status !== "completed") return false
        return true
    })

    const toolprops = {
        get metadata() {
            return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
        },
        get input() {
            return props.part.state.input ?? {}
        },
        get output() {
            return props.part.state.status === "completed" ? props.part.state.output : undefined
        },
        get permission() {
            const permissions = sync.data.permission[props.message.sessionID] ?? []
            const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
            return permissions[permissionIndex]
        },
        get tool() {
            return props.part.tool
        },
        get part() {
            return props.part
        },
    }

    return (
        <Show when={!shouldHide()}>
            <Switch>
                <Match when={props.part.tool === "bash"}>
                    <Bash {...toolprops} />
                </Match>
                <Match when={props.part.tool === "glob"}>
                    <Glob {...toolprops} />
                </Match>
                <Match when={props.part.tool === "read"}>
                    <Read {...toolprops} />
                </Match>
                <Match when={props.part.tool === "grep"}>
                    <Grep {...toolprops} />
                </Match>
                <Match when={props.part.tool === "list"}>
                    <List {...toolprops} />
                </Match>
                <Match when={props.part.tool === "webfetch"}>
                    <WebFetch {...toolprops} />
                </Match>
                <Match when={props.part.tool === "codesearch"}>
                    <CodeSearch {...toolprops} />
                </Match>
                <Match when={props.part.tool === "websearch"}>
                    <WebSearch {...toolprops} />
                </Match>
                <Match when={props.part.tool === "write"}>
                    <Write {...toolprops} />
                </Match>
                <Match when={props.part.tool === "edit"}>
                    <Edit {...toolprops} />
                </Match>
                <Match when={props.part.tool === "task"}>
                    <Task {...toolprops} />
                </Match>
                <Match when={props.part.tool === "patch"}>
                    <Patch {...toolprops} />
                </Match>
                <Match when={props.part.tool === "todowrite"}>
                    <TodoWrite {...toolprops} />
                </Match>
                <Match when={props.part.tool === "question"}>
                    <Question {...toolprops} />
                </Match>
                <Match when={true}>
                    <GenericTool {...toolprops} />
                </Match>
            </Switch>
        </Show>
    )
}
