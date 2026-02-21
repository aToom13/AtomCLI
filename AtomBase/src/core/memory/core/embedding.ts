/**
 * Embedding Service
 * 
 * Generates vector embeddings for text content using OpenAI or local models.
 * Used for semantic search in memory storage.
 */

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.embedding" })

// ============================================================================
// EMBEDDING CONFIG
// ============================================================================

export interface EmbeddingServiceConfig {
  provider: "openai" | "local"
  model: string
  dimensions: number
  apiKey?: string
  baseUrl?: string
}

// Default configuration
const defaultConfig: EmbeddingServiceConfig = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 512,
}

// ============================================================================
// EMBEDDING SERVICE INTERFACE
// ============================================================================

export interface EmbeddingService {
  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<number[]>

  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch(texts: string[]): Promise<number[][]>

  /**
   * Calculate similarity between two vectors
   */
  compare(a: number[], b: number[]): number

  /**
   * Get service info
   */
  getInfo(): { provider: string; model: string; dimensions: number }
}

// ============================================================================
// OPENAI EMBEDDING SERVICE
// ============================================================================

export class OpenAIEmbedding implements EmbeddingService {
  private config: EmbeddingServiceConfig
  private client: any = null

  constructor(config?: Partial<EmbeddingServiceConfig>) {
    this.config = { ...defaultConfig, ...config }
  }

  /**
   * Initialize OpenAI client
   */
  private async getClient(): Promise<any> {
    if (this.client) return this.client

    // Use dynamic import for OpenAI with @ai-sdk/openai
    const { createOpenAI } = await import("@ai-sdk/openai")
    this.client = createOpenAI({
      apiKey: this.config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: this.config.baseUrl,
    })

    return this.client
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    try {
      const client = await this.getClient()

      const response = await client.embeddings.create({
        model: this.config.model,
        input: text.slice(0, 8000), // Truncate if too long
        encoding_format: "float",
      })

      const embedding = response.data[0].embedding

      log.debug("Generated embedding", {
        model: this.config.model,
        dimensions: embedding.length,
        textLength: text.length,
      })

      return embedding
    } catch (error) {
      log.error("Failed to generate embedding", { error })
      throw error
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    try {
      const client = await this.getClient()

      // OpenAI has a max batch size of 2048
      const batchSize = 100
      const results: number[][] = []

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize).map(t => t.slice(0, 8000))

        const response = await client.embeddings.create({
          model: this.config.model,
          input: batch,
          encoding_format: "float",
        })

        for (const data of response.data) {
          results.push(data.embedding)
        }

        log.debug("Batch embedding progress", {
          processed: Math.min(i + batchSize, texts.length),
          total: texts.length,
        })
      }

      return results
    } catch (error) {
      log.error("Failed to generate batch embeddings", { error })
      throw error
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  compare(a: number[], b: number[]): number {
    return cosineSimilarity(a, b)
  }

  /**
   * Get service info
   */
  getInfo(): { provider: string; model: string; dimensions: number } {
    return {
      provider: "openai",
      model: this.config.model,
      dimensions: this.config.dimensions,
    }
  }
}

// ============================================================================
// LOCAL EMBEDDING SERVICE (OLLAMA)
// ============================================================================

export class LocalEmbedding implements EmbeddingService {
  private config: EmbeddingServiceConfig
  private baseUrl: string

  constructor(config?: Partial<EmbeddingServiceConfig>) {
    this.config = {
      ...defaultConfig,
      provider: "local",
      model: config?.model || "nomic-embed-text",
      dimensions: config?.dimensions || 768,
      ...config,
    }
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434"
  }

  /**
   * Generate embedding using local Ollama server
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          input: text.slice(0, 8000),
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`)
      }

      const data = await response.json()
      const embedding = data.embeddings?.[0]

      if (!embedding) {
        throw new Error("No embedding in response")
      }

      log.debug("Generated local embedding", {
        model: this.config.model,
        dimensions: embedding.length,
      })

      return embedding
    } catch (error) {
      log.error("Failed to generate local embedding", { error })
      throw error
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // Process sequentially for local embedding
    const results: number[][] = []

    for (let i = 0; i < texts.length; i++) {
      const embedding = await this.embed(texts[i])
      results.push(embedding)

      if (i % 10 === 0) {
        log.debug("Local batch progress", {
          processed: i + 1,
          total: texts.length,
        })
      }
    }

    return results
  }

  /**
   * Calculate cosine similarity
   */
  compare(a: number[], b: number[]): number {
    return cosineSimilarity(a, b)
  }

  /**
   * Get service info
   */
  getInfo(): { provider: string; model: string; dimensions: number } {
    return {
      provider: "local",
      model: this.config.model,
      dimensions: this.config.dimensions,
    }
  }
}

// ============================================================================
// EMBEDDING SERVICE FACTORY
// ============================================================================

/**
 * Create embedding service based on configuration
 */
export function createEmbeddingService(config?: Partial<EmbeddingServiceConfig>): EmbeddingService {
  const fullConfig = { ...defaultConfig, ...config }

  switch (fullConfig.provider) {
    case "local":
      return new LocalEmbedding(fullConfig)
    case "openai":
    default:
      return new OpenAIEmbedding(fullConfig)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

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
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity

  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2)
  }

  return Math.sqrt(sum)
}

/**
 * Normalize vector to unit length
 */
export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vector
  return vector.map(v => v / norm)
}

/**
 * Truncate vector to specific dimensions
 */
export function truncateVector(vector: number[], targetDimensions: number): number[] {
  if (vector.length <= targetDimensions) return vector
  return vector.slice(0, targetDimensions)
}

/**
 * Pad vector to specific dimensions
 */
export function padVector(vector: number[], targetDimensions: number): number[] {
  if (vector.length >= targetDimensions) return vector.slice(0, targetDimensions)
  return [...vector, ...new Array(targetDimensions - vector.length).fill(0)]
}

/**
 * Batch texts for embedding (respecting token limits)
 */
export function batchTextsForEmbedding(
  texts: string[],
  maxTokens: number = 8000,
  avgTokensPerChar: number = 4
): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentTokens = 0

  for (const text of texts) {
    const textTokens = text.length * avgTokensPerChar

    if (currentTokens + textTokens > maxTokens && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
      currentTokens = 0
    }

    currentBatch.push(text)
    currentTokens += textTokens
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

// ============================================================================
// TEXT EMBEDDING PREPROCESSING
// ============================================================================

/**
 * Preprocess text for better embedding quality
 */
export function preprocessForEmbedding(text: string): string {
  // Remove excessive whitespace
  let processed = text.replace(/\s+/g, " ").trim()

  // Keep important structure but simplify
  // Code blocks might need special handling

  return processed
}

/**
 * Create a summary for long texts
 */
export async function summarizeForEmbedding(
  text: string,
  maxLength: number = 2000
): Promise<string> {
  if (text.length <= maxLength) {
    return preprocessForEmbedding(text)
  }

  // Simple truncation with preprocessing
  // In production, could use LLM summarization
  const truncated = text.slice(0, maxLength)
  return preprocessForEmbedding(truncated)
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default createEmbeddingService
