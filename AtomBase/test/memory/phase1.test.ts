/**
 * Memory System Tests - Phase 1: Core Infrastructure
 * 
 * Tests for types, storage, and embedding services.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

import {
  MemoryType,
  PreferenceCategory,
  NodeType,
  EdgeType,
  MemoryItem,
  createMemoryItem,
  createUserPreference,
  MemoryConfig,
  defaultMemoryConfig,
  JSONStorage,
  cosineSimilarity,
  normalizeVector,
  euclideanDistance,
} from "@/core/memory/index"

import type {
  MemoryItem as MemoryItemType,
  UserPreference,
} from "@/core/memory/types"

// Test paths
const testDir = path.join(os.tmpdir(), "atomcli-memory-test")
const testStoragePath = path.join(testDir, "test-memories.json")

// ============================================================================
// SETUP
// ============================================================================

beforeAll(async () => {
  await fs.mkdir(testDir, { recursive: true })
})

afterAll(async () => {
  try {
    await fs.rm(testDir, { recursive: true })
  } catch {
    // Ignore cleanup errors
  }
})

// ============================================================================
// TYPE TESTS
// ============================================================================

describe("Memory Types", () => {
  it("should create memory item with defaults", () => {
    const item = createMemoryItem({
      type: "error",
      title: "Test Error",
      content: "This is a test error",
      context: "testing",
    })

    expect(item.id).toBeDefined()
    expect(item.type).toBe("error")
    expect(item.title).toBe("Test Error")
    expect(item.content).toBe("This is a test error")
    expect(item.context).toBe("testing")
    expect(item.metadata.createdAt).toBeDefined()
    expect(item.strength).toBe(0.5)
  })

  it("should create user preference", () => {
    const pref = createUserPreference(
      "user123",
      "code_style",
      "indent_size",
      4
    )

    expect(pref.id).toBeDefined()
    expect(pref.userId).toBe("user123")
    expect(pref.category).toBe("code_style")
    expect(pref.key).toBe("indent_size")
    expect(pref.value).toBe(4)
    expect(pref.confidence).toBe(0.5)
  })

  it("should have correct enum values", () => {
    expect(MemoryType.enum.error).toBe("error")
    expect(MemoryType.enum.pattern).toBe("pattern")
    expect(MemoryType.enum.solution).toBe("solution")
    
    expect(PreferenceCategory.enum.code_style).toBe("code_style")
    expect(PreferenceCategory.enum.communication).toBe("communication")
    
    expect(NodeType.enum.concept).toBe("concept")
    expect(NodeType.enum.file).toBe("file")
    
    expect(EdgeType.enum.related_to).toBe("related_to")
    expect(EdgeType.enum.solves).toBe("solves")
  })
})

// ============================================================================
// JSON STORAGE TESTS
// ============================================================================

describe("JSON Storage", () => {
  let storage: JSONStorage

  beforeEach(() => {
    storage = new JSONStorage(testStoragePath)
  })

  afterEach(async () => {
    try {
      await storage.clear()
    } catch {
      // Ignore
    }
  })

  it("should initialize storage", async () => {
    await storage.initialize()
    const count = await storage.getCount()
    expect(count).toBe(0)
  })

  it("should create memory item", async () => {
    await storage.initialize()

    const item = createMemoryItem({
      type: "pattern",
      title: "Test Pattern",
      content: "Use optional chaining for null safety",
      context: "TypeScript",
      tags: ["typescript", "null-safety"],
    })

    await storage.create(item)

    const retrieved = await storage.read(item.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.title).toBe("Test Pattern")
    expect(retrieved!.type).toBe("pattern")
  })

  it("should search by keyword", async () => {
    await storage.initialize()

    // Create test items
    await storage.create(createMemoryItem({
      type: "error",
      title: "TypeScript Type Error",
      content: "Type checking failed",
      context: "TypeScript",
    }))

    await storage.create(createMemoryItem({
      type: "solution",
      title: "Fix TypeScript Types",
      content: "Add type annotations",
      context: "TypeScript",
    }))

    await storage.create(createMemoryItem({
      type: "pattern",
      title: "Python Best Practices",
      content: "Use type hints in Python",
      context: "Python",
    }))

    // Search for TypeScript
    const results = await storage.search("TypeScript")
    // Should return at least the 2 TypeScript items we created
    expect(results.length).toBeGreaterThanOrEqual(2)
    // All TypeScript results should have TypeScript context
    const typescriptResults = results.filter(r => r.context === "TypeScript")
    expect(typescriptResults.length).toBe(2)
  })

  it("should search by type", async () => {
    await storage.initialize()

    await storage.create(createMemoryItem({ type: "error", title: "Error 1", content: "test", context: "test" }))
    await storage.create(createMemoryItem({ type: "error", title: "Error 2", content: "test", context: "test" }))
    await storage.create(createMemoryItem({ type: "pattern", title: "Pattern 1", content: "test", context: "test" }))

    const errors = await storage.searchByType("error")
    expect(errors.length).toBe(2)
    expect(errors.every(e => e.type === "error")).toBe(true)
  })

  it("should get recent items", async () => {
    await storage.initialize()

    for (let i = 0; i < 5; i++) {
      await storage.create(createMemoryItem({
        type: "knowledge",
        title: `Item ${i}`,
        content: `Content ${i}`,
        context: "test",
      }))
    }

    const recent = await storage.getRecent(3)
    expect(recent.length).toBe(3)
  })

  it("should get top used items", async () => {
    await storage.initialize()

    const item1 = createMemoryItem({
      type: "pattern",
      title: "Common Pattern",
      content: "Very common",
      context: "test",
    })
    item1.metadata.usageCount = 10

    const item2 = createMemoryItem({
      type: "pattern",
      title: "Rare Pattern",
      content: "Rare",
      context: "test",
    })
    item2.metadata.usageCount = 2

    await storage.create(item1)
    await storage.create(item2)

    const topUsed = await storage.getTopUsed(5)
    expect(topUsed.length).toBe(2)
    expect(topUsed[0].title).toBe("Common Pattern")
  })

  it("should return stats", async () => {
    await storage.initialize()

    await storage.create(createMemoryItem({ type: "error", title: "E1", content: "test", context: "test" }))
    await storage.create(createMemoryItem({ type: "error", title: "E2", content: "test", context: "test" }))
    await storage.create(createMemoryItem({ type: "pattern", title: "P1", content: "test", context: "test" }))

    const stats = await storage.getStats()
    expect(stats.totalMemories).toBe(3)
    expect(stats.memoriesByType.error).toBe(2)
    expect(stats.memoriesByType.pattern).toBe(1)
  })

  it("should delete items", async () => {
    await storage.initialize()

    const item = createMemoryItem({
      type: "knowledge",
      title: "To Delete",
      content: "Will be deleted",
      context: "test",
    })

    await storage.create(item)
    expect(await storage.read(item.id)).not.toBeNull()

    await storage.delete(item.id)
    expect(await storage.read(item.id)).toBeNull()
  })

  it("should update items", async () => {
    await storage.initialize()

    const item = createMemoryItem({
      type: "knowledge",
      title: "Original Title",
      content: "Original content",
      context: "test",
    })

    await storage.create(item)

    await storage.update(item.id, {
      title: "Updated Title",
      content: "Updated content",
    })

    const updated = await storage.read(item.id)
    expect(updated!.title).toBe("Updated Title")
    expect(updated!.content).toBe("Updated content")
  })

  it("should handle bulk operations", async () => {
    await storage.initialize()

    const items = Array.from({ length: 10 }, (_, i) =>
      createMemoryItem({
        type: "knowledge",
        title: `Bulk Item ${i}`,
        content: `Content ${i}`,
        context: "test",
      })
    )

    await storage.createMany(items)
    const count = await storage.getCount()
    expect(count).toBe(10)

    // Delete multiple
    const ids = items.slice(0, 5).map(i => i.id)
    await storage.deleteMany(ids)

    const countAfter = await storage.getCount()
    expect(countAfter).toBe(5)
  })
})

// ============================================================================
// EMBEDDING UTILITY TESTS
// ============================================================================

describe("Embedding Utilities", () => {
  it("should calculate cosine similarity", () => {
    const a = [1, 0, 0]
    const b = [1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)

    const c = [0, 1, 0]
    expect(cosineSimilarity(a, c)).toBeCloseTo(0, 5)

    const d = [-1, 0, 0]
    expect(cosineSimilarity(a, d)).toBeCloseTo(-1, 5)
  })

  it("should calculate euclidean distance", () => {
    const a = [0, 0, 0]
    const b = [3, 4, 0]
    expect(euclideanDistance(a, b)).toBeCloseTo(5, 5)
  })

  it("should normalize vector", () => {
    const v = [3, 4, 0]
    const normalized = normalizeVector(v)
    
    const magnitude = Math.sqrt(normalized.reduce((s, x) => s + x * x, 0))
    expect(magnitude).toBeCloseTo(1, 5)
  })

  it("should handle empty vectors", () => {
    const empty: number[] = []
    expect(cosineSimilarity(empty, [])).toBe(0)
    expect(euclideanDistance(empty, [])).toBe(0)
    expect(normalizeVector(empty)).toEqual([])
  })

  it("should handle mismatched vector lengths", () => {
    const a = [1, 2]
    const b = [1, 2, 3]
    expect(cosineSimilarity(a, b)).toBe(0)
    expect(euclideanDistance(a, b)).toBe(Infinity)
  })
})

// ============================================================================
// CONFIG TESTS
// ============================================================================

describe("Memory Config", () => {
  it("should have default values", () => {
    expect(defaultMemoryConfig.enabled).toBe(true)
    expect(defaultMemoryConfig.storage).toBe("hybrid")
    expect(defaultMemoryConfig.embedding?.provider).toBe("openai")
    expect(defaultMemoryConfig.embedding?.dimensions).toBe(512)
    expect(defaultMemoryConfig.backgroundLearning?.enabled).toBe(true)
    expect(defaultMemoryConfig.retention?.maxItems).toBe(10000)
  })

  it("should merge custom config", () => {
    const custom: Partial<MemoryConfig> = {
      storage: "json",
      embedding: {
        provider: "local",
        model: "custom-model",
        dimensions: 256,
      },
    }

    const merged = { ...defaultMemoryConfig, ...custom }
    
    expect(merged.storage).toBe("json")
    expect(merged.embedding?.provider).toBe("local")
    expect(merged.embedding?.model).toBe("custom-model")
    expect(merged.embedding?.dimensions).toBe(256)
    // Other defaults should remain
    expect(merged.backgroundLearning?.enabled).toBe(true)
  })
})

// ============================================================================
// EXPORT TESTS
// ============================================================================

describe("Module Exports", () => {
  it("should export all main types", () => {
    expect(MemoryType).toBeDefined()
    expect(PreferenceCategory).toBeDefined()
    expect(NodeType).toBeDefined()
    expect(EdgeType).toBeDefined()
    expect(MemoryItem).toBeDefined()
    // UserPreference is a type-only export (Zod schema)
    expect(createMemoryItem).toBeInstanceOf(Function)
  })

  it("should export utility functions", () => {
    expect(createMemoryItem).toBeInstanceOf(Function)
    expect(createUserPreference).toBeInstanceOf(Function)
    expect(cosineSimilarity).toBeInstanceOf(Function)
    expect(normalizeVector).toBeInstanceOf(Function)
  })

  it("should export storage class", () => {
    expect(JSONStorage).toBeDefined()
    expect(JSONStorage).toBeInstanceOf(Function)
  })
})

// ============================================================================
// RUN TESTS
// ============================================================================

console.log("Running Memory System Tests - Phase 1...")
