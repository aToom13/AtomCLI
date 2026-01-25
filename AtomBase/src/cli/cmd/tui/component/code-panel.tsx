import { For, Show, createMemo, createSignal, createEffect, on, onCleanup } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useFileTree, type OpenFile } from "@tui/context/file-tree"
import { useKeyboard } from "@opentui/solid"
import { TextareaRenderable } from "@opentui/core"
import type { KeyBinding, TextareaAction } from "@opentui/core"
import path from "path"

/**
 * Code Panel Component - Side panel for viewing/editing files
 * 
 * Features:
 * - Tab bar for multiple open files
 * - Editable text area with proper focus
 * - Line numbers
 * - Modified indicator
 * - Ctrl+S to save
 * - Enter = newline
 */

// Custom keybindings for code editor - Enter creates newline, not submit
const CODE_EDITOR_KEYBINDINGS: KeyBinding[] = [
    // Shift+Enter = newline
    { name: "return", shift: true, action: "newline" },
    // Standard navigation
    { name: "left", action: "move-left" },
    { name: "right", action: "move-right" },
    { name: "up", action: "move-up" },
    { name: "down", action: "move-down" },
    // Home/End
    { name: "home", action: "line-home" },
    { name: "end", action: "line-end" },
    // Selection
    { name: "left", shift: true, action: "select-left" },
    { name: "right", shift: true, action: "select-right" },
    { name: "up", shift: true, action: "select-up" },
    { name: "down", shift: true, action: "select-down" },
    // Word navigation
    { ctrl: true, name: "left", action: "word-backward" },
    { ctrl: true, name: "right", action: "word-forward" },
    // Delete
    { name: "backspace", action: "backspace" },
    { name: "delete", action: "delete" },
    { ctrl: true, name: "backspace", action: "delete-word-backward" },
    // Undo/Redo
    { ctrl: true, name: "z", action: "undo" },
    { ctrl: true, shift: true, name: "z", action: "redo" },
    // Buffer navigation
    { ctrl: true, name: "home", action: "buffer-home" },
    { ctrl: true, name: "end", action: "buffer-end" },
]

function FileTab(props: { file: OpenFile; active: boolean }) {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const filename = createMemo(() => path.basename(props.file.path))

    return (
        <box
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={props.active ? theme.backgroundElement : theme.backgroundPanel}
            onMouseUp={() => fileTree.setActiveFile(props.file.path)}
        >
            <text fg={props.active ? theme.text : theme.textMuted}>
                {props.file.modified ? "● " : ""}{filename()}
            </text>
            <text
                fg={theme.textMuted}
                onMouseUp={(e) => {
                    e.stopPropagation?.()
                    fileTree.closeFile(props.file.path)
                }}
            >
                ✕
            </text>
        </box>
    )
}

