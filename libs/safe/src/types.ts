/**
 * Safe File System Types
 */

// ============= File Reader Types =============

export interface ReaderOptions {
    /** Maximum lines to read (default: 500) */
    maxLines: number
    /** Maximum file size in bytes (default: 1MB) */
    maxFileSize: number
    /** Skip binary files automatically (default: true) */
    skipBinary: boolean
}

export interface FileInfo {
    name: string
    path: string
    size: number
    lines: number
    isBinary: boolean
    extension: string
    lastModified: Date
}

export interface FileChunk {
    content: string
    startLine: number
    endLine: number
    totalLines: number
    hasMore: boolean
}

// ============= Directory Chunker Types =============

export interface ChunkerOptions {
    /** Maximum items per page (default: 50) */
    maxItemsPerPage: number
    /** Maximum depth for recursive listing (default: 1) */
    maxDepth: number
    /** Directories to skip */
    skipDirectories: string[]
}

export interface DirectoryPage {
    items: DirectoryItem[]
    hasMore: boolean
    totalCount: number
    currentPage: number
    totalPages: number
}

export interface DirectoryItem {
    name: string
    path: string
    isDirectory: boolean
    size?: number
}

// ============= Search Types =============

export interface SearchOptions {
    /** Maximum results to return (default: 20) */
    limit: number
    /** Glob pattern for file filtering (e.g., "*.ts") */
    filePattern?: string
    /** Patterns to exclude */
    excludePatterns: string[]
    /** Case sensitive search (default: false) */
    caseSensitive: boolean
}

export interface SearchResult {
    path: string
    fileName: string
    matches: SearchMatch[]
    matchCount: number
}

export interface SearchMatch {
    lineNumber: number
    lineContent: string
    matchStart: number
    matchEnd: number
}

// ============= Error Types =============

export class FileTooLargeError extends Error {
    constructor(
        public path: string,
        public size: number,
        public maxSize: number
    ) {
        super(`File "${path}" is too large (${size} bytes > ${maxSize} bytes limit)`)
        this.name = 'FileTooLargeError'
    }
}

export class BinaryFileError extends Error {
    constructor(public path: string) {
        super(`File "${path}" appears to be binary and cannot be read as text`)
        this.name = 'BinaryFileError'
    }
}

export class DirectoryTooLargeError extends Error {
    constructor(
        public path: string,
        public itemCount: number,
        public maxItems: number
    ) {
        super(`Directory "${path}" has too many items (${itemCount} > ${maxItems} limit). Use pagination.`)
        this.name = 'DirectoryTooLargeError'
    }
}
