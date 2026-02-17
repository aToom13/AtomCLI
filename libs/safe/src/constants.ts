/**
 * Safe File System Constants
 * 
 * Limits to prevent "Request Entity Too Large" errors
 * when working with AI models that have token limits.
 */

// Maximum tokens for most AI models (safe limit)
export const MAX_TOKENS = 200000

// Approximate characters per token (conservative estimate)
export const CHARS_PER_TOKEN = 4

// Maximum characters that can be safely processed
export const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN // ~800,000 chars

// File reading limits
export const DEFAULT_MAX_LINES = 500
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 // 1MB

// Directory listing limits
export const DEFAULT_MAX_ITEMS_PER_PAGE = 50
export const DEFAULT_MAX_DEPTH = 1

// Search limits
export const DEFAULT_SEARCH_LIMIT = 20
export const MAX_SEARCH_RESULTS = 100

// Binary file extensions to skip
export const BINARY_EXTENSIONS = new Set([
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    // Audio/Video
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv', '.wmv',
    // Archives
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
    // Executables
    '.exe', '.dll', '.so', '.dylib', '.bin', '.app',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Fonts
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    // Database
    '.db', '.sqlite', '.sqlite3',
    // Other
    '.lock', '.pid', '.node_modules'
])

// Directories to skip by default
export const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    'tmp',
    'temp'
])
