import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { GlobTool } from "@/tool/glob"
import { ReadTool } from "@/tool/read"
import { GrepTool } from "@/tool/grep"
import { ListTool } from "@/tool/ls"
import { PatchTool } from "@/tool/patch"
import { BlockTool, InlineTool } from "./Common"
import { ToolProps } from "../types"
import { input, normalizePath } from "../../utils"

export function Glob(props: ToolProps<typeof GlobTool>) {
    return (
        <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
            Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
            <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
        </InlineTool>
    )
}

export function Read(props: ToolProps<typeof ReadTool>) {
    return (
        <InlineTool icon="→" pending="Reading file..." complete={props.input.filePath} part={props.part}>
            Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
        </InlineTool>
    )
}

export function Grep(props: ToolProps<typeof GrepTool>) {
    return (
        <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
            Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
            <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
        </InlineTool>
    )
}

export function List(props: ToolProps<typeof ListTool>) {
    const dir = createMemo(() => {
        if (props.input.path) {
            return normalizePath(props.input.path)
        }
        return ""
    })
    return (
        <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
            List {dir()}
        </InlineTool>
    )
}

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
