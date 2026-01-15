import { For, Show, createMemo, createSignal, createEffect, on } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useFileTree } from "@tui/context/file-tree"
import { useSync } from "@tui/context/sync"
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
            {(entry) => (
                <box>
                    <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={indent()}
                        onMouseUp={() => handleClick(entry)}
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

                    <Show when={entry.isDir && fileTree.isDirExpanded(entry.path)}>
                        <FileTreeNode
                            dirPath={entry.path}
                            depth={props.depth + 1}
                        />
                    </Show>
                </box>
            )}
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
            <box
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
                onMouseUp={() => fileTree.toggleFileTree()}
            >
                <text fg={theme.text}>☰</text>
                <Show when={fileTree.state.visible}>
                    <text fg={theme.textMuted}>Files</text>
                    <text fg={theme.textMuted}>◀</text>
                </Show>
            </box>

            {/* File Tree Content */}
            <Show when={fileTree.state.visible}>
                <scrollbox flexGrow={1} paddingTop={1}>
                    {/* Key forces re-mount on refresh */}
                    <Show when={refreshKey() >= 0}>
                        <FileTreeNode
                            dirPath={directory()}
                            depth={0}
                        />
                    </Show>
                </scrollbox>
            </Show>
        </box>
    )
}
