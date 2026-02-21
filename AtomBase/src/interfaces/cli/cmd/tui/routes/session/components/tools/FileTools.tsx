import { createMemo, Show } from "solid-js"
import type { GlobTool } from "@/integrations/tool/glob"
import type { GrepTool } from "@/integrations/tool/grep"
import type { ListTool } from "@/integrations/tool/ls"
import type { ReadTool } from "@/integrations/tool/read"
import { InlineTool, type ToolProps } from "./Shared"
import { input, normalizePath } from "./utils"

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
