/**
 * Storage Migration Script
 * 
 * Handles data migration between storage versions.
 * Ensures backward compatibility when storage format changes.
 */

import fs from "fs/promises"
import path from "path"
import os from "os"

import type { MemoryItem, MemoryType } from "../types"

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.migration" })

// ============================================================================
// MIGRATION TYPES
// ============================================================================

interface MigrationResult {
  success: boolean
  migratedItems: number
  errors: string[]
  warnings: string[]
}

interface LegacyItem {
  id: string
  type: string
  title: string
  description: string
  context: string
  problem?: string
  solution: string
  codeBefore?: string
  codeAfter?: string
  source?: string
  tags: string[]
  usageCount: number
  createdAt: string
  lastUsed?: string
  successRate: number
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

/**
 * Migrate from legacy format (description-based) to new format (content-based)
 */
export async function migrateLegacyToV1(
  legacyPath: string,
  newPath: string
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    migratedItems: 0,
    errors: [],
    warnings: [],
  }

  try {
    // Read legacy data
    const content = await fs.readFile(legacyPath, "utf-8")
    const legacyItems: LegacyItem[] = JSON.parse(content)

    log.info("Found legacy items", { count: legacyItems.length })

    // Convert to new format
    const newItems: MemoryItem[] = legacyItems.map(item => ({
      id: item.id,
      type: mapLegacyType(item.type),
      title: item.title,
      content: item.description,
      context: item.context,
      problem: item.problem,
      solution: item.solution,
      codeBefore: item.codeBefore,
      codeAfter: item.codeAfter,
      tags: item.tags,
      metadata: {
        createdAt: item.createdAt,
        updatedAt: item.lastUsed || item.createdAt,
        source: item.source || "legacy",
        usageCount: item.usageCount,
        lastUsed: item.lastUsed,
        successRate: item.successRate,
      },
      relationships: [],
      strength: 0.5,
    }))

    // Save new format
    await fs.writeFile(newPath, JSON.stringify(newItems, null, 2))

    result.success = true
    result.migratedItems = newItems.length

    log.info("Migration complete", {
      migrated: result.migratedItems,
      path: newPath,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    result.errors.push(errorMessage)
    log.error("Migration failed", { error })
  }

  return result
}

/**
 * Migrate from v1 (JSON) to v2 (Hybrid storage)
 * This is a virtual migration - v2 reads v1 format directly
 */
export async function ensureHybridCompatibility(
  jsonPath: string
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migratedItems: 0,
    errors: [],
    warnings: [],
  }

  try {
    // Check if file exists
    await fs.access(jsonPath)

    // Validate format
    const content = await fs.readFile(jsonPath, "utf-8")
    const items: any[] = JSON.parse(content)

    if (!Array.isArray(items)) {
      result.errors.push("Invalid format: expected array")
      result.success = false
      return result
    }

    // Check for required fields
    if (items.length > 0) {
      const item = items[0]
      const hasContent = "content" in item || "description" in item
      const hasType = "type" in item

      if (!hasContent) {
        result.warnings.push("Items missing content/description field")
      }
      if (!hasType) {
        result.warnings.push("Items missing type field")
      }
    }

    result.migratedItems = items.length
    log.info("Compatibility check passed", { count: items.length })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, create empty
      await fs.writeFile(jsonPath, "[]")
      log.info("Created empty storage file")
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMessage)
      result.success = false
    }
  }

  return result
}

/**
 * Clean up old/expired memories
 */
