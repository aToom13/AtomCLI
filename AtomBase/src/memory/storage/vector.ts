/**
 * ChromaDB Vector Storage for Semantic Search
 * 
 * Uses ChromaDB for efficient vector similarity search.
 * Embedded mode - no external server required.
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

import type {
  MemoryItem,
  MemoryStats,
} from "../types"

import { Log } from "../../util/log"

const log = Log.create({ service: "memory.storage.chroma" })

// ============================================================================
// VECTOR STORAGE INTERFACE
// ============================================================================

/**
 * Vector storage interface for semantic search
 */
export interface VectorStorage {
  initialize(): Promise<void>
  upsert(items: Array<{ id: string; vector: number[]; payload: any }>): Promise<void>
  search(queryVector: number[], limit: number, filter?: Record<string, any>): Promise<Array<{ id: string; score: number; payload: any }>>
  delete(ids: string[]): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}

// ============================================================================
// CHROMA DB STORAGE IMPLEMENTATION
// ============================================================================

export class ChromaStorage {
  private persistPath: string
  private collectionName = "atomcli_memories"
  private chroma: any = null
  private collection: any = null
  private initialized = false

  constructor(persistPath?: string) {
    this.persistPath = persistPath 
      || path.join(os.homedir(), ".atomcli", "memory", "chroma")
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize ChromaDB and load/create collection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Import ChromaDB
      const chromaModule = await import("chromadb")
      const { ChromaClient } = chromaModule

      // Ensure directory exists
      await fs.mkdir(this.persistPath, { recursive: true })

      // Create client with persistence
      this.chroma = new ChromaClient({
        path: this.persistPath,
      })

      // Get or create collection
      try {
        this.collection = await this.chroma.getCollection({
          name: this.collectionName,
        })
        log.info("Loaded existing ChromaDB collection")
      } catch {
        this.collection = await this.chroma.createCollection({
          name: this.collectionName,
          metadata: {
            description: "AtomCLI memory embeddings",
            createdAt: new Date().toISOString(),
          },
        })
        log.info("Created new ChromaDB collection")
      }

      this.initialized = true
      log.info("ChromaDB storage initialized", { path: this.persistPath })
    } catch (error) {
      log.error("Failed to initialize ChromaDB", { error })
      throw error
    }
  }

  /**
   * Check if ChromaDB is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.initialize()
      return true
    } catch {
      return false
    }
  }

  // ============================================================================
  // VECTOR OPERATIONS
  // ============================================================================

  /**
   * Upsert vectors with payloads
   */
  async upsert(
    items: Array<{ id: string; vector: number[]; payload: MemoryItem }>
  ): Promise<void> {
    await this.initialize()

    if (items.length === 0) return

    try {
      const ids = items.map(i => i.id)
      const embeddings = items.map(i => i.vector)
      const documents = items.map(i => i.payload.content)
      const metadatas = items.map(i => ({
        type: i.payload.type,
        context: i.payload.context,
        title: i.payload.title,
        tags: i.payload.tags.join(","),
        createdAt: i.payload.metadata.createdAt,
      }))

      await this.collection.upsert({
        ids,
        embeddings,
        documents,
        metadatas,
      })

      log.debug("Upserted vectors", { count: items.length })
    } catch (error) {
      log.error("Failed to upsert vectors", { error })
      throw error
    }
  }

  /**
   * Search by vector similarity
   */
  async search(
    queryVector: number[],
    limit: number,
    filter?: Record<string, any>
  ): Promise<Array<{ id: string; score: number; payload: MemoryItem }>> {
    await this.initialize()

    try {
      // Build where clause for filtering
      let whereClause: Record<string, any> | undefined
      if (filter && Object.keys(filter).length > 0) {
        whereClause = {}
        for (const [key, value] of Object.entries(filter)) {
          whereClause[key] = value
        }
      }

      const results = await this.collection.query({
        queryEmbeddings: [queryVector],
        nResults: limit,
        where: whereClause,
        include: ["embeddings", "documents", "metadatas", "distances"],
      })

      if (!results.ids || results.ids.length === 0) {
        return []
      }

      // Parse results
      const output: Array<{ id: string; score: number; payload: MemoryItem }> = []

      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i]
        const distance = results.distances?.[0]?.[i] ?? 1
        
        // Convert distance to similarity score (0-1)
        const score = Math.max(0, 1 - distance)

        // Reconstruct MemoryItem from stored data
        const metadata = results.metadatas?.[0]?.[i] || {}
        const payload: MemoryItem = {
          id,
          type: metadata.type || "knowledge",
          title: metadata.title || "",
          content: results.documents?.[0]?.[i] || "",
          context: metadata.context || "general",
          tags: metadata.tags?.split(",") || [],
          metadata: {
            createdAt: metadata.createdAt || new Date().toISOString(),
            source: "vector_store",
            usageCount: 0,
            successRate: 1,
          },
        }

        if (results.embeddings?.[0]?.[i]) {
          payload.embedding = results.embeddings[0][i]
        }

        output.push({ id, score, payload })
      }

      return output
    } catch (error) {
      log.error("Vector search failed", { error })
      throw error
    }
  }

  /**
   * Delete vectors by IDs
   */
  async delete(ids: string[]): Promise<void> {
    await this.initialize()

    if (ids.length === 0) return

    try {
      await this.collection.delete({
        ids,
      })
      log.debug("Deleted vectors", { count: ids.length })
    } catch (error) {
      log.error("Failed to delete vectors", { error })
      throw error
    }
  }

  /**
   * Get vector count
   */
  async count(): Promise<number> {
    await this.initialize()

    try {
      const count = await this.collection.count()
      return count
    } catch (error) {
      log.error("Failed to get count", { error })
      return 0
    }
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    await this.initialize()

    try {
      // Get all IDs and delete
      const count = await this.count()
      if (count > 0) {
        // ChromaDB doesn't have a clear all, so we delete the collection
        // Note: This is destructive
        log.warn("Clearing ChromaDB collection (recreating)")

        try {
          await this.chroma.deleteCollection({ name: this.collectionName })
        } catch {
          // Ignore if doesn't exist
        }

        // Recreate collection
        this.collection = await this.chroma.createCollection({
          name: this.collectionName,
          metadata: {
            description: "AtomCLI memory embeddings",
            createdAt: new Date().toISOString(),
          },
        })
        this.initialized = true
      }
      
      log.info("Cleared ChromaDB storage")
    } catch (error) {
      log.error("Failed to clear storage", { error })
      throw error
    }
  }

  // ============================================================================
  // UTILITY METHODS (for compatibility)
  // ============================================================================

  /**
   * Get collection info
   */
  async getInfo(): Promise<{
    name: string
    count: number
    metadata: Record<string, any>
  }> {
    await this.initialize()

    return {
      name: this.collectionName,
      count: await this.count(),
      metadata: {},
    }
  }

  /**
   * Peek at stored items (without search)
   */
  async peek(limit: number = 10): Promise<Array<{ id: string; payload: MemoryItem }>> {
    await this.initialize()

    try {
      const results = await this.collection.get({
        limit,
        include: ["documents", "metadatas"],
      })

      if (!results.ids || results.ids.length === 0) {
        return []
      }

      return results.ids.map((id: string, i: number) => ({
        id,
        payload: {
          id,
          type: results.metadatas?.[i]?.type || "knowledge",
          title: results.metadatas?.[i]?.title || "",
          content: results.documents?.[i] || "",
          context: results.metadatas?.[i]?.context || "general",
          tags: results.metadatas?.[i]?.tags?.split(",") || [],
          metadata: {
            createdAt: results.metadatas?.[i]?.createdAt || new Date().toISOString(),
            source: "vector_store",
            usageCount: 0,
            successRate: 1,
          },
        },
      }))
    } catch (error) {
      log.error("Peek failed", { error })
      return []
    }
  }
}

// ============================================================================
// HYBRID SEARCH HELPERS
// ============================================================================

/**
 * Simple cosine similarity for vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Normalize vector to unit length
 */
export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vector
  return vector.map(v => v / norm)
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default ChromaStorage
