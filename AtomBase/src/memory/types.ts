/**
 * AtomCLI Memory System - Core Types
 * 
 * This module defines all the type definitions for the persistent memory system.
 * These types support learning, preferences, session persistence, and knowledge graph.
 */

import { z } from "zod"
import { ulid } from "ulid"

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Memory item types - categorizes what kind of information is stored
 */
export const MemoryType = z.enum([
  "error",      // Error patterns and solutions
  "pattern",    // Successful patterns and approaches
  "solution",   // Specific solutions to problems
  "preference", // User preferences and settings
  "context",    // Project/context specific information
  "research",   // Web research findings
  "knowledge",  // General knowledge acquired
])

export type MemoryType = z.infer<typeof MemoryType>

/**
 * Preference categories - groups user preferences by domain
 */
export const PreferenceCategory = z.enum([
  "code_style",      // Code formatting, style preferences
  "communication",   // How to communicate with user
  "tool_usage",      // Preferred tools and commands
  "feature",         // Feature preferences and settings
  "workflow",        // Workflow and process preferences
  "language",        // Programming language preferences
  "framework",       // Framework preferences
])

export type PreferenceCategory = z.infer<typeof PreferenceCategory>

/**
 * Knowledge graph node types
 */
export const NodeType = z.enum([
  "concept",   // Abstract concept
  "pattern",   // Code pattern
  "error",     // Error node
  "solution",  // Solution node
  "file",      // File reference
  "project",   // Project reference
  "technology", // Technology stack
  "knowledge", // General knowledge
])

export type NodeType = z.infer<typeof NodeType>

/**
 * Knowledge graph edge types
 */
export const EdgeType = z.enum([
  "related_to",   // General relationship
  "depends_on",   // Dependency
  "solves",       // Solves relationship
  "causes",       // Causes relationship
  "improves",     // Improves relationship
  "implements",   // Implementation relationship
  "uses",         // Usage relationship
  "similar_to",   // Similarity
])

export type EdgeType = z.infer<typeof EdgeType>

// ============================================================================
// BASE TYPES
// ============================================================================

/**
 * Base metadata attached to all memory items
 */
export const MemoryMetadata = z.object({
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  source: z.string(), // experience, web, user, tool
  usageCount: z.number(),
  lastUsed: z.string().optional(),
  successRate: z.number(),
})

export type MemoryMetadata = z.infer<typeof MemoryMetadata>

/**
 * Search options for memory queries
 */
export const SearchOptions = z.object({
  type: MemoryType.optional(),
  context: z.string().optional(),
  limit: z.number(),
  minRelevance: z.number(),
  tags: z.array(z.string()).optional,
})

export type SearchOptions = z.infer<typeof SearchOptions>

/**
 * Relevance scored search result
 */
export interface SearchResult {
  item: MemoryItem
  score: number
  matchType: "keyword" | "vector" | "hybrid"
}

// ============================================================================
// CORE MEMORY TYPES
// ============================================================================

/**
 * Main memory item - represents a single unit of learned information
 */
