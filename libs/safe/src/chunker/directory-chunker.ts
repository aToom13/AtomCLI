/**
 * Directory Chunker
 * 
 * Provides paginated directory listing
 * to prevent "Request Entity Too Large" errors.
 */

import { readdir, stat } from "fs/promises"
import { join } from "path"
import {
    DEFAULT_MAX_ITEMS_PER_PAGE,
    DEFAULT_MAX_DEPTH,
    SKIP_DIRECTORIES
} from '../constants'
import type { ChunkerOptions, DirectoryPage, DirectoryItem } from '../types'
import { DirectoryTooLargeError } from '../types'

export class DirectoryChunker {
    private options: Required<ChunkerOptions>
    private currentPage: number = 1
    private cachedItems: DirectoryItem[] = []
    private basePath: string = ''

    constructor(options: Partial<ChunkerOptions> = {}) {
        this.options = {
            maxItemsPerPage: options.maxItemsPerPage ?? DEFAULT_MAX_ITEMS_PER_PAGE,
            maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
            skipDirectories: options.skipDirectories ?? Array.from(SKIP_DIRECTORIES)
        }
    }

    /**
     * List directory contents (first page)
     */
    async list(path: string): Promise<DirectoryPage> {
        this.basePath = path
        this.currentPage = 1
        this.cachedItems = await this.getAllItems(path)

        return this.getCurrentPage()
    }

    /**
     * Get next page of items
     */
    async nextPage(): Promise<DirectoryPage> {
        if (this.cachedItems.length === 0) {
            throw new Error('No directory loaded. Call list() first.')
        }

        const totalPages = Math.ceil(this.cachedItems.length / this.options.maxItemsPerPage)

        if (this.currentPage >= totalPages) {
            return this.getCurrentPage()
        }

        this.currentPage++
        return this.getCurrentPage()
    }

    /**
     * Get previous page of items
     */
    async prevPage(): Promise<DirectoryPage> {
        if (this.cachedItems.length === 0) {
            throw new Error('No directory loaded. Call list() first.')
        }

        if (this.currentPage <= 1) {
            return this.getCurrentPage()
        }

        this.currentPage--
        return this.getCurrentPage()
    }

    /**
     * Go to specific page
     */
    async goToPage(page: number): Promise<DirectoryPage> {
        if (this.cachedItems.length === 0) {
            throw new Error('No directory loaded. Call list() first.')
        }

        const totalPages = Math.ceil(this.cachedItems.length / this.options.maxItemsPerPage)
        this.currentPage = Math.max(1, Math.min(page, totalPages))

        return this.getCurrentPage()
    }

    /**
     * Get current page info
     */
    private getCurrentPage(): DirectoryPage {
        const start = (this.currentPage - 1) * this.options.maxItemsPerPage
        const end = start + this.options.maxItemsPerPage
        const items = this.cachedItems.slice(start, end)
        const totalPages = Math.ceil(this.cachedItems.length / this.options.maxItemsPerPage)

        return {
            items,
            hasMore: this.currentPage < totalPages,
            totalCount: this.cachedItems.length,
            currentPage: this.currentPage,
            totalPages
        }
    }

    /**
     * Get all items from directory (non-recursive)
     */
    private async getAllItems(path: string): Promise<DirectoryItem[]> {
        const entries = await readdir(path, { withFileTypes: true })
        const items: DirectoryItem[] = []

        for (const entry of entries) {
            // Skip configured directories
            if (entry.isDirectory() && this.options.skipDirectories.includes(entry.name)) {
                continue
            }

            const itemPath = join(path, entry.name)
            let size: number | undefined

            if (entry.isFile()) {
                try {
                    const stats = await stat(itemPath)
                    size = stats.size
                } catch {
                    // Skip files that can't be stat'd
                    continue
                }
            }

            items.push({
                name: entry.name,
                path: itemPath,
                isDirectory: entry.isDirectory(),
                size
            })
        }

        // Sort: directories first, then by name
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
        })

        return items
    }

    /**
     * Check if directory has more items than limit
     */
    async checkSize(path: string): Promise<{ count: number; isLarge: boolean }> {
        const entries = await readdir(path, { withFileTypes: true })
        const count = entries.filter(e =>
            !e.isDirectory() || !this.options.skipDirectories.includes(e.name)
        ).length

        return {
            count,
            isLarge: count > this.options.maxItemsPerPage
        }
    }
}

// Default instance
export const directoryChunker = new DirectoryChunker()