export async function cleanupExpiredMemories(
  storagePath: string,
  ttlDays: number = 365,
  maxItems: number = 10000
): Promise<{
  removed: number
  remaining: number
}> {
  try {
    const content = await fs.readFile(storagePath, "utf-8")
    let items: MemoryItem[] = JSON.parse(content)

    const now = Date.now()
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000
    const originalCount = items.length

    // Remove expired items
    items = items.filter(item => {
      const created = new Date(item.metadata.createdAt).getTime()
      return (now - created) < ttlMs
    })

    // Remove low-usage, old items if over max
    if (items.length > maxItems) {
      items.sort((a, b) => {
        // Prioritize by usage count and success rate
        const aScore = a.metadata.usageCount * a.metadata.successRate
        const bScore = b.metadata.usageCount * b.metadata.successRate
        return bScore - aScore
      })

      items = items.slice(0, maxItems)
    }

    await fs.writeFile(storagePath, JSON.stringify(items, null, 2))

    const removed = originalCount - items.length

    log.info("Cleanup complete", {
      removed,
      remaining: items.length,
    })

    return {
      removed,
      remaining: items.length,
    }
  } catch (error) {
    log.error("Cleanup failed", { error })
    return { removed: 0, remaining: 0 }
  }
}

/**
 * Export memories to a portable format
 */
export async function exportMemories(
  storagePath: string,
  format: "json" | "csv" = "json"
): Promise<string> {
  const content = await fs.readFile(storagePath, "utf-8")
  const items: MemoryItem[] = JSON.parse(content)

  if (format === "csv") {
    const headers = ["id", "type", "title", "content", "context", "tags", "createdAt"]
    const rows = items.map(item => [
      item.id,
      item.type,
      `"${item.title.replace(/"/g, '""')}"`,
      `"${item.content.replace(/"/g, '""')}"`,
      item.context,
      `"${item.tags.join(",")}"`,
      item.metadata.createdAt,
    ])

    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n")
  }

  // JSON format
  return JSON.stringify({
    exportDate: new Date().toISOString(),
    version: "1.0",
    itemCount: items.length,
    items,
  }, null, 2)
}

/**
 * Import memories from portable format
 */
export async function importMemories(
  data: string,
  targetPath: string
): Promise<{
  imported: number
  skipped: number
  errors: string[]
}> {
  const result = {
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  }

  try {
    let items: MemoryItem[]

    // Try JSON format first
    try {
      const parsed = JSON.parse(data)

      if (Array.isArray(parsed)) {
        items = parsed
      } else if (parsed.items) {
        items = parsed.items
      } else {
        throw new Error("Unknown JSON format")
      }
    } catch {
      // Try CSV format (basic parsing)
      result.errors.push("CSV import not implemented yet")
      return result
    }

    // Read existing items
    let existing: MemoryItem[] = []
    try {
      const existingContent = await fs.readFile(targetPath, "utf-8")
      existing = JSON.parse(existingContent)
    } catch {
      // File doesn't exist, start fresh
    }

    // Merge items (avoid duplicates)
    const existingIds = new Set(existing.map(i => i.id))
    const newItems = items.filter(item => {
      if (existingIds.has(item.id)) {
        result.skipped++
        return false
      }
      return true
    })

    // Save combined
    const combined = [...existing, ...newItems]
    await fs.writeFile(targetPath, JSON.stringify(combined, null, 2))

    result.imported = newItems.length

    log.info("Import complete", {
      imported: result.imported,
      skipped: result.skipped,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    result.errors.push(errorMessage)
    log.error("Import failed", { error })
  }

  return result
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map legacy type to new type
 */
function mapLegacyType(legacyType: string): MemoryType {
  const typeMap: Record<string, MemoryType> = {
    "error": "error",
    "pattern": "pattern",
    "solution": "solution",
    "research": "research",
    "preference": "preference",
    "context": "context",
    "knowledge": "knowledge",
  }

  return typeMap[legacyType.toLowerCase()] || "knowledge"
}

/**
 * Get default storage paths
 */
export function getDefaultStoragePaths(): {
  legacyPath: string
  jsonPath: string
  chromaPath: string
} {
  const memoryDir = path.join(os.homedir(), ".atomcli", "memory")

  return {
    legacyPath: path.join(memoryDir, "learning.json"),
    jsonPath: path.join(memoryDir, "memories.json"),
    chromaPath: path.join(memoryDir, "chroma"),
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  migrateLegacyToV1,
  ensureHybridCompatibility,
  cleanupExpiredMemories,
  exportMemories,
  importMemories,
  getDefaultStoragePaths,
}
