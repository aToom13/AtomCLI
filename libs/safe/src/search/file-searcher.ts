/**
 * File Searcher
 * 
 * Provides semantic file search with pattern matching
 * to find files without reading entire directories.
 */

import { glob } from "glob"
import { minimatch } from "minimatch"
import {
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_RESULTS,
    SKIP_DIRECTORIES
} from '../constants'
import type { SearchOptions, SearchResult, SearchMatch } from '../types'

export class FileSearcher {
    private options: Required<SearchOptions>

    constructor(options: Partial<SearchOptions> = {}) {
        this.options = {
            limit: options.limit ?? DEFAULT_SEARCH_LIMIT,
            filePattern: options.filePattern ?? '*',
            excludePatterns: options.excludePatterns ?? Array.from(SKIP_DIRECTORIES).map(d => `**/${d}/**`),
            caseSensitive: options.caseSensitive ?? false
        }
    }

    /**
     * Search for files matching a regex pattern
     */
    async search(path: string, pattern: RegExp): Promise<SearchResult[]> {
        const files = await this.findFiles(path)
        const results: SearchResult[] = []

        for (const file of files) {
            if (results.length >= this.options.limit) break

            try {
                const content = await Bun.file(file).text()
                const matches = this.findMatches(content, pattern)

                if (matches.length > 0) {
                    results.push({
                        path: file,
                        fileName: file.split('/').pop() ?? file,
                        matches: matches.slice(0, 10), // Max 10 matches per file
                        matchCount: matches.length
                    })
                }
            } catch {
                // Skip files that can't be read
                continue
            }
        }

        return results
    }

    /**
     * Find files by name pattern
     */
    async findByName(path: string, name: string): Promise<string[]> {
        const pattern = `**/*${name}*`
        const files = await glob(pattern, {
            cwd: path,
            nodir: true,
            ignore: this.options.excludePatterns,
            maxDepth: 10
        })

        return files.slice(0, this.options.limit)
    }

    /**
     * Find files by extension
     */
    async findByExtension(path: string, ext: string): Promise<string[]> {
        const extension = ext.startsWith('.') ? ext : `.${ext}`
        const pattern = `**/*${extension}`

        const files = await glob(pattern, {
            cwd: path,
            nodir: true,
            ignore: this.options.excludePatterns,
            maxDepth: 10
        })

        return files.slice(0, this.options.limit)
    }

    /**
     * Search for text in file contents
     */
    async searchInContent(path: string, query: string): Promise<SearchResult[]> {
        const flags = this.options.caseSensitive ? 'g' : 'gi'
        const pattern = new RegExp(this.escapeRegex(query), flags)
        return this.search(path, pattern)
    }

    /**
     * Find all files matching the file pattern
     */
    private async findFiles(path: string): Promise<string[]> {
        const pattern = `**/${this.options.filePattern}`

        const files = await glob(pattern, {
            cwd: path,
            nodir: true,
            ignore: this.options.excludePatterns,
            maxDepth: 10
        })

        return files.slice(0, MAX_SEARCH_RESULTS)
    }

    /**
     * Find all matches in content
     */
    private findMatches(content: string, pattern: RegExp): SearchMatch[] {
        const matches: SearchMatch[] = []
        const lines = content.split('\n')

        // Reset regex
        pattern.lastIndex = 0

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            let match: RegExpExecArray | null

            // Reset for each line
            pattern.lastIndex = 0

            while ((match = pattern.exec(line)) !== null) {
                matches.push({
                    lineNumber: i + 1,
                    lineContent: line.trim(),
                    matchStart: match.index,
                    matchEnd: match.index + match[0].length
                })

                // Prevent infinite loop for zero-length matches
                if (match[0].length === 0) {
                    pattern.lastIndex++
                }
            }
        }

        return matches
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
}

// Default instance
export const fileSearcher = new FileSearcher()

// Bun type declaration
declare const Bun: {
    file: (path: string) => {
        text: () => Promise<string>
    }
}