export function CodePanel() {
    const { theme } = useTheme()
    const fileTree = useFileTree()

    let textarea: TextareaRenderable | undefined
    let intervalId: ReturnType<typeof setInterval> | undefined
    const [cursorLine, setCursorLine] = createSignal(1)
    const [cursorCol, setCursorCol] = createSignal(1)

    const activeFile = createMemo(() => fileTree.getActiveFile())
    const lines = createMemo(() => {
        const file = activeFile()
        if (!file) return []
        return file.content.split("\n")
    })

    // Don't render if no open files or code panel hidden
    const shouldShow = createMemo(() =>
        fileTree.state.codePanelVisible && fileTree.hasOpenFiles()
    )

    // Focus textarea when active file changes
    createEffect(on(
        () => activeFile()?.path,
        () => {
            setTimeout(() => {
                textarea?.focus()
            }, 10)
        }
    ))

    // Poll for content changes with proper cleanup
    createEffect(() => {
        // Clear any existing interval first
        if (intervalId) {
            clearInterval(intervalId)
            intervalId = undefined
        }

        if (!shouldShow()) return

        intervalId = setInterval(() => {
            // Safety check - make sure textarea and activeFile exist
            try {
                if (textarea && activeFile()) {
                    const currentContent = textarea.plainText
                    const file = activeFile()
                    if (file && currentContent !== file.content) {
                        fileTree.updateFileContent(file.path, currentContent)
                    }
                }
            } catch {
                // Ignore errors if textarea is destroyed
            }
        }, 500)
    })

    // Cleanup interval on unmount
    onCleanup(() => {
        if (intervalId) {
            clearInterval(intervalId)
            intervalId = undefined
        }
    })

    // Handle keyboard shortcuts
    useKeyboard((evt) => {
        if (!shouldShow()) return

        // Ctrl+S to save
        if (evt.ctrl && evt.name === "s") {
            evt.preventDefault?.()
            const file = activeFile()
            if (file) {
                fileTree.saveFile(file.path)
            }
        }

        // Ctrl+W to close tab - also clear interval
        if (evt.ctrl && evt.name === "w") {
            evt.preventDefault?.()
            if (intervalId) {
                clearInterval(intervalId)
                intervalId = undefined
            }
            textarea = undefined
            const file = activeFile()
            if (file) {
                fileTree.closeFile(file.path)
            }
        }
    })

    return (
        <Show when={shouldShow()}>
            <box
                flexGrow={2}
                minWidth={40}
                backgroundColor={theme.backgroundPanel}
                borderColor={theme.border}
                border={["left"]}
            >
                {/* Tab Bar */}
                <box
                    flexDirection="row"
                    backgroundColor={theme.backgroundMenu}
                    flexShrink={0}
                >
                    <For each={fileTree.state.openFiles}>
                        {(file) => (
                            <FileTab
                                file={file}
                                active={file.path === fileTree.state.activeFile}
                            />
                        )}
                    </For>

                    {/* Close panel button */}
                    <box flexGrow={1} />
                    <text
                        fg={theme.textMuted}
                        paddingRight={1}
                        onMouseUp={() => {
                            if (intervalId) {
                                clearInterval(intervalId)
                                intervalId = undefined
                            }
                            textarea = undefined
                            fileTree.toggleCodePanel()
                        }}
                    >
                        ✕
                    </text>
                </box>

                {/* File Path */}
                <Show when={activeFile()}>
                    <box
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={theme.backgroundElement}
                        flexDirection="row"
                        justifyContent="space-between"
                    >
                        <text fg={theme.textMuted}>
                            {activeFile()!.path}
                        </text>
                        <text
                            fg={activeFile()!.modified ? theme.warning : theme.success}
                            onMouseUp={() => {
                                const file = activeFile()
                                if (file) fileTree.saveFile(file.path)
                            }}
                        >
                            {activeFile()!.modified ? "💾 Save" : "✓"}
                        </text>
                    </box>
                </Show>

                {/* Editable Code Content */}
                <Show when={activeFile()} fallback={
                    <text fg={theme.textMuted} paddingLeft={1}>No file selected</text>
                }>
                    <For each={[activeFile()!]}>
                        {(file) => {
                            onCleanup(() => {
                                textarea = undefined
                            })
                            return (
                                <textarea
                                    ref={(val: TextareaRenderable) => {
                                        textarea = val
                                        // Auto-focus when mounted
                                        setTimeout(() => val.focus(), 10)
                                    }}
                                    flexGrow={1}
                                    initialValue={file.content}
                                    textColor={theme.text}
                                    focusedTextColor={theme.text}
                                    cursorColor={theme.accent}
                                    // Note: lineNumbers and onCursor props removed - not supported in current opentui version
                                    keyBindings={CODE_EDITOR_KEYBINDINGS}
                                />
                            )
                        }}
                    </For>
                </Show>

                {/* Status Bar */}
                <Show when={activeFile()}>
                    <box
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={theme.backgroundElement}
                        flexShrink={0}
                    >
                        <text fg={theme.textMuted}>
                            Ln {cursorLine()}, Col {cursorCol()}
                        </text>
                        <text fg={theme.textMuted}>
                            {activeFile()!.language}
                        </text>
                        <text fg={activeFile()!.modified ? theme.warning : theme.success}>
                            {activeFile()!.modified ? "● Modified" : "✓ Saved"}
                        </text>
                        <text fg={theme.textMuted}>
                            {lines().length} lines
                        </text>
                    </box>
                </Show>
            </box>
        </Show>
    )
}