export const MemoryItem = z.object({
  id: z.string(),
  type: MemoryType,
  title: z.string(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  context: z.string(),
  problem: z.string().optional(),
  solution: z.string().optional(),
  codeBefore: z.string().optional(),
  codeAfter: z.string().optional(),
  tags: z.array(z.string()),
  metadata: MemoryMetadata,
  relationships: z.array(z.string()),
  strength: z.number(),
})

export type MemoryItem = z.infer<typeof MemoryItem>

/**
 * Error-specific memory with root cause analysis
 */
export const ErrorLearning = z.object({
  id: z.string(),
  errorType: z.string(),          // "TypeError", "ReferenceError", etc.
  errorMessage: z.string(),
  stackTrace: z.string().optional(),
  filePath: z.string().optional(),
  lineNumber: z.number().optional(),
  
  // Analysis
  rootCause: z.string(),
  solution: z.string(),
  prevention: z.string(),
  
  // Meta
  technology: z.string(),
  metadata: MemoryMetadata,
  appliedCount: z.number(),
  successfulFixes: z.number(),
})

export type ErrorLearning = z.infer<typeof ErrorLearning>

/**
 * Research learning - stores web research findings
 */
export const ResearchLearning = z.object({
  id: z.string(),
  query: z.string(),
  topic: z.string(),
  findings: z.array(z.object({
    source: z.string(),
    content: z.string(),
    relevance: z.number(),
  })),
  summary: z.string(),
  appliedTo: z.array(z.string()),
  metadata: MemoryMetadata,
})

export type ResearchLearning = z.infer<typeof ResearchLearning>

// ============================================================================
// USER PREFERENCES TYPES
// ============================================================================

/**
 * User preference - stores learned user preferences
 */
export const UserPreference = z.object({
  id: z.string(),
  userId: z.string(),
  category: PreferenceCategory,
  key: z.string(),
  value: z.any(),
  confidence: z.number(),
  examples: z.array(z.string()),
  metadata: MemoryMetadata,
})

export type UserPreference = z.infer<typeof UserPreference>

/**
 * Style guide generated from user preferences
 */
export interface StyleGuide {
  indent: {
    style: "space" | "tab"
    size: number
  }
  quotes: "single" | "double"
  semicolons: boolean
  lineLength: number
  brackets: "same-line" | "new-line"
}

// ============================================================================
// SESSION PERSISTENCE TYPES
// ============================================================================

/**
 * Persisted task state
 */
export const PersistedTask = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "complete", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PersistedTask = z.infer<typeof PersistedTask>

/**
 * Session state - preserves session data across sessions
 */
export const SessionState = z.object({
  id: z.string(),
  userId: z.string(),
  projectPath: z.string().optional(),
  startedAt: z.string(),
  lastActive: z.string(),
  summary: z.string(),
  tasks: z.array(PersistedTask),
  learnedItems: z.array(z.string()),
  preferences: z.array(z.string()),
  conversationSummary: z.string().optional(),
})

export type SessionState = z.infer<typeof SessionState>

/**
 * Session summary for quick recall
 */
export interface SessionSummary {
  id: string
  date: string
  duration: number
  tasks: string[]
  filesModified: string[]
  errors: string[]
  learnedCount: number
  highlights: string[]
  summary?: string
}

// ============================================================================
// KNOWLEDGE GRAPH TYPES
// ============================================================================

/**
 * Knowledge graph node
 */
export const KnowledgeNode = z.object({
  id: z.string(),
  type: NodeType,
  label: z.string(),
  properties: z.record(z.any()),
  embedding: z.array(z.number()).optional(),
  createdAt: z.string(),
  relationships: z.array(z.string()),
  strength: z.number(),
})

export type KnowledgeNode = z.infer<typeof KnowledgeNode>

/**
 * Knowledge graph edge
 */
export const KnowledgeEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeType,
  weight: z.number(),
  createdAt: z.string(),
})

export type KnowledgeEdge = z.infer<typeof KnowledgeEdge>

/**
 * Knowledge graph
 */
export const KnowledgeGraph = z.object({
  nodes: z.record(z.string(), KnowledgeNode),
  edges: z.record(z.string(), KnowledgeEdge),
})

export type KnowledgeGraph = z.infer<typeof KnowledgeGraph>

// ============================================================================
// BACKGROUND LEARNING TYPES
// ============================================================================

/**
 * Background task priority levels
 */
export const BackgroundPriority = z.enum(["high", "medium", "low"])

export type BackgroundPriority = z.infer<typeof BackgroundPriority>

/**
 * Background task types
 */
export const BackgroundTaskType = z.enum([
  "embed",          // Generate embeddings
  "graph_cleanup",  // Clean up graph
  "research",       // Do research
  "suggestion",     // Generate suggestions
  "summary",        // Summarize conversations
  "migration",      // Data migration
])

export type BackgroundTaskType = z.infer<typeof BackgroundTaskType>

/**
 * Background task
 */
