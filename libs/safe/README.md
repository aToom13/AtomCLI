# @atomcli/safe

Safe file system access for AtomCLI - prevents "Request Entity Too Large" errors when working with AI models.

## Features

- **Chunked Directory Listing** - Paginate large directories
- **Semantic File Search** - Find files by pattern, name, or extension
- **Safe File Reading** - Read files with size and line limits

## Installation

```bash
bun add @atomcli/safe
```

## Usage

### Safe File Reader

```typescript
import { SafeFileReader } from '@atomcli/safe'

const reader = new SafeFileReader({
  maxLines: 500,      // Max lines to read
  maxFileSize: 1MB,   // Max file size in bytes
  skipBinary: true    // Skip binary files
})

// Read first N lines
const chunk = await reader.readFirstN('large-file.ts', 100)
console.log(chunk.content)
console.log(chunk.hasMore)  // true if file has more lines

// Read last N lines
const lastLines = await reader.readLastN('large-file.ts', 50)

// Read specific range
const range = await reader.readRange('file.ts', 100, 200)

// Safe read with auto-truncation
const safe = await reader.readSafe('potentially-large.ts')

// Get file info
const info = await reader.getFileInfo('file.ts')
console.log(info.lines, info.size, info.isBinary)
```

### File Searcher

```typescript
import { FileSearcher } from '@atomcli/safe'

const searcher = new FileSearcher({
  limit: 20,              // Max results
  filePattern: '*.ts',    // Glob pattern
  excludePatterns: ['**/node_modules/**']
})

// Find by extension
const tsFiles = await searcher.findByExtension('./src', '.ts')

// Find by name
const configFiles = await searcher.findByName('.', 'config')

// Search in content
const results = await searcher.searchInContent('./src', 'function')
results.forEach(r => {
  console.log(r.path, r.matchCount)
  r.matches.forEach(m => console.log(`  Line ${m.lineNumber}: ${m.lineContent}`))
})

// Regex search
const regexResults = await searcher.search('./src', /TODO|FIXME/)
```

### Directory Chunker

```typescript
import { DirectoryChunker } from '@atomcli/safe'

const chunker = new DirectoryChunker({
  maxItemsPerPage: 50,    // Items per page
  skipDirectories: ['node_modules', '.git']
})

// List first page
const page1 = await chunker.list('./src')
console.log(`Page ${page1.currentPage}/${page1.totalPages}`)
console.log(`Total items: ${page1.totalCount}`)
page1.items.forEach(item => {
  console.log(`${item.isDirectory ? '📁' : '📄'} ${item.name}`)
})

// Next page
if (page1.hasMore) {
  const page2 = await chunker.nextPage()
}

// Go to specific page
const page5 = await chunker.goToPage(5)

// Check directory size
const { count, isLarge } = await chunker.checkSize('./src')
if (isLarge) {
  console.log(`Large directory: ${count} items`)
}
```

## Error Handling

```typescript
import { 
  SafeFileReader, 
  FileTooLargeError, 
  BinaryFileError 
} from '@atomcli/safe'

const reader = new SafeFileReader()

try {
  const content = await reader.read('large-file.ts')
} catch (e) {
  if (e instanceof FileTooLargeError) {
    console.log(`File too large: ${e.size} > ${e.maxSize}`)
  } else if (e instanceof BinaryFileError) {
    console.log(`Binary file: ${e.path}`)
  }
}
```

## Constants

```typescript
import { 
  MAX_TOKENS,           // 200,000
  MAX_CHARS,            // ~800,000
  DEFAULT_MAX_LINES,    // 500
  DEFAULT_MAX_FILE_SIZE,// 1MB
  DEFAULT_MAX_ITEMS_PER_PAGE, // 50
  BINARY_EXTENSIONS,    // Set of binary file extensions
  SKIP_DIRECTORIES      // Set of directories to skip
} from '@atomcli/safe'
```

## License

MIT
