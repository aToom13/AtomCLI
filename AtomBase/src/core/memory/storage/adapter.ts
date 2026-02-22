/**
 * Memory Storage Adapter
 * 
 * Abstract storage interface for memory items.
 * Supports JSON file storage and ChromaDB vector storage.
 */

import type {
  MemoryItem,
  MemoryType,
  SearchOptions,
  MemoryStats,
  SearchResult,
} from "../types"

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.storage" })

// Import implementations
import { JSONStorage } from "./json"
import { ChromaStorage } from "./vector"

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Abstract storage interface
 */
export interface MemoryStorage {
  // CRUD Operations
  create(item: MemoryItem): Promise<void>
  read(id: string): Promise<MemoryItem | null>
  update(id: string, item: Partial<MemoryItem>): Promise<void>
  delete(id: string): Promise<void>

  // Bulk Operations
  createMany(items: MemoryItem[]): Promise<void>
  readMany(ids: string[]): Promise<MemoryItem[]>
  deleteMany(ids: string[]): Promise<void>

  // Search Operations
  search(query: string, options?: SearchOptions): Promise<MemoryItem[]>
  searchByType(type: MemoryType): Promise<MemoryItem[]>
  searchByContext(context: string): Promise<MemoryItem[]>
  getRecent(limit: number): Promise<MemoryItem[]>
  getTopUsed(limit: number): Promise<MemoryItem[]>

  // Statistics
  getStats(): Promise<MemoryStats>
  getCount(): Promise<number>

  // Maintenance
  clear(): Promise<void>
  vacuum(): Promise<void>
}

/**
 * Vector storage interface for semantic search
 */
export interface VectorStorage {
  // Initialize collection
  initialize(): Promise<void>

  // Upsert vectors
  upsert(items: Array<{ id: string; vector: number[]; payload: MemoryItem }>): Promise<void>

  // Search
  search(queryVector: number[], limit: number, filter?: Record<string, any>): Promise<Array<{ id: string; score: number; payload: MemoryItem }>>

  // Delete
  delete(ids: string[]): Promise<void>

  // Maintenance
  clear(): Promise<void>
  count(): Promise<number>
}

// ============================================================================
// STORAGE FACTORY
// ============================================================================

/**
 * Storage configuration
 */
export interface StorageConfig {
  type: "json" | "chroma" | "hybrid"
  jsonPath?: string
  chromaPath?: string
}

/**
 * Create storage instance based on config
 */
export async function createStorage(config: StorageConfig): Promise<MemoryStorage> {
  switch (config.type) {
    case "json": {
      log.info("creating JSON storage", { path: config.jsonPath })
      const storage = new JSONStorage(config.jsonPath || getDefaultJsonPath())
      await storage.initialize()
      return storage
    }

    case "chroma": {
      // ChromaDB is for vector search only, wrap it in hybrid mode
      log.info("creating ChromaDB storage (wrapped in hybrid mode)", { path: config.chromaPath })
      const jsonStorage = new JSONStorage(config.jsonPath || getDefaultJsonPath())
      const chromaStorage = new ChromaStorage(config.chromaPath || getDefaultChromaPath())
      const hybrid = new HybridStorage(jsonStorage, chromaStorage)
      await hybrid.initialize()
      return hybrid
    }

    case "hybrid": {
      log.info("creating hybrid storage (JSON + Chroma)")
      const jsonStorageHybrid = new JSONStorage(config.jsonPath || getDefaultJsonPath())
      const chromaStorageHybrid = new ChromaStorage(config.chromaPath || getDefaultChromaPath())
      const hybridStorage = new HybridStorage(jsonStorageHybrid, chromaStorageHybrid)
      await hybridStorage.initialize()
      return hybridStorage
    }

    default:
      throw new Error(`Unknown storage type: ${config.type}`)
  }
}

/**
 * Create vector storage instance
 */
export async function createVectorStorage(path?: string): Promise<VectorStorage> {
  return new ChromaStorage(path || getDefaultChromaPath())
}

// ============================================================================
// HYBRID STORAGE (JSON + Vector)
// ============================================================================

/**
 * Hybrid storage that combines JSON and vector search
 */
export class HybridStorage implements MemoryStorage {
  private jsonStorage: MemoryStorage
  private vectorStorage: VectorStorage
  private initialized = false

