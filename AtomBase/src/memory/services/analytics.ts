/**
 * Memory Analytics Service
 * 
 * Provides insights and statistics about the memory system.
 * Tracks learning effectiveness and provides improvement suggestions.
 */

import os from "os"
import path from "path"
import fs from "fs/promises"

import type {
  MemoryStats,
  EffectivenessMetrics,
  ImprovementSuggestion,
  MemoryItem,
  AnalyticsHistory,
} from "../types"

import { Log } from "../../util/log"

const log = Log.create({ service: "memory.analytics" })

// ============================================================================
// CONSTANTS
// ============================================================================

const ANALYTICS_DIR = ".atomcli/analytics"
const ANALYTICS_FILE = "analytics.json"

// ============================================================================
// ANALYTICS SERVICE
// ============================================================================

export class AnalyticsService {
  private analyticsPath: string
  private historicalData: AnalyticsHistory = {
    dailyStats: [],
    weeklyStats: [],
    monthlyStats: [],
  }

  constructor() {
    this.analyticsPath = path.join(os.homedir(), ANALYTICS_DIR, ANALYTICS_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.analyticsPath), { recursive: true })

      try {
        await fs.access(this.analyticsPath)
        await this.loadHistory()
      } catch {
        await this.saveHistory()
      }

      log.info("Analytics service initialized")
    } catch (error) {
      log.error("Failed to initialize analytics service", { error })
    }
  }

  /**
   * Load historical data
   */
  private async loadHistory(): Promise<void> {
    try {
      const content = await fs.readFile(this.analyticsPath, "utf-8")
      this.historicalData = JSON.parse(content)
    } catch {
      this.historicalData = {
        dailyStats: [],
        weeklyStats: [],
        monthlyStats: [],
      }
    }
  }

  /**
   * Save historical data
   */
  private async saveHistory(): Promise<void> {
    await fs.writeFile(this.analyticsPath, JSON.stringify(this.historicalData, null, 2))
  }

  // ============================================================================
  // USAGE STATISTICS
  // ============================================================================

  /**
   * Get comprehensive usage statistics
   */
  async getUsageStats(
    memories: MemoryItem[],
    preferences: any[],
    sessions: any[]
  ): Promise<MemoryStats> {
    await this.initialize()

    // Count by type
    const memoriesByType: Record<string, number> = {}
    let totalUsage = 0
    let totalSuccess = 0
    const techCount: Record<string, number> = {}

    for (const item of memories) {
      memoriesByType[item.type] = (memoriesByType[item.type] || 0) + 1
      totalUsage += item.metadata.usageCount
      totalSuccess += item.metadata.successRate
      techCount[item.context] = (techCount[item.context] || 0) + 1
    }

    // Calculate learning velocity (items per day)
    const learningVelocity = this.calculateLearningVelocity()

    // Find suggested topics (based on gaps)
    const suggestedTopics = this.findSuggestedTopics(memories, techCount)

    // Top technologies
    const topTechnologies = Object.entries(techCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tech]) => tech)

    return {
      totalMemories: memories.length,
      memoriesByType,
      avgUsageCount: memories.length > 0 ? totalUsage / memories.length : 0,
      successRate: memories.length > 0 ? totalSuccess / memories.length : 1,
      learningVelocity,
      topTechnologies,
      suggestedTopics,
    }
  }

  /**
   * Calculate learning velocity (items learned per day)
   */
  private calculateLearningVelocity(): number {
    const daily = this.historicalData.dailyStats

    if (daily.length < 2) return 0

    // Calculate average of last 7 days
    const recent = daily.slice(-7)
    const total = recent.reduce((sum, d) => sum + d.newItems, 0)

    return Math.round(total / recent.length * 10) / 10
  }

  /**
   * Find suggested topics based on gaps
   */
  private findSuggestedTopics(
    memories: MemoryItem[],
    techCount: Record<string, number>
  ): string[] {
    const suggestions: string[] = []

    // Common topics that might be missing
    const commonTopics = [
      "JavaScript",
      "TypeScript",
      "Python",
      "React",
      "Node.js",
      "Git",
      "Docker",
      "Testing",
    ]

    for (const topic of commonTopics) {
      const techKey = topic.toLowerCase()
      if (!techCount[techKey] && !memories.some(m => 
        m.context.toLowerCase().includes(techKey) ||
        m.tags.some(t => t.toLowerCase().includes(techKey))
      )) {
        suggestions.push(topic)
      }
    }

    return suggestions.slice(0, 5)
  }

  // ============================================================================
  // EFFECTIVENESS METRICS
  // ============================================================================

  /**
   * Calculate learning effectiveness metrics
   */
  async getEffectivenessMetrics(
    memories: MemoryItem[]
  ): Promise<EffectivenessMetrics> {
    await this.initialize()

    const successfulApplications = memories.filter(
      m => m.metadata.successRate >= 0.8
    ).length

    const failedApplications = memories.filter(
      m => m.metadata.successRate < 0.5
    ).length

    // Top patterns by usage
    const topPatterns = memories
      .filter(m => m.type === "pattern" || m.type === "solution")
      .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
      .slice(0, 5)
      .map(m => ({
        pattern: m.title,
        successRate: m.metadata.successRate,
        usageCount: m.metadata.usageCount,
      }))

    return {
      totalLearned: memories.length,
      successfulApplications,
      failedApplications,
      topPatterns,
    }
  }

  // ============================================================================
  // IMPROVEMENT SUGGESTIONS
  // ============================================================================

  /**
   * Generate improvement suggestions
   */
  async getImprovementSuggestions(
    memories: MemoryItem[],
    stats: MemoryStats
  ): Promise<ImprovementSuggestion[]> {
    await this.initialize()

    const suggestions: ImprovementSuggestion[] = []

    // Suggest adding more patterns if success rate is low
    const lowSuccessItems = memories.filter(m => m.metadata.successRate < 0.6)
    if (lowSuccessItems.length > memories.length * 0.2) {
      suggestions.push({
        area: "learning",
        suggestion: "Consider reviewing and improving low-success patterns",
        priority: 8,
        reason: `${lowSuccessItems.length} items have success rate below 60%`,
      })
    }

    // Suggest more diverse technologies if top technologies is small
    if (stats.topTechnologies.length < 3) {
      suggestions.push({
        area: "knowledge",
        suggestion: "Expand knowledge to more technologies",
        priority: 5,
        reason: "Currently focused on limited technologies",
      })
    }

    // Suggest adding more error patterns if learning velocity is low
    const errorCount = memories.filter(m => m.type === "error").length
    if (errorCount < 5) {
      suggestions.push({
        area: "error_handling",
        suggestion: "Learn more error patterns to improve debugging",
        priority: 6,
        reason: "Only " + errorCount + " error patterns recorded",
      })
    }

    // Suggest generating embeddings if missing
    const missingEmbeddings = memories.filter(m => !m.embedding).length
    if (missingEmbeddings > 10) {
      suggestions.push({
        area: "search",
        suggestion: "Generate embeddings for better semantic search",
        priority: 4,
        reason: `${missingEmbeddings} items lack embeddings`,
      })
    }

    return suggestions.sort((a, b) => b.priority - a.priority)
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  /**
   * Generate a comprehensive report
   */
  async generateReport(
    period: "week" | "month" | "all",
    memories: MemoryItem[],
    preferences: any[],
    sessions: any[]
  ): Promise<string> {
    await this.initialize()

    const stats = await this.getUsageStats(memories, preferences, sessions)
    const effectiveness = await this.getEffectivenessMetrics(memories)
    const suggestions = await this.getImprovementSuggestions(memories, stats)

    const periodLabel = period === "week" ? "Last Week" 
      : period === "month" ? "Last Month" 
      : "All Time"

    const report = `
# Memory System Report - ${periodLabel}

## Overview
- **Total Memories:** ${stats.totalMemories}
- **Learning Velocity:** ${stats.learningVelocity} items/day
- **Average Success Rate:** ${(stats.successRate * 100).toFixed(1)}%
- **Average Usage Count:** ${stats.avgUsageCount.toFixed(1)}

## By Type
${Object.entries(stats.memoriesByType)
  .map(([type, count]) => `- **${type}:** ${count}`)
  .join("\n")}

## Top Technologies
${stats.topTechnologies.map(t => `- ${t}`).join("\n") || "- No data yet"}

## Effectiveness
- **Successful Applications:** ${effectiveness.successfulApplications}
- **Failed Applications:** ${effectiveness.failedApplications}

## Top Patterns
${effectiveness.topPatterns.length > 0
  ? effectiveness.topPatterns.map(p => 
      `- **${p.pattern}** (${(p.successRate * 100).toFixed(0)}% success, ${p.usageCount} uses)`
    ).join("\n")
  : "- No patterns recorded yet"}

## Suggested Topics
${stats.suggestedTopics.length > 0
  ? stats.suggestedTopics.map(t => `- ${t}`).join("\n")
  : "- No suggestions yet"}

## Improvement Areas
${suggestions.length > 0
  ? suggestions.map(s => 
      `- **[${s.area}]** ${s.suggestion} (priority: ${s.priority})`
    ).join("\n")
  : "- No improvements needed"}
`

    return report.trim()
  }

  // ============================================================================
  // HISTORY TRACKING
  // ============================================================================

  /**
   * Record daily statistics
   */
  async recordDailyStats(newItems: number, totalItems: number): Promise<void> {
    const today = new Date().toISOString().split("T")[0]

    const dailyStat = {
      date: today,
      newItems,
      totalItems,
    }

    this.historicalData.dailyStats.push(dailyStat)

    // Keep only last 90 days
    if (this.historicalData.dailyStats.length > 90) {
      this.historicalData.dailyStats = this.historicalData.dailyStats.slice(-90)
    }

    await this.saveHistory()
  }

  /**
   * Get trend data for visualization
   */
  async getTrendData(days: number = 30): Promise<Array<{
    date: string
    newItems: number
    totalItems: number
  }>> {
    await this.initialize()

    return this.historicalData.dailyStats.slice(-days)
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  /**
   * Check memory system health
   */
  async checkHealth(
    memories: MemoryItem[],
    preferences: any[]
  ): Promise<{
    status: "healthy" | "warning" | "critical"
    issues: string[]
    score: number
  }> {
    await this.initialize()

    const issues: string[] = []
    let score = 100

    // Check for data issues
    if (memories.length === 0) {
      issues.push("No memories recorded")
      score -= 30
    }

    // Check success rate
    const avgSuccess = memories.length > 0
      ? memories.reduce((sum, m) => sum + m.metadata.successRate, 0) / memories.length
      : 1

    if (avgSuccess < 0.5) {
      issues.push("Low success rate - patterns may not be effective")
      score -= 20
    } else if (avgSuccess < 0.7) {
      issues.push("Below average success rate")
      score -= 10
    }

    // Check for unused memories
    const unused = memories.filter(m => m.metadata.usageCount === 0).length
    if (unused > memories.length * 0.5 && memories.length > 10) {
      issues.push("Many memories never used")
      score -= 15
    }

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy"
    if (score < 50) {
      status = "critical"
    } else if (score < 80) {
      status = "warning"
    }

    return {
      status,
      issues,
      score,
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultInstance: AnalyticsService | null = null

export function getAnalyticsService(): AnalyticsService {
  if (!defaultInstance) {
    defaultInstance = new AnalyticsService()
  }
  return defaultInstance
}

export async function initializeAnalytics(): Promise<AnalyticsService> {
  const service = getAnalyticsService()
  await service.initialize()
  return service
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default AnalyticsService
