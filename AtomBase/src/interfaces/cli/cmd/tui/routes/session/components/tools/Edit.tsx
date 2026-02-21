import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Filesystem } from "@/util/util/filesystem"
import type { EditTool } from "@/integrations/tool/edit"
import { useSession } from "../../context"
import { BlockTool, InlineTool, type ToolProps } from "./Shared"
import { filetype, input, normalizePath } from "./utils"

export function Edit(props: ToolProps<typeof EditTool>) {
    const ctx = useSession()
    const { theme, syntax } = useTheme()
    const [expanded, setExpanded] = createSignal(false)

    const view = createMemo(() => {
        const diffStyle = ctx.sync.data.config.tui?.diff_style
        if (diffStyle === "stacked") return "unified"
        // Default to "auto" behavior
        return ctx.width > 120 ? "split" : "unified"
    })

    const ft = createMemo(() => filetype(props.input.filePath))

    const diffContent = createMemo(() => props.metadata.diff)

    // Count added/removed lines from diff
    const diffStats = createMemo(() => {
        const diff = diffContent() ?? ""
        const lines = diff.split("\n")
        let added = 0
        let removed = 0
        for (const line of lines) {
            if (line.startsWith("+") && !line.startsWith("+++")) added++
            if (line.startsWith("-") && !line.startsWith("---")) removed++
        }
        return { added, removed }
    })

    const diagnostics = createMemo(() => {
        const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
        const arr = props.metadata.diagnostics?.[filePath] ?? []
        return arr.filter((x) => x.severity === 1).slice(0, 3)
    })

    return (
        <Switch>
            <Match when={props.metadata.diff !== undefined}>
                <BlockTool
                    title={"← Edit " + normalizePath(props.input.filePath!)}
                    part={props.part}
                    onClick={() => setExpanded((prev) => !prev)}
                >
                    <Show
                        when={expanded()}
                        fallback={
                            <text fg={theme.textMuted}>
                                <span style={{ fg: theme.success }}>+{diffStats().added}</span>{" "}
                                <span style={{ fg: theme.error }}>-{diffStats().removed}</span> lines · Click to expand
                            </text>
                        }
                    >
                        <box paddingLeft={1}>
                            <diff
                                diff={diffContent()}
                                view={view()}
                                filetype={ft()}
                                syntaxStyle={syntax()}
                                showLineNumbers={true}
                                width="100%"
                                wrapMode={ctx.diffWrapMode()}
                                fg={theme.text}
                                addedBg={theme.diffAddedBg}
                                removedBg={theme.diffRemovedBg}
                                contextBg={theme.diffContextBg}
                                addedSignColor={theme.diffHighlightAdded}
                                removedSignColor={theme.diffHighlightRemoved}
                                lineNumberFg={theme.diffLineNumber}
                                lineNumberBg={theme.diffContextBg}
                                addedLineNumberBg={theme.diffAddedLineNumberBg}
                                removedLineNumberBg={theme.diffRemovedLineNumberBg}
                            />
                        </box>
                        <text fg={theme.textMuted}>Click to collapse</text>
                    </Show>
                    <Show when={diagnostics().length}>
                        <box>
                            <For each={diagnostics()}>
                                {(diagnostic) => (
                                    <text fg={theme.error}>
                                        Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
                                        {diagnostic.message}
                                    </text>
                                )}
                            </For>
                        </box>
                    </Show>
                </BlockTool>
            </Match>
            <Match when={true}>
                <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
                    Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
                </InlineTool>
            </Match>
        </Switch>
    )
}
