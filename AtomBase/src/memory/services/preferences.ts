/**
 * User Preferences Memory Service
 * 
 * Automatically learns and remembers user preferences based on behavior.
 * Tracks code style, communication preferences, tool usage, and more.
 */

import os from "os"
import path from "path"
import fs from "fs/promises"

import type {
  UserPreference,
  PreferenceCategory,
  StyleGuide,
  MemoryMetadata,
} from "../types"

import { Log } from "../../util/log"
import { createUserPreference } from "../types"

const log = Log.create({ service: "memory.preferences" })

// ============================================================================
// CONSTANTS
// ============================================================================

const PREFERENCES_DIR = ".atomcli/preferences"
const PREFERENCES_FILE = "preferences.json"

interface PreferenceEntry {
  id: string
  category: string
  key: string
  value: any
  confidence: number
  examples: string[]
  metadata: MemoryMetadata
}

// ============================================================================
// PREFERENCES SERVICE
// ============================================================================

export class PreferencesService {
  private preferencesPath: string
  private preferencesDir: string
  private cache: Map<string, PreferenceEntry> = new Map()
  private initialized = false

  constructor(userId: string = "default") {
    this.preferencesDir = path.join(os.homedir(), PREFERENCES_DIR, userId)
    this.preferencesPath = path.join(this.preferencesDir, PREFERENCES_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await fs.mkdir(this.preferencesDir, { recursive: true })

      try {
        await fs.access(this.preferencesPath)
        await this.loadPreferences()
      } catch {
        await this.savePreferences([])
      }

      this.initialized = true
      log.info("Preferences service initialized", { path: this.preferencesPath })
    } catch (error) {
      log.error("Failed to initialize preferences service", { error })
      throw error
    }
  }

  /**
   * Load preferences from file to cache
   */
  private async loadPreferences(): Promise<void> {
    const content = await fs.readFile(this.preferencesPath, "utf-8")
    const preferences: PreferenceEntry[] = JSON.parse(content)

    this.cache.clear()
    for (const pref of preferences) {
      this.cache.set(`${pref.category}:${pref.key}`, pref)
    }

    log.info("Loaded preferences", { count: this.cache.size })
  }

  /**
   * Save preferences to file
   */
  private async savePreferences(preferences?: PreferenceEntry[]): Promise<void> {
    const data = preferences || Array.from(this.cache.values())
    await fs.writeFile(this.preferencesPath, JSON.stringify(data, null, 2))
  }

  // ============================================================================
  // LEARNING PREFERENCES
  // ============================================================================

  /**
   * Learn a new preference from user behavior
   */
  async learn(
    category: PreferenceCategory,
    key: string,
    value: any,
    context?: string
  ): Promise<void> {
    await this.initialize()

    const cacheKey = `${category}:${key}`
    const now = new Date().toISOString()

    const existing = this.cache.get(cacheKey)

    if (existing) {
      // Update existing preference
      const newConfidence = Math.min(existing.confidence + 0.1, 1)
      const examples = [...existing.examples]

      if (context && examples.length < 10) {
        examples.push(context)
      }

      const updated: PreferenceEntry = {
        ...existing,
        value,
        confidence: newConfidence,
        examples,
        metadata: {
          ...existing.metadata,
          updatedAt: now,
          usageCount: existing.metadata.usageCount + 1,
        },
      }

      this.cache.set(cacheKey, updated)
      await this.savePreferences()

      log.debug("Updated preference", { category, key, confidence: newConfidence })
    } else {
      // Create new preference
      const entry: PreferenceEntry = {
        id: `${category}:${key}`,
        category,
        key,
        value,
        confidence: 0.5,
        examples: context ? [context] : [],
        metadata: {
          createdAt: now,
          source: "behavior",
          usageCount: 1,
          successRate: 1,
        },
      }

      this.cache.set(cacheKey, entry)
      await this.savePreferences()

      log.debug("Learned new preference", { category, key })
    }
  }

  /**
   * Learn from behavior pattern
   */
  async learnFromPattern(
    category: PreferenceCategory,
    key: string,
    value: any,
    example: string
  ): Promise<void> {
    await this.learn(category, key, value, example)
  }

  /**
   * Learn from explicit user correction
   */
  async learnFromCorrection(
    key: string,
    correctValue: any,
    context: string
  ): Promise<void> {
    // Determine category based on key pattern
    const category = this.inferCategory(key)
    await this.learn(category, key, correctValue, context)
  }

  /**
   * Learn from tool usage pattern
   */
  async learnToolPreference(
    toolName: string,
    preferredOption: string,
    example?: string
  ): Promise<void> {
    await this.learn("tool_usage", `${toolName}_preference`, preferredOption, example)
  }

  // ============================================================================
  // RETRIEVING PREFERENCES
  // ============================================================================

  /**
   * Get a specific preference
   */
  async get<T = any>(
    category: PreferenceCategory,
    key: string
  ): Promise<{ value: T; confidence: number } | null> {
    await this.initialize()

    const cacheKey = `${category}:${key}`
    const entry = this.cache.get(cacheKey)

    if (!entry) return null

    // Increment usage count
    entry.metadata.usageCount++
    await this.savePreferences()

    return {
      value: entry.value as T,
      confidence: entry.confidence,
    }
  }

  /**
   * Get all preferences in a category
   */
  async getByCategory(category: PreferenceCategory): Promise<UserPreference[]> {
    await this.initialize()

    const preferences: UserPreference[] = []

    for (const entry of this.cache.values()) {
      if (entry.category === category) {
        preferences.push(this.entryToPreference(entry))
      }
    }

    return preferences
  }

