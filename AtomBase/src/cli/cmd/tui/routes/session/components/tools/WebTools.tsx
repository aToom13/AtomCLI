import { Show } from "solid-js"
import type { WebFetchTool } from "@/tool/webfetch"
import { InlineTool, type ToolProps } from "./Shared"

export function WebFetch(props: ToolProps<typeof WebFetchTool>) {
    return (
        <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
            WebFetch {(props.input as any).url}
        </InlineTool>
    )
}

export function CodeSearch(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
        <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
            Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
        </InlineTool>
    )
}

export function WebSearch(props: ToolProps<any>) {
    const input = props.input as any
    const metadata = props.metadata as any
    return (
        <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
            Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
        </InlineTool>
    )
}
