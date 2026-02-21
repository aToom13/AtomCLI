import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Filesystem } from "@/util/util/filesystem"
import type { WriteTool } from "@/integrations/tool/write"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"
import { filetype, input, normalizePath } from "./utils"

export function Write(props: ToolProps<typeof WriteTool>) {
    const { theme, syntax } = useTheme()
    const [expanded, setExpanded] = createSignal(false)

    const code = createMemo(() => {
        if (!props.input.content) return ""
        return props.input.content
    })

    const lineCount = createMemo(() => code().split("\n").length)

    const diagnostics = createMemo(() => {
        const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
        return props.metadata.diagnostics?.[filePath] ?? []
    })

    return (
        <Switch>
            <Match when={props.metadata.diagnostics !== undefined}>
                <BlockTool
                    title={"← Wrote " + normalizePath(props.input.filePath!)}
                    part={props.part}
                    onClick={() => setExpanded((prev) => !prev)}
                >
                    <Show
                        when={expanded()}
                        fallback={
                            <text fg={theme.textMuted}>
                                {lineCount()} lines · Click to expand
                            </text>
                        }
                    >
                        <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
                            <code
                                conceal={false}
                                fg={theme.text}
                                filetype={filetype(props.input.filePath!)}
                                syntaxStyle={syntax()}
                                content={code()}
                            />
                        </line_number>
                        <text fg={theme.textMuted}>Click to collapse</text>
                    </Show>
                    <Show when={diagnostics().length}>
                        <For each={diagnostics()}>
                            {(diagnostic) => (
                                <text fg={theme.error}>
                                    Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
                                </text>
                            )}
                        </For>
                    </Show>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
                    Write {normalizePath(props.input.filePath!)}
                </InlineTool>
            </Match>
        </Switch>
    )
}
