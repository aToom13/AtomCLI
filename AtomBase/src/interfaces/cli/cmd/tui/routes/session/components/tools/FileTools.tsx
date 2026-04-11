import { createMemo, Show } from "solid-js"
import type { FindTool } from "@/integrations/tool/find"
import type { GrepTool } from "@/integrations/tool/grep"
import type { ReadTool } from "@/integrations/tool/read"
import { InlineTool, type ToolProps } from "./Shared"
import { input, normalizePath } from "./utils"

export function Find(props: ToolProps<typeof FindTool>) {
    const isTree = createMemo(() => props.input.mode === "tree")
    return (
        <InlineTool icon={isTree() ? "→" : "✱"} pending={isTree() ? "Listing directory..." : "Finding files..."} complete={isTree() ? props.input.path !== undefined : props.input.pattern} part={props.part}>
            <Show when={isTree()}>
                Find {props.input.path ? normalizePath(props.input.path) : ""}
            </Show>
            <Show when={!isTree()}>
                Find "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
                <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
            </Show>
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
