import { For, Show, createMemo, createSignal, createEffect, on, onCleanup } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useFileTree } from "@tui/context/file-tree"
import { useSync } from "@tui/context/sync"
import { InputRenderable } from "@opentui/core"
import { Focusable } from "../context/spatial"
import { Identifier } from "@/core/id/id"
import path from "path"
import fs from "fs"
import { FileSearch } from "./file-search"

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

type FileEntry = FileSearch.Entry

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

function FileTreeNode(props: { dirPath: string; depth: number; refreshKey: number }) {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const [entries, setEntries] = createSignal<FileEntry[]>([])
    const [localRefresh, setLocalRefresh] = createSignal(0)

    const isExpanded = createMemo(() => fileTree.isDirExpanded(props.dirPath))
    const indent = createMemo(() => props.depth * 2)

    // Re-read directory when expanded state changes
    createEffect(on(
        () => [isExpanded(), localRefresh(), props.refreshKey],
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
                                refreshKey={props.refreshKey}
                            />
                        </Show>
                    </box>
                )
            }}
        </For>
    )
}

// Search results flat list component
function SearchResults(props: { results: FileEntry[]; onSelect: () => void }) {
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

                const select = () => {
                    props.onSelect()
                    if (entry.isDir) {
                        fileTree.toggleDir(entry.path)
                    } else {
                        fileTree.openFile(entry.path)
                    }
                }

                return (
                    <Focusable id={`filetree-search-${entry.path}`} onPress={() => {
                        select()
                    }}>
                        {(focused: () => boolean) => (
                            <box
                                flexDirection="row"
                                gap={1}
                                paddingLeft={1}
                                onMouseUp={select}
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

export function FileTree(props: { width: number; expanded: boolean }) {
    const { theme } = useTheme()
    const fileTree = useFileTree()
    const sync = useSync()

    // Get raw directory path (not the formatted one with ~)
    const directory = createMemo(() => sync.data.path.directory || process.cwd())

    // Local refresh key for manual refresh
    const [refreshKey, setRefreshKey] = createSignal(0)

    // Search state
    const [searchQuery, setSearchQuery] = createSignal("")
    const [searchResults, setSearchResults] = createSignal<FileEntry[]>([])
    const [searching, setSearching] = createSignal(false)
    let searchInput: InputRenderable | undefined
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    let searchRequest = 0

    const hasSearch = createMemo(() => searchQuery().trim().length > 0)

    createEffect(on(
        () => fileTree.state.visible,
        (visible, wasVisible) => {
            // Do not steal focus from the prompt when Files starts visible.
            // Focus only after an explicit collapsed -> visible toggle.
            if (!visible || wasVisible !== false) return
            setTimeout(() => searchInput?.focus(), 0)
        },
    ))

    createEffect(on(
        () => [directory(), searchQuery()] as const,
        ([root, query]) => {
            const request = ++searchRequest
            if (searchTimer) clearTimeout(searchTimer)
            if (!query.trim()) {
                setSearchResults([])
                setSearching(false)
                return
            }
            setSearching(true)
            searchTimer = setTimeout(async () => {
                const results = await FileSearch.find(root, query)
                if (request !== searchRequest) return
                setSearchResults(results)
                setSearching(false)
            }, 120)
        },
    ))

    onCleanup(() => {
        searchRequest++
        if (searchTimer) clearTimeout(searchTimer)
    })

    // Auto-refresh when file tree becomes visible or when openFiles changes
    createEffect(on(
        () => [props.expanded, fileTree.state.openFiles.length],
        () => {
            if (props.expanded) {
                setRefreshKey(k => k + 1)
            }
        }
    ))

    // Auto-refresh every 2 seconds when visible
    createEffect(() => {
        if (!props.expanded) return

        const interval = setInterval(() => {
            setRefreshKey(k => k + 1)
        }, 2000)

        return () => clearInterval(interval)
    })

    return (
        <box
            width={props.width}
            flexShrink={0}
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
                        <Show when={props.expanded}>
                            <text fg={theme.textMuted}>Files</text>
                            <text fg={theme.textMuted}>◀</text>
                        </Show>
                    </box>
                )}
            </Focusable>

            {/* File Tree Content */}
            <Show when={props.expanded}>
                {/* Search Input */}
                <box paddingLeft={1} paddingRight={1}>
                    <input
                        ref={(input: InputRenderable) => (searchInput = input)}
                        onInput={(value) => setSearchQuery(value)}
                        onMouseDown={() => searchInput?.focus()}
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
                        <FileTreeNode
                            dirPath={directory()}
                            depth={0}
                            refreshKey={refreshKey()}
                        />
                    }>
                        {/* Search results */}
                        <SearchResults
                            results={searchResults()}
                            onSelect={() => {
                                if (searchInput) searchInput.value = ""
                                setSearchQuery("")
                            }}
                        />
                        <Show when={searching()}>
                            <text fg={theme.textMuted} paddingLeft={1}>Searching…</text>
                        </Show>
                        <Show when={!searching() && searchResults().length === 0}>
                            <text fg={theme.textMuted} paddingLeft={1}>No results</text>
                        </Show>
                    </Show>
                </scrollbox>
            </Show>
        </box>
    )
}
