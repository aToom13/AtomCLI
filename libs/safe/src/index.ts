/**
 * @atomcli/safe
 * 
 * Safe file system access for AtomCLI
 * Prevents "Request Entity Too Large" errors when working with AI models.
 * 
 * Features:
 * - Chunked directory listing (pagination)
 * - Semantic file search (pattern matching)
 * - Safe file reading (size/line limits)
 * 
 * @example
 * ```typescript
 * import { SafeFileReader, FileSearcher, DirectoryChunker } from '@atomcli/safe'
 * 
 * // Safe file reading
 * const reader = new SafeFileReader({ maxLines: 500 })
 * const chunk = await reader.readFirstN('large-file.ts', 100)
 * 
 * // File search
 * const searcher = new FileSearcher({ limit: 20 })
 * const results = await searcher.findByExtension('./src', '.ts')
 * 
 * // Directory pagination
 * const chunker = new DirectoryChunker({ maxItemsPerPage: 50 })
 * const page1 = await chunker.list('./src')
 * const page2 = await chunker.nextPage()
 * ```
 */

// Constants
export * from './constants'

// Types
export * from './types'

// Safe File Reader
export { SafeFileReader, safeFileReader } from './summary/file-reader'

// File Searcher
export { FileSearcher, fileSearcher } from './search/file-searcher'

// Directory Chunker
export { DirectoryChunker, directoryChunker } from './chunker/directory-chunker'
