/**
 * JSON File Storage for Memory Items
 * 
 * Simple file-based storage using JSON format.
 * Maintains backward compatibility with existing learning data.
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

import type {
  MemoryItem,
  MemoryType,
  SearchOptions,
  MemoryStats,
} from "../types"

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.storage.json" })

// ============================================================================
// JSON STORAGE IMPLEMENTATION
// ============================================================================

export class JSONStorage {
  private filePath: string
  private dirPath: string
  private cache: Map<string, MemoryItem> = new Map()

  constructor(filePath?: string) {
    this.dirPath = filePath 
      ? path.dirname(filePath) 
      : path.join(os.homedir(), ".atomcli", "memory")
    this.filePath = filePath 
      || path.join(this.dirPath, "memories.json")
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize storage - create directory and load cache
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dirPath, { recursive: true })
      
      try {
        await fs.access(this.filePath)
        await this.loadCache()
      } catch {
        // File doesn't exist, create empty
        await this.saveToFile([])
      }
      
      log.info("JSON storage initialized", { path: this.filePath })
    } catch (error) {
      log.error("Failed to initialize JSON storage", { error })
      throw error
    }
  }

  /**
   * Load data from file to cache
   */
  private async loadCache(): Promise<void> {
    const content = await fs.readFile(this.filePath, "utf-8")
    const items: MemoryItem[] = JSON.parse(content)
    
    this.cache.clear()
    for (const item of items) {
      this.cache.set(item.id, item)
    }
    
    log.info("Loaded cache", { count: this.cache.size })
  }

  /**
   * Save cache to file
   */
  private async saveToFile(items?: MemoryItem[]): Promise<void> {
    const data = items || Array.from(this.cache.values())
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2))
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new memory item
   */
  async create(item: MemoryItem): Promise<void> {
    await this.initialize()
    
    if (this.cache.has(item.id)) {
      throw new Error(`Memory item already exists: ${item.id}`)
    }
    
    this.cache.set(item.id, item)
    await this.saveToFile()
    
    log.debug("Created memory item", { id: item.id, type: item.type })
  }

  /**
   * Read a memory item by ID
   */
  async read(id: string): Promise<MemoryItem | null> {
    await this.initialize()
    return this.cache.get(id) || null
  }

  /**
   * Update a memory item
   */
  async update(id: string, updates: Partial<MemoryItem>): Promise<void> {
    await this.initialize()
    
    const existing = this.cache.get(id)
    if (!existing) {
      throw new Error(`Memory item not found: ${id}`)
    }
    
    const updated: MemoryItem = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    }
    
    this.cache.set(id, updated)
    await this.saveToFile()
    
    log.debug("Updated memory item", { id })
  }

  /**
   * Delete a memory item
   */
  async delete(id: string): Promise<void> {
    await this.initialize()
    
    if (!this.cache.has(id)) {
      return // Silently ignore
    }
    
    this.cache.delete(id)
    await this.saveToFile()
    
    log.debug("Deleted memory item", { id })
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Create multiple memory items
   */
  async createMany(items: MemoryItem[]): Promise<void> {
    await this.initialize()
    
    for (const item of items) {
      if (this.cache.has(item.id)) {
        log.warn("Skipping duplicate item", { id: item.id })
        continue
      }
      this.cache.set(item.id, item)
    }
    
    await this.saveToFile()
    log.debug("Created multiple items", { count: items.length })
  }

  /**
   * Read multiple memory items
   */
  async readMany(ids: string[]): Promise<MemoryItem[]> {
    await this.initialize()
    
    const results: MemoryItem[] = []
    for (const id of ids) {
      const item = this.cache.get(id)
      if (item) {
        results.push(item)
      }
    }
    return results
  }

  /**
   * Delete multiple memory items
   */
  async deleteMany(ids: string[]): Promise<void> {
    await this.initialize()
    
    for (const id of ids) {
      this.cache.delete(id)
    }
    
    await this.saveToFile()
    log.debug("Deleted multiple items", { count: ids.length })
  }

  // ============================================================================
  // SEARCH OPERATIONS
  // ============================================================================

  /**
   * Search memory items by keyword
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryItem[]> {
    await this.initialize()
    
    const lowerQuery = query.toLowerCase()
    const results: Array<{ item: MemoryItem; score: number }> = []

    for (const item of this.cache.values()) {
      // Apply filters
      if (options?.type && item.type !== options.type) continue
      if (options?.context && !item.context.toLowerCase().includes(options.context.toLowerCase())) continue
      
      // Calculate relevance score
      let score = 0
      
      // Title match (highest weight)
      if (item.title.toLowerCase().includes(lowerQuery)) {
        score += 10
      }
      
      // Content match
      if (item.content.toLowerCase().includes(lowerQuery)) {
        score += 5
      }
      
      // Solution match
      if (item.solution?.toLowerCase().includes(lowerQuery)) {
        score += 3
      }
      
      // Tag match
      if (item.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
        score += 4
      }
      
      // Context match
      if (item.context.toLowerCase().includes(lowerQuery)) {
        score += 2
      }
      
      // Usage count bonus
      score += Math.min(item.metadata.usageCount * 0.1, 2)
      
      // Success rate bonus
      score += item.metadata.successRate * 2

      if (score > 0) {
        results.push({ item, score })
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)
    
    // Apply limit
    const limit = options?.limit || 10
    const limited = results.slice(0, limit)
    
    return limited.map(r => r.item)
  }

  /**
   * Search by memory type
   */
  async searchByType(type: MemoryType): Promise<MemoryItem[]> {
    await this.initialize()
    
    const results: Array<{ item: MemoryItem; score: number }> = []
    
    for (const item of this.cache.values()) {
      if (item.type === type) {
        const score = item.metadata.usageCount * 0.5 + item.metadata.successRate * 5
        results.push({ item, score })
      }
    }
    
    results.sort((a, b) => b.score - a.score)
    return results.map(r => r.item)
  }

  /**
   * Search by context (technology/framework)
   */
  async searchByContext(context: string): Promise<MemoryItem[]> {
    await this.initialize()
    
    const lowerContext = context.toLowerCase()
    const results: Array<{ item: MemoryItem; score: number }> = []
    
    for (const item of this.cache.values()) {
      if (item.context.toLowerCase().includes(lowerContext)) {
        const score = item.metadata.usageCount * 0.5 + item.metadata.successRate * 5
        results.push({ item, score })
      }
    }
    
    results.sort((a, b) => b.score - a.score)
    return results.map(r => r.item)
  }

  /**
   * Get recent memory items
   */
  async getRecent(limit: number): Promise<MemoryItem[]> {
    await this.initialize()
    
    const items = Array.from(this.cache.values())
    
    items.sort((a, b) => {
      const aTime = new Date(a.metadata.createdAt).getTime()
      const bTime = new Date(b.metadata.createdAt).getTime()
      return bTime - aTime
    })
    
    return items.slice(0, limit)
  }

  /**
   * Get most used memory items
   */
  async getTopUsed(limit: number): Promise<MemoryItem[]> {
    await this.initialize()
    
    const items = Array.from(this.cache.values())
    
    items.sort((a, b) => {
      // Primary: usage count
      const usageDiff = b.metadata.usageCount - a.metadata.usageCount
      if (usageDiff !== 0) return usageDiff
      
      // Secondary: success rate
      return b.metadata.successRate - a.metadata.successRate
    })
    
    return items.slice(0, limit)
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    await this.initialize()
    
    const items = Array.from(this.cache.values())
    
    // Count by type
    const memoriesByType: Record<string, number> = {}
    let totalUsage = 0
    let totalSuccess = 0
    const techCount: Record<string, number> = {}

    for (const item of items) {
      memoriesByType[item.type] = (memoriesByType[item.type] || 0) + 1
      totalUsage += item.metadata.usageCount
      totalSuccess += item.metadata.successRate
      techCount[item.context] = (techCount[item.context] || 0) + 1
    }

    // Top technologies
    const topTechnologies = Object.entries(techCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tech]) => tech)

    return {
      totalMemories: items.length,
      memoriesByType,
      avgUsageCount: items.length > 0 ? totalUsage / items.length : 0,
      successRate: items.length > 0 ? totalSuccess / items.length : 1,
      learningVelocity: 0, // Would need historical data
      topTechnologies,
      suggestedTopics: [],
    }
  }

  /**
   * Get total count
   */
  async getCount(): Promise<number> {
    await this.initialize()
    return this.cache.size
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Clear all memory items
   */
  async clear(): Promise<void> {
    this.cache.clear()
    await fs.writeFile(this.filePath, "[]")
    log.info("Cleared all memory items")
  }

  /**
   * Vacuum/compact storage
   */
  async vacuum(): Promise<void> {
    await this.saveToFile()
    log.info("Vacuumed storage")
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Merge two memory items (for deduplication)
 */
function mergeItems(existing: MemoryItem, update: Partial<MemoryItem>): MemoryItem {
  return {
    ...existing,
    ...update,
    id: existing.id,
    metadata: {
      ...existing.metadata,
      ...update.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default JSONStorage
