import { For, Show, createMemo, createSignal, createEffect, on } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useFileTree } from "@tui/context/file-tree"
import { useSync } from "@tui/context/sync"
import { InputRenderable } from "@opentui/core"
import { Focusable } from "../context/spatial"
import { Identifier } from "@/core/id/id"
import path from "path"
import fs from "fs"

/**
 * File Tree Component - Collapsible file browser sidebar
 * 
 * Features:
 * - Hamburger toggle (☰)
 * - Recursive directory listing
 * - Collapsible folders
 * - File icons by extension
 * - Click to open in code panel
 * - Auto-refresh on directory toggle and file changes
 * - Search/filter by filename
 */

// File icons by extension
const FILE_ICONS: Record<string, string> = {
    ".ts": "🟦",
    ".tsx": "🟦",
    ".js": "🟨",
    ".jsx": "🟨",
    ".py": "🐍",
    ".rs": "🦀",
    ".go": "🔵",
    ".md": "📝",
    ".json": "📋",
    ".css": "🎨",
    ".html": "🌐",
    ".txt": "📄",
    ".sh": "⚡",
    ".yaml": "⚙️",
    ".yml": "⚙️",
    ".toml": "⚙️",
    ".gitignore": "🔒",
    ".env": "🔐",
}

function getFileIcon(name: string, isDir: boolean): string {
    if (isDir) return "📁"
    const ext = path.extname(name).toLowerCase()
    return FILE_ICONS[ext] || FILE_ICONS[name] || "📄"
}

interface FileEntry {
    name: string
    path: string
    isDir: boolean
}

function readDirectory(dirPath: string): FileEntry[] {
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true })
        return items
            .filter(item => !item.name.startsWith(".") || item.name === ".atomcli")
            .map(item => ({
                name: item.name,
                path: path.join(dirPath, item.name),
                isDir: item.isDirectory(),
            }))
            .sort((a, b) => {
                // Directories first, then alphabetically
                if (a.isDir && !b.isDir) return -1
                if (!a.isDir && b.isDir) return 1
                return a.name.localeCompare(b.name)
            })
    } catch {
        return []
    }
}

// Recursively collect all files matching a search query
function searchFiles(dirPath: string, query: string, maxResults: number = 50): FileEntry[] {
    const results: FileEntry[] = []
    const lowerQuery = query.toLowerCase()

    function walk(dir: string) {
        if (results.length >= maxResults) return
        try {
            const items = fs.readdirSync(dir, { withFileTypes: true })
            for (const item of items) {
                if (results.length >= maxResults) return
                if (item.name.startsWith(".") && item.name !== ".atomcli") continue

                const fullPath = path.join(dir, item.name)
                if (item.isDirectory()) {
                    // Include directory if name matches
                    if (item.name.toLowerCase().includes(lowerQuery)) {
                        results.push({ name: item.name, path: fullPath, isDir: true })
                    }
                    walk(fullPath)
                } else {
                    if (item.name.toLowerCase().includes(lowerQuery)) {
                        results.push({ name: item.name, path: fullPath, isDir: false })
                    }
                }
            }
        } catch {
            // Ignore permission errors
        }
    }

    walk(dirPath)
    return results
}

// Global refresh counter - triggers re-read when changed
let globalRefreshCounter = 0

export function triggerFileTreeRefresh() {
    globalRefreshCounter++
}

function FileTreeNode(props: { dirPath: string; depth: number }) {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const [entries, setEntries] = createSignal<FileEntry[]>([])
    const [localRefresh, setLocalRefresh] = createSignal(0)

    const isExpanded = createMemo(() => fileTree.isDirExpanded(props.dirPath))
    const indent = createMemo(() => props.depth * 2)

    // Re-read directory when expanded state changes
    createEffect(on(
        () => [isExpanded(), localRefresh()],
        () => {
            // Always re-read when this effect runs
            setEntries(readDirectory(props.dirPath))
        }
    ))

    const handleClick = (entry: FileEntry) => {
        if (entry.isDir) {
            fileTree.toggleDir(entry.path)
            // Force parent refresh when toggling
            setLocalRefresh(r => r + 1)
        } else {
            fileTree.openFile(entry.path)
        }
    }

    return (
        <For each={entries()}>
            {(entry) => {
                const id = `filetree-node-${entry.path}`
                return (
                    <box>
                        <Focusable id={id} onPress={() => handleClick(entry)}>
                            {(focused: () => boolean) => (
                                <box
                                    flexDirection="row"
                                    gap={1}
                                    paddingLeft={indent()}
                                    onMouseUp={() => handleClick(entry)}
                                    backgroundColor={focused() ? theme.primary : undefined}
                                >
                                    <Show when={entry.isDir}>
                                        <text fg={theme.textMuted}>
                                            {fileTree.isDirExpanded(entry.path) ? "▼" : "▶"}
                                        </text>
                                    </Show>
                                    <text fg={theme.text}>
                                        {getFileIcon(entry.name, entry.isDir)} {entry.name}
                                    </text>
                                </box>
                            )}
                        </Focusable>

                        <Show when={entry.isDir && fileTree.isDirExpanded(entry.path)}>
                            <FileTreeNode
                                dirPath={entry.path}
                                depth={props.depth + 1}
                            />
                        </Show>
                    </box>
                )
            }}
        </For>
    )
}

