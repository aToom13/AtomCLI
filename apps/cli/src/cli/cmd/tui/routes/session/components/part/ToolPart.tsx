import { createMemo, Match, Show, Switch } from "solid-js"
import { ToolPart as SDKToolPart, AssistantMessage } from "@atomcli/sdk/v2"
import { useSync } from "@tui/context/sync"
import { useSessionContext } from "../../context"

import { Bash } from "../tool/Bash"
import { Write } from "../tool/Write"
import { Edit } from "../tool/Edit"
import { Task } from "../tool/Task"
import { Glob, Read, Grep, List, Patch } from "../tool/FileSystem"
import { WebFetch, WebSearch, CodeSearch } from "../tool/Web"
import { TodoWrite, Question, GenericTool } from "../tool/Misc"

export function ToolPart(props: { part: SDKToolPart; message: AssistantMessage }) {
    const ctx = useSessionContext()
    const sync = useSync()

    // Hide tool if showDetails is false and tool completed successfully
    const shouldHide = createMemo(() => {
        if (ctx.showDetails()) return false
        if (props.part.state.status !== "completed") return false
        return true
    })

    // We should extract this calculation logic or use context carefully if it grows, 
    // but for now recreating the computed props object is fine.
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
