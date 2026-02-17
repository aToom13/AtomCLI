/**
 * Safe File Reader
 * 
 * Provides safe file reading with size and line limits
 * to prevent "Request Entity Too Large" errors.
 * Compatible with Bun runtime.
 */

import { extname } from "path"
import {
    DEFAULT_MAX_LINES,
    DEFAULT_MAX_FILE_SIZE,
    BINARY_EXTENSIONS
} from '../constants'
import type { ReaderOptions, FileInfo, FileChunk } from '../types'
import { FileTooLargeError, BinaryFileError } from '../types'

// Bun global type
declare const Bun: {
    file: (path: string) => {
        size: number
        lastModified: number
        text: () => Promise<string>
        arrayBuffer: () => Promise<ArrayBuffer>
        exists: () => Promise<boolean>
    }
}

export class SafeFileReader {
    private options: Required<ReaderOptions>

    constructor(options: Partial<ReaderOptions> = {}) {
        this.options = {
            maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
            maxFileSize: options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
            skipBinary: options.skipBinary ?? true
        }
    }

    /**
     * Check if a file is binary based on extension
     */
    async isBinary(path: string): Promise<boolean> {
        const ext = extname(path).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) {
            return true
        }

        // Check file content for null bytes (common binary indicator)
        try {
            const file = Bun.file(path)
            const buffer = await file.arrayBuffer()
            const view = new Uint8Array(buffer, 0, Math.min(8192, buffer.byteLength))

            for (let i = 0; i < view.length; i++) {
                if (view[i] === 0) {
                    return true
                }
            }
            return false
        } catch {
            return false
        }
    }

    /**
     * Get file information
     */
    async getFileInfo(path: string): Promise<FileInfo> {
        const file = Bun.file(path)
        const exists = await file.exists()

        if (!exists) {
            throw new Error(`File not found: ${path}`)
        }

        const isBinary = await this.isBinary(path)

        let lines = 0
        if (!isBinary) {
            lines = await this.countLines(path)
        }

        return {
            name: path.split('/').pop() ?? path,
            path,
            size: file.size,
            lines,
            isBinary,
            extension: extname(path),
            lastModified: new Date(file.lastModified)
        }
    }

    /**
     * Check if file is too large
     */
    async isTooLarge(path: string): Promise<boolean> {
        const file = Bun.file(path)
        return file.size > this.options.maxFileSize
    }

    /**
     * Count lines in a file
     */
    private async countLines(path: string): Promise<number> {
        const file = Bun.file(path)
        const text = await file.text()
        let lines = 0
        const maxCheck = this.options.maxLines * 10

        for (let i = 0; i < text.length && lines < maxCheck; i++) {
            if (text[i] === '\n') {
                lines++
            }
        }

        // Add one more if file doesn't end with newline
        if (text.length > 0 && text[text.length - 1] !== '\n') {
            lines++
        }

        return lines
    }

    /**
     * Read entire file (with safety checks)
     */
    async read(path: string): Promise<string> {
        const file = Bun.file(path)

        // Check file size
        if (file.size > this.options.maxFileSize) {
            throw new FileTooLargeError(path, file.size, this.options.maxFileSize)
        }

        // Check if binary
        if (this.options.skipBinary && await this.isBinary(path)) {
            throw new BinaryFileError(path)
        }

        return file.text()
    }

    /**
     * Read first N lines of a file
     */
    async readFirstN(path: string, n?: number): Promise<FileChunk> {
        const linesToRead = n ?? this.options.maxLines

        // Check if binary
        if (this.options.skipBinary && await this.isBinary(path)) {
            throw new BinaryFileError(path)
        }

        const file = Bun.file(path)
        const text = await file.text()
        const allLines = text.split('\n')
        const totalLines = allLines.length
        const lines = allLines.slice(0, linesToRead)

        return {
            content: lines.join('\n'),
            startLine: 1,
            endLine: lines.length,
            totalLines,
            hasMore: totalLines > linesToRead
        }
    }

    /**
     * Read last N lines of a file
     */
    async readLastN(path: string, n?: number): Promise<FileChunk> {
        const linesToRead = n ?? this.options.maxLines

        // Check if binary
        if (this.options.skipBinary && await this.isBinary(path)) {
            throw new BinaryFileError(path)
        }

        const file = Bun.file(path)
        const text = await file.text()
        const allLines = text.split('\n')
        const totalLines = allLines.length
        const lines = allLines.slice(-linesToRead)

        return {
            content: lines.join('\n'),
            startLine: Math.max(1, totalLines - linesToRead + 1),
            endLine: totalLines,
            totalLines,
            hasMore: totalLines > linesToRead
        }
    }

    /**
     * Read a specific range of lines
     */
    async readRange(path: string, start: number, end: number): Promise<FileChunk> {
        // Check if binary
        if (this.options.skipBinary && await this.isBinary(path)) {
            throw new BinaryFileError(path)
        }

        const file = Bun.file(path)
        const text = await file.text()
        const allLines = text.split('\n')
        const totalLines = allLines.length
        const lines = allLines.slice(start - 1, end)

        return {
            content: lines.join('\n'),
            startLine: start,
            endLine: Math.min(end, totalLines),
            totalLines,
            hasMore: totalLines > end
        }
    }

    /**
     * Read file with automatic truncation if too large
     */
    async readSafe(path: string): Promise<FileChunk> {
        const info = await this.getFileInfo(path)

        if (info.isBinary) {
            throw new BinaryFileError(path)
        }

        if (info.size > this.options.maxFileSize || info.lines > this.options.maxLines) {
            // Return first N lines with a warning
            const chunk = await this.readFirstN(path, this.options.maxLines)
            return {
                ...chunk,
                content: `// [TRUNCATED: Showing first ${chunk.endLine} of ${info.lines} lines]\n\n${chunk.content}`
            }
        }

        const content = await this.read(path)
        return {
            content,
            startLine: 1,
            endLine: info.lines,
            totalLines: info.lines,
            hasMore: false
        }
    }
}

// Default instance
export const safeFileReader = new SafeFileReader()