  /**
   * Get all preferences
   */
  async getAll(): Promise<UserPreference[]> {
    await this.initialize()

    return Array.from(this.cache.values()).map(e => this.entryToPreference(e))
  }

  /**
   * Check if a preference exists
   */
  async has(category: PreferenceCategory, key: string): Promise<boolean> {
    await this.initialize()
    return this.cache.has(`${category}:${key}`)
  }

  // ============================================================================
  // STYLE GUIDE GENERATION
  // ============================================================================

  /**
   * Generate a style guide from preferences
   */
  async generateStyleGuide(): Promise<StyleGuide> {
    await this.initialize()

    const defaults: StyleGuide = {
      indent: { style: "space", size: 2 },
      quotes: "double",
      semicolons: true,
      lineLength: 100,
      brackets: "same-line",
    }

    // Get code style preferences
    const indentSize = await this.get("code_style", "indent_size")
    const indentStyle = await this.get("code_style", "indent_style")
    const quoteStyle = await this.get("code_style", "quote_style")
    const semicolons = await this.get("code_style", "semicolons")
    const lineLength = await this.get("code_style", "line_length")
    const brackets = await this.get("code_style", "brackets")

    return {
      indent: {
        style: (indentStyle?.value as "space" | "tab") || defaults.indent.style,
        size: indentSize?.value || defaults.indent.size,
      },
      quotes: (quoteStyle?.value as "single" | "double") || defaults.quotes,
      semicolons: semicolons?.value ?? defaults.semicolons,
      lineLength: lineLength?.value || defaults.lineLength,
      brackets: (brackets?.value as "same-line" | "new-line") || defaults.brackets,
    }
  }

  // ============================================================================
  // APPLYING TO CONTEXT
  // ============================================================================

  /**
   * Get preferences to apply to a code generation context
   */
  async applyToContext(
    context: {
      language?: string
      task?: string
      files?: string[]
    }
  ): Promise<Record<string, any>> {
    const preferences: Record<string, any> = {}

    // Get style guide
    const styleGuide = await this.generateStyleGuide()
    preferences.styleGuide = styleGuide

    // Get communication preferences
    const detailLevel = await this.get("communication", "detail_level")
    const emojiUsage = await this.get("communication", "emoji_usage")
    const language = await this.get("communication", "language")

    if (detailLevel) preferences.detailLevel = detailLevel.value
    if (emojiUsage) preferences.emojiUsage = emojiUsage.value
    if (language) preferences.language = language.value

    // Get tool preferences
    const toolPrefs = await this.getByCategory("tool_usage")
    preferences.toolPreferences = Object.fromEntries(
      toolPrefs.map(p => [p.key, p.value])
    )

    return preferences
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get preference statistics
   */
  async getStats(): Promise<{
    total: number
    byCategory: Record<string, number>
    avgConfidence: number
    highConfidenceCount: number
  }> {
    await this.initialize()

    const byCategory: Record<string, number> = {}
    let totalConfidence = 0
    let highConfidenceCount = 0

    for (const entry of this.cache.values()) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1
      totalConfidence += entry.confidence
      if (entry.confidence >= 0.8) {
        highConfidenceCount++
      }
    }

    const count = this.cache.size

    return {
      total: count,
      byCategory,
      avgConfidence: count > 0 ? totalConfidence / count : 0,
      highConfidenceCount,
    }
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Clear all preferences
   */
  async clear(): Promise<void> {
    this.cache.clear()
    await this.savePreferences([])
    log.info("Cleared all preferences")
  }

  /**
   * Export preferences
   */
  async export(): Promise<string> {
    await this.initialize()
    return JSON.stringify(Array.from(this.cache.values()), null, 2)
  }

  /**
   * Import preferences
   */
  async import(data: string): Promise<void> {
    const preferences: PreferenceEntry[] = JSON.parse(data)

    for (const pref of preferences) {
      this.cache.set(`${pref.category}:${pref.key}`, pref)
    }

    await this.savePreferences()
    log.info("Imported preferences", { count: preferences.length })
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Convert entry to UserPreference format
   */
  private entryToPreference(entry: PreferenceEntry): UserPreference {
    return {
      id: entry.id,
      userId: "default", // TODO: Make configurable
      category: entry.category as PreferenceCategory,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      examples: entry.examples,
      metadata: entry.metadata,
    }
  }

  /**
   * Infer category from key pattern
   */
  private inferCategory(key: string): PreferenceCategory {
    const patterns: Record<string, PreferenceCategory> = {
      indent: "code_style",
      quote: "code_style",
      semicolon: "code_style",
      bracket: "code_style",
      language: "communication",
      detail: "communication",
      emoji: "communication",
      test: "tool_usage",
      linter: "tool_usage",
      formatter: "tool_usage",
    }

    for (const [pattern, category] of Object.entries(patterns)) {
      if (key.toLowerCase().includes(pattern)) {
        return category
      }
    }

    return "code_style"
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultInstance: PreferencesService | null = null

export function getPreferencesService(userId?: string): PreferencesService {
  if (!defaultInstance) {
    defaultInstance = new PreferencesService(userId)
  }
  return defaultInstance
}

export async function initializeDefaultPreferences(): Promise<PreferencesService> {
  const service = getPreferencesService()
  await service.initialize()
  return service
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default PreferencesService