export const BackgroundTask = z.object({
  id: z.string(),
  type: BackgroundTaskType,
  priority: BackgroundPriority,
  data: z.record(z.any()).optional(),
  createdAt: z.string(),
  scheduledAt: z.string().optional(),
})

export type BackgroundTask = z.infer<typeof BackgroundTask>

/**
 * Background learning status
 */
export const BackgroundStatus = z.enum(["running", "paused", "idle"])

export type BackgroundStatus = z.infer<typeof BackgroundStatus>

/**
 * Background learning configuration
 */
export const BackgroundConfig = z.object({
  enabled: z.boolean,
  idleThreshold: z.number(), // 5 minutes
  maxConcurrent: z.number(),
  maxQueueSize: z.number(),
})

export type BackgroundConfig = z.infer<typeof BackgroundConfig>

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

/**
 * Memory usage statistics
 */
export const MemoryStats = z.object({
  totalMemories: z.number(),
  memoriesByType: z.record(z.string(), z.number()),
  avgUsageCount: z.number(),
  successRate: z.number(),
  learningVelocity: z.number(), // per day
  topTechnologies: z.array(z.string()),
  suggestedTopics: z.array(z.string()),
})

export type MemoryStats = z.infer<typeof MemoryStats>

/**
 * Effectiveness metrics for learning
 */
export const EffectivenessMetrics = z.object({
  totalLearned: z.number(),
  successfulApplications: z.number(),
  failedApplications: z.number(),
  topPatterns: z.array(z.object({
    pattern: z.string(),
    successRate: z.number(),
    usageCount: z.number(),
  })),
})

export type EffectivenessMetrics = z.infer<typeof EffectivenessMetrics>

/**
 * Improvement suggestion
 */
export const ImprovementSuggestion = z.object({
  area: z.string(),
  suggestion: z.string(),
  priority: z.number(),
  reason: z.string(),
})

export type ImprovementSuggestion = z.infer<typeof ImprovementSuggestion>

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * Memory system configuration
 */
export const MemoryConfig = z.object({
  enabled: z.boolean,
  storage: z.enum(["json", "chroma", "hybrid"]),
  chroma: z.object({
    persistPath: z.string().optional(),
  }).optional(),
  embedding: z.object({
    provider: z.enum(["openai", "local"]),
    model: z.string(),
    dimensions: z.number(),
  }).optional(),
  backgroundLearning: BackgroundConfig.optional(),
  retention: z.object({
    maxItems: z.number(),
    ttlDays: z.number(),
  }).optional(),
})

export type MemoryConfig = z.infer<typeof MemoryConfig>

/**
 * Embedding service configuration (from embedding.ts)
 */
export interface EmbeddingServiceConfig {
  provider: "openai" | "local"
  model: string
  dimensions: number
  apiKey?: string
  baseUrl?: string
}

/**
 * Analytics historical data
 */
export interface AnalyticsHistory {
  dailyStats: Array<{
    date: string
    newItems: number
    totalItems: number
  }>
  weeklyStats: Array<{
    week: string
    newItems: number
    totalItems: number
  }>
  monthlyStats: Array<{
    month: string
    newItems: number
    totalItems: number
  }>
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a new memory item
 */
export function createMemoryItem(data: Partial<MemoryItem>): MemoryItem {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    type: data.type || "knowledge",
    title: data.title || "",
    content: data.content || "",
    context: data.context || "general",
    tags: data.tags || [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      source: data.metadata?.source || "experience",
      usageCount: 0,
      successRate: 1,
      ...data.metadata,
    },
    relationships: data.relationships || [],
    strength: data.strength || 0.5,
    ...data,
  }
}

/**
 * Create a new user preference
 */
export function createUserPreference(
  userId: string,
  category: PreferenceCategory,
  key: string,
  value: any
): UserPreference {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    userId,
    category,
    key,
    value,
    confidence: 0.5,
    examples: [],
    metadata: {
      createdAt: now,
      source: "behavior",
      usageCount: 0,
      successRate: 1,
    },
  }
}
