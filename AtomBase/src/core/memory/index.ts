/**
 * AtomCLI Memory System - Main Entry Point
 * 
 * Persistent memory system for learning, preferences, and knowledge.
 * Supports both JSON file storage and ChromaDB vector storage.
 * 
 * Features:
 * - Learning from errors and experiences
 * - User preferences memory
 * - Session persistence
 * - Knowledge graph (simple)
 * - Semantic search with embeddings
 * - Background learning
 */

// Re-export everything from types
export * from "./types"

// ============================================================================
// STORAGE
// ============================================================================

export { createStorage, createVectorStorage, HybridStorage } from "./storage/adapter"
export { JSONStorage } from "./storage/json"
export { ChromaStorage } from "./storage/vector"

export type { MemoryStorage as IMemoryStorage, StorageConfig } from "./storage/adapter"

// ============================================================================
// EMBEDDING
// ============================================================================

export {
  OpenAIEmbedding,
  LocalEmbedding,
  createEmbeddingService,
  cosineSimilarity,
  euclideanDistance,
  normalizeVector,
  truncateVector,
  padVector,
  preprocessForEmbedding,
  summarizeForEmbedding,
} from "./core/embedding"

export type { EmbeddingServiceConfig } from "./core/embedding"

// ============================================================================
// INTEGRATION
// ============================================================================

export { SessionMemoryIntegration } from "./integration/session"

// ============================================================================
// VERSION
// ============================================================================

export const MEMORY_SYSTEM_VERSION = "1.0.0"

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

import os from "os"
import { join } from "path"

export function getMemoryDir(): string {
  return join(os.homedir(), ".atomcli", "memory")
}

export function getJsonStoragePath(): string {
  return join(getMemoryDir(), "memories.json")
}

export function getChromaStoragePath(): string {
  return join(getMemoryDir(), "chroma")
}

export function isConfigured(): boolean {
  return true
}

export function getCapabilities(): {
  jsonStorage: boolean
  vectorStorage: boolean
  embedding: boolean
  backgroundLearning: boolean
  knowledgeGraph: boolean
} {
  return {
    jsonStorage: true,
    vectorStorage: false, // Explicitly false as it's an optional dependency now
    embedding: true,
    backgroundLearning: true,
    knowledgeGraph: true,
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

import type { EmbeddingService } from "./core/embedding"
import type { MemoryStorage } from "./storage/adapter"
import type { MemoryConfig, createMemoryItem as createMemoryItemFn, createUserPreference as createUserPreferenceFn } from "./types"

export async function initialize(config?: Partial<MemoryConfig>): Promise<{
  storage: MemoryStorage
  embedding: EmbeddingService
  config: MemoryConfig
}> {
  const memoryConfig = { ...defaultMemoryConfig, ...config }

  const storage = await createStorage({
    type: memoryConfig.storage,
    chromaPath: memoryConfig.chroma?.persistPath,
  })

  const embedding = createEmbeddingService(memoryConfig.embedding)

  return {
    storage,
    embedding,
    config: memoryConfig,
  }
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const defaultMemoryConfig: MemoryConfig = {
  enabled: true,
  storage: "hybrid",
  chroma: {
    persistPath: undefined,
  },
  embedding: {
    provider: "local",
    model: "text-embedding-3-small", // Kept just in case, but provider is local
    dimensions: 512,
  },
  backgroundLearning: {
    enabled: true,
    idleThreshold: 300000,
    maxConcurrent: 2,
    maxQueueSize: 100,
  },
  retention: {
    maxItems: 10000,
    ttlDays: 365,
  },
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

import { createStorage, createVectorStorage, HybridStorage } from "./storage/adapter"
import { JSONStorage } from "./storage/json"
import { ChromaStorage } from "./storage/vector"
import { createEmbeddingService, cosineSimilarity } from "./core/embedding"
import { createMemoryItem, createUserPreference } from "./types"
import { MemoryType, PreferenceCategory, NodeType, EdgeType } from "./types"

// New personality services
import {
  AIPersonalityService,
  getAIPersonality,
  defaultPersonalities,
  AIRole,
  FormalityLevel,
  HumorStyle,
  ProactivityLevel,
} from "./services/personality"

import {
  UserProfileService,
  getUserProfile,
  UserToAIRelation,
  TechLevel,
  LearningStyle,
  WorkStyle,
  CommunicationPreference,
} from "./services/user-profile"

import {
  CommunicationService,
  getCommunication,
  CommunicationMode,
  ResponseLength,
  VocabularyStyle,
  EmojiPreference,
} from "./services/communication"

import {
  PromptContextBuilder,
  getPromptContextBuilder,
} from "./services/prompt-context"

const memorySystem = {
  // Types
  MemoryType,
  PreferenceCategory,
  NodeType,
  EdgeType,

  // Enums
  AIRole,
  FormalityLevel,
  HumorStyle,
  ProactivityLevel,
  UserToAIRelation,
  TechLevel,
  LearningStyle,
  WorkStyle,
  CommunicationPreference,
  CommunicationMode,
  ResponseLength,
  VocabularyStyle,
  EmojiPreference,

  // Core
  createMemoryItem,
  createUserPreference,

  // Storage
  createStorage,
  createVectorStorage,
  JSONStorage,
  ChromaStorage,

  // Embedding
  createEmbeddingService,
  cosineSimilarity,

  // Personality Services
  AIPersonalityService,
  getAIPersonality,
  defaultPersonalities,

  // User Profile Services
  UserProfileService,
  getUserProfile,

  // Communication Services
  CommunicationService,
  getCommunication,

  // Prompt Context Builder
  PromptContextBuilder,
  getPromptContextBuilder,

  // Config
  defaultMemoryConfig,
  MEMORY_SYSTEM_VERSION,

  // Functions
  initialize,
  getMemoryDir,
  getJsonStoragePath,
  getChromaStoragePath,
  isConfigured,
  getCapabilities,
}

export default memorySystem

// ============================================================================
// DIRECT EXPORTS (for easier importing)
// ============================================================================

export {
  // Personality
  AIPersonalityService,
  getAIPersonality,
  defaultPersonalities,
  AIRole,
  FormalityLevel,
  HumorStyle,
  ProactivityLevel,

  // User Profile
  UserProfileService,
  getUserProfile,
  UserToAIRelation,
  TechLevel,
  LearningStyle,
  WorkStyle,
  CommunicationPreference,

  // Communication
  CommunicationService,
  getCommunication,
  CommunicationMode,
  ResponseLength,
  VocabularyStyle,
  EmojiPreference,

  // Prompt Context
  PromptContextBuilder,
  getPromptContextBuilder,
}
