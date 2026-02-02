import { createContext, useContext, createSignal, type Accessor, type Setter, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import path from "path"
import { Log } from "@/util/log"

/**
 * File Tree Context - Global state for file browser and code panel
 *
 * Provides:
 * - File tree visibility toggle
 * - Open files management
 * - Active file tracking
 * - Directory expansion state
 */

export interface OpenFile {
  path: string
  content: string
  language: string
  modified: boolean
  highlight?: {
    startLine: number
    endLine: number
  }
}

export interface FileTreeState {
  visible: boolean
  expandedDirs: Set<string>
  openFiles: OpenFile[]
  activeFile: string | null
  codePanelVisible: boolean
}

export interface FileTreeContextValue {
  state: FileTreeState

  // File tree operations
  toggleFileTree: () => void
  toggleDir: (dirPath: string) => void
  isDirExpanded: (dirPath: string) => boolean

  // Code panel operations
  toggleCodePanel: () => void
  openFile: (
    filePath: string,
    content?: string,
    language?: string,
    highlight?: { startLine: number; endLine: number },
  ) => void
  closeFile: (filePath: string) => void
  setActiveFile: (filePath: string) => void
  updateFileContent: (filePath: string, content: string) => void
  saveFile: (filePath: string) => Promise<void>

  // Getters
  getActiveFile: () => OpenFile | undefined
  hasOpenFiles: () => boolean
}

const FileTreeContext = createContext<FileTreeContextValue>()

// Detect language from file extension
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".json": "json",
    ".md": "markdown",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".sql": "sql",
    ".txt": "text",
  }
  return langMap[ext] || "text"
}

export function FileTreeProvider(props: ParentProps) {
  const [state, setState] = createStore<FileTreeState>({
    visible: false,
    expandedDirs: new Set<string>(),
    openFiles: [],
    activeFile: null,
    codePanelVisible: false,
  })

  const toggleFileTree = () => {
    setState("visible", !state.visible)
  }

  const toggleDir = (dirPath: string) => {
    setState(
      produce((s) => {
        if (s.expandedDirs.has(dirPath)) {
          s.expandedDirs.delete(dirPath)
        } else {
          s.expandedDirs.add(dirPath)
        }
      }),
    )
  }

  const isDirExpanded = (dirPath: string) => {
    return state.expandedDirs.has(dirPath)
  }

  const toggleCodePanel = () => {
    setState("codePanelVisible", !state.codePanelVisible)
  }

  const openFile = async (
    filePath: string,
    content?: string,
    language?: string,
    highlight?: { startLine: number; endLine: number },
  ) => {
    // Check if file is already open
    const existing = state.openFiles.find((f) => f.path === filePath)
    if (existing) {
      setState("activeFile", filePath)
      setState("codePanelVisible", true)
      if (highlight) {
        setState(
          produce((s) => {
            const file = s.openFiles.find((f) => f.path === filePath)
            if (file) file.highlight = highlight
          }),
        )
      }
      return
    }

    // Read file content if not provided
    let fileContent = content
    if (!fileContent) {
      try {
        const file = Bun.file(filePath)
        fileContent = await file.text()
      } catch {
        fileContent = "// Error reading file"
      }
    }

    const newFile: OpenFile = {
      path: filePath,
      content: fileContent,
      language: language || detectLanguage(filePath),
      modified: false,
      highlight,
    }

    setState(
      produce((s) => {
        s.openFiles.push(newFile)
        s.activeFile = filePath
        s.codePanelVisible = true
      }),
    )
  }

  const closeFile = (filePath: string) => {
    setState(
      produce((s) => {
        const index = s.openFiles.findIndex((f) => f.path === filePath)
        if (index !== -1) {
          s.openFiles.splice(index, 1)
          // If closing active file, switch to another
          if (s.activeFile === filePath) {
            s.activeFile = s.openFiles[0]?.path || null
          }
          // Hide code panel if no files open
          if (s.openFiles.length === 0) {
            s.codePanelVisible = false
          }
        }
      }),
    )
  }

  const setActiveFile = (filePath: string) => {
    setState("activeFile", filePath)
  }

  const updateFileContent = (filePath: string, content: string) => {
    setState(
      produce((s) => {
        const file = s.openFiles.find((f) => f.path === filePath)
        if (file) {
          file.content = content
          file.modified = true
        }
      }),
    )
  }

  const saveFile = async (filePath: string) => {
    const file = state.openFiles.find((f) => f.path === filePath)
    if (!file) return

    try {
      await Bun.write(filePath, file.content)
      setState(
        produce((s) => {
          const f = s.openFiles.find((f) => f.path === filePath)
          if (f) f.modified = false
        }),
      )
    } catch (error) {
      Log.Default.error("Failed to save file", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const getActiveFile = () => {
    return state.openFiles.find((f) => f.path === state.activeFile)
  }

  const hasOpenFiles = () => {
    return state.openFiles.length > 0
  }

  const value: FileTreeContextValue = {
    state,
    toggleFileTree,
    toggleDir,
    isDirExpanded,
    toggleCodePanel,
    openFile,
    closeFile,
    setActiveFile,
    updateFileContent,
    saveFile,
    getActiveFile,
    hasOpenFiles,
  }

  return <FileTreeContext.Provider value={value}>{props.children}</FileTreeContext.Provider>
}

export function useFileTree() {
  const ctx = useContext(FileTreeContext)
  if (!ctx) {
    throw new Error("useFileTree must be used within a FileTreeProvider")
  }
  return ctx
}