// Search results flat list component
function SearchResults(props: { results: FileEntry[] }) {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const sync = useSync()
    const directory = createMemo(() => sync.data.path.directory || process.cwd())

    return (
        <For each={props.results}>
            {(entry) => {
                const relativePath = createMemo(() => {
                    const rel = path.relative(directory(), path.dirname(entry.path))
                    return rel ? rel + "/" : ""
                })

                return (
                    <Focusable id={`filetree-search-${entry.path}`} onPress={() => {
                        if (entry.isDir) {
                            fileTree.toggleDir(entry.path)
                        } else {
                            fileTree.openFile(entry.path)
                        }
                    }}>
                        {(focused: () => boolean) => (
                            <box
                                flexDirection="row"
                                gap={1}
                                paddingLeft={1}
                                onMouseUp={() => {
                                    if (entry.isDir) {
                                        fileTree.toggleDir(entry.path)
                                    } else {
                                        fileTree.openFile(entry.path)
                                    }
                                }}
                                backgroundColor={focused() ? theme.primary : undefined}
                            >
                                <text fg={theme.text}>
                                    {getFileIcon(entry.name, entry.isDir)} <span style={{ fg: theme.textMuted }}>{relativePath()}</span>{entry.name}
                                </text>
                            </box>
                        )}
                    </Focusable>
                )
            }}
        </For>
    )
}

export function FileTree() {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const sync = useSync()

    // Get raw directory path (not the formatted one with ~)
    const directory = createMemo(() => sync.data.path.directory || process.cwd())

    // Local refresh key for manual refresh
    const [refreshKey, setRefreshKey] = createSignal(0)

    // Search state
    const [searchQuery, setSearchQuery] = createSignal("")

    // Search results
    const searchResults = createMemo(() => {
        const q = searchQuery().trim()
        if (!q) return []
        return searchFiles(directory(), q)
    })

    const hasSearch = createMemo(() => searchQuery().trim().length > 0)

    // Auto-refresh when file tree becomes visible or when openFiles changes
    createEffect(on(
        () => [fileTree.state.visible, fileTree.state.openFiles.length],
        () => {
            if (fileTree.state.visible) {
                setRefreshKey(k => k + 1)
            }
        }
    ))

    // Auto-refresh every 2 seconds when visible
    createEffect(() => {
        if (!fileTree.state.visible) return

        const interval = setInterval(() => {
            setRefreshKey(k => k + 1)
        }, 2000)

        return () => clearInterval(interval)
    })

    return (
        <box
            width={fileTree.state.visible ? 28 : 3}
            backgroundColor={theme.backgroundPanel}
            borderColor={theme.border}
            border={["right"]}
        >
            {/* Hamburger Header */}
            <Focusable id={Identifier.ascending("part")} onPress={() => fileTree.toggleFileTree()}>
                {(focused: () => boolean) => (
                    <box
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={focused() ? theme.primary : theme.backgroundElement}
                        onMouseUp={() => fileTree.toggleFileTree()}
                    >
                        <text fg={theme.text}>☰</text>
                        <Show when={fileTree.state.visible}>
                            <text fg={theme.textMuted}>Files</text>
                            <text fg={theme.textMuted}>◀</text>
                        </Show>
                    </box>
                )}
            </Focusable>

            {/* File Tree Content */}
            <Show when={fileTree.state.visible}>
                {/* Search Input */}
                <box paddingLeft={1} paddingRight={1}>
                    <input
                        onInput={(value) => setSearchQuery(value)}
                        placeholder="Search files..."
                        placeholderColor={theme.textMuted}
                        focusedBackgroundColor={theme.backgroundElement}
                        backgroundColor={theme.backgroundPanel}
                        textColor={theme.text}
                        focusedTextColor={theme.text}
                        cursorColor={theme.primary}
                    />
                </box>

                <scrollbox flexGrow={1} paddingTop={1}>
                    <Show when={hasSearch()} fallback={
                        /* Normal tree view */
                        <Show when={refreshKey() >= 0}>
                            <FileTreeNode
                                dirPath={directory()}
                                depth={0}
                            />
                        </Show>
                    }>
                        {/* Search results */}
                        <SearchResults results={searchResults()} />
                        <Show when={searchResults().length === 0}>
                            <text fg={theme.textMuted} paddingLeft={1}>No results</text>
                        </Show>
                    </Show>
                </scrollbox>
            </Show>
        </box>
    )
}