  constructor(jsonStorage: MemoryStorage, vectorStorage: VectorStorage) {
    this.jsonStorage = jsonStorage
    this.vectorStorage = vectorStorage
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Initialize JSON storage (creates directory + file)
    if ('initialize' in this.jsonStorage && typeof this.jsonStorage.initialize === 'function') {
      await (this.jsonStorage as any).initialize()
    }

    // Initialize vector storage (ChromaDB)
    try {
      await this.vectorStorage.initialize()
    } catch (error) {
      log.warn("Vector storage initialization failed, continuing with JSON only", { error })
    }

    this.initialized = true
    log.info("hybrid storage initialized")
  }

  // CRUD Operations
  async create(item: MemoryItem): Promise<void> {
    await this.initialize()
    await this.jsonStorage.create(item)

    if (item.embedding) {
      await this.vectorStorage.upsert([{
        id: item.id,
        vector: item.embedding,
        payload: item,
      }])
    }
  }

  async read(id: string): Promise<MemoryItem | null> {
    return this.jsonStorage.read(id)
  }

  async update(id: string, item: Partial<MemoryItem>): Promise<void> {
    await this.jsonStorage.update(id, item)
    // Vector update would require re-embedding
  }

  async delete(id: string): Promise<void> {
    await this.jsonStorage.delete(id)
    await this.vectorStorage.delete([id])
  }

  // Bulk Operations
  async createMany(items: MemoryItem[]): Promise<void> {
    await this.initialize()

    const withEmbeddings = items.filter(i => i.embedding)
    const withoutEmbeddings = items.filter(i => !i.embedding)

    await this.jsonStorage.createMany(items)

    if (withEmbeddings.length > 0) {
      await this.vectorStorage.upsert(
        withEmbeddings.map(item => ({
          id: item.id,
          vector: item.embedding!,
          payload: item,
        }))
      )
    }
  }

  async readMany(ids: string[]): Promise<MemoryItem[]> {
    return this.jsonStorage.readMany(ids)
  }

  async deleteMany(ids: string[]): Promise<void> {
    await Promise.all([
      this.jsonStorage.deleteMany(ids),
      this.vectorStorage.delete(ids),
    ])
  }

  // Search Operations
  async search(query: string, options?: SearchOptions): Promise<MemoryItem[]> {
    const limit = options?.limit || 10

    // Get extra candidates from BM25 for reranking
    const candidates = await this.jsonStorage.search(query, { ...options, limit: Math.max(limit * 3, 20) })

    // If few results or reranking explicitly skipped, return BM25 order
    if (candidates.length <= 3) return candidates.slice(0, limit)

    try {
      const { rerank } = await import("../core/reranker")
      const rerankCandidates = candidates.map(c => ({
        id: c.id,
        content: `${c.title} ${c.content}`.substring(0, 200),
        score: 0,
      }))

      const reranked = await rerank(query, rerankCandidates, limit)

      // Map reranked IDs back to MemoryItems
      const itemMap = new Map(candidates.map(c => [c.id, c]))
      return reranked
        .map(r => itemMap.get(r.id))
        .filter((item): item is MemoryItem => item !== undefined)
    } catch {
      // If reranking fails, return BM25 results
      return candidates.slice(0, limit)
    }
  }

  async searchByType(type: MemoryType): Promise<MemoryItem[]> {
    return this.jsonStorage.searchByType(type)
  }

  async searchByContext(context: string): Promise<MemoryItem[]> {
    return this.jsonStorage.searchByContext(context)
  }

  async getRecent(limit: number): Promise<MemoryItem[]> {
    return this.jsonStorage.getRecent(limit)
  }

  async getTopUsed(limit: number): Promise<MemoryItem[]> {
    return this.jsonStorage.getTopUsed(limit)
  }

  // Statistics
  async getStats(): Promise<MemoryStats> {
    return this.jsonStorage.getStats()
  }

  async getCount(): Promise<number> {
    return this.jsonStorage.getCount()
  }

  // Maintenance
  async clear(): Promise<void> {
    await Promise.all([
      this.jsonStorage.clear(),
      this.vectorStorage.clear(),
    ])
  }

  async vacuum(): Promise<void> {
    await this.jsonStorage.vacuum()
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

import os from "os"
import { join } from "path"

function getDefaultJsonPath(): string {
  return join(os.homedir(), ".atomcli", "memory", "memories.json")
}

function getDefaultChromaPath(): string {
  return join(os.homedir(), ".atomcli", "memory", "chroma")
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default JSONStorage
