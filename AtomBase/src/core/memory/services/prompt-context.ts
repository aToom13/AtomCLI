/**
 * Prompt Context Builder
 * 
 * Combines all memory systems to build rich context for AI prompts.
 * Creates a comprehensive context that includes personality, preferences,
 * history, and learned knowledge.
 */

import type { MemoryItem, MemoryConfig } from "../types"

// Import all memory services
import type { AIPersonality } from "./personality"
import type { UserProfile } from "./user-profile"
import type { CommunicationProfile } from "./communication"

import type { MemoryStorage } from "../storage/adapter"
import type { EmbeddingService } from "../core/embedding"

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Complete prompt context
 */
export interface PromptContext {
  // System prompt section
  system: string
  
  // AI personality section
  aiPersonality: string
  
  // User context section  
  userContext: string
  
  // Communication style section
  communication: string
  
  // Relevant memories section
  relevantMemories: string
  
  // Knowledge context section
  knowledgeContext: string
  
  // Task-specific context
  taskContext: string
  
  // Combined full context
  fullContext: string
  
  // Metadata
  metadata: {
    createdAt: string
    memoryCount: number
    hasPersonality: boolean
    hasUserContext: boolean
  }
}

/**
 * Context building options
 */
export interface ContextBuilderOptions {
  task?: string
  taskContext?: string
  searchQuery?: string
  searchLimit?: number
  includeSystem?: boolean
  includePersonality?: boolean
  includeUserContext?: boolean
  includeCommunication?: boolean
  includeMemories?: boolean
  includeKnowledge?: boolean
}

// ============================================================================
// PROMPT CONTEXT BUILDER
// ============================================================================

export class PromptContextBuilder {
  private memoryStorage: MemoryStorage | null = null
  private embeddingService: EmbeddingService | null = null
  
  // Service instances
  private personalityService: any = null
  private userProfileService: any = null
  private communicationService: any = null
  private knowledgeGraphService: any = null

  constructor(
    memoryStorage?: MemoryStorage,
    embeddingService?: EmbeddingService
  ) {
    this.memoryStorage = memoryStorage || null
    this.embeddingService = embeddingService || null
  }

  // ============================================================================
  // SERVICE INITIALIZATION
  // ============================================================================

  async initializeServices(): Promise<void> {
    try {
      // Lazy load services
      const { getAIPersonality } = await import("./personality")
      const { getUserProfile } = await import("./user-profile")
      const { getCommunication } = await import("./communication")
      
      this.personalityService = getAIPersonality()
      this.userProfileService = getUserProfile()
      this.communicationService = getCommunication()
      
      // Initialize personality service
      await this.personalityService.initialize()
      await this.userProfileService.initialize()
      await this.communicationService.initialize()
    } catch (error) {
      console.warn("Failed to initialize context services:", error)
    }
  }

  // ============================================================================
  // MAIN BUILD FUNCTION
  // ============================================================================

  /**
   * Build complete prompt context
   */
  async buildContext(options: ContextBuilderOptions = {}): Promise<PromptContext> {
    await this.initializeServices()
    
    const {
      task = "",
      taskContext = "",
      searchQuery = "",
      searchLimit = 5,
      includeSystem = true,
      includePersonality = true,
      includeUserContext = true,
      includeCommunication = true,
      includeMemories = true,
      includeKnowledge = true,
    } = options

    // Build each section
    const sections: string[] = []
    
    // 1. System section (base instructions)
    let systemSection = ""
    if (includeSystem) {
      systemSection = await this.buildSystemSection()
      sections.push(systemSection)
    }
    
    // 2. AI Personality section
    let aiPersonalitySection = ""
    if (includePersonality) {
      aiPersonalitySection = await this.buildPersonalitySection()
      sections.push(aiPersonalitySection)
    }
    
    // 3. User Context section
    let userContextSection = ""
    if (includeUserContext) {
      userContextSection = await this.buildUserContextSection()
      sections.push(userContextSection)
    }
    
    // 4. Communication Style section
    let communicationSection = ""
    if (includeCommunication) {
      communicationSection = await this.buildCommunicationSection()
      sections.push(communicationSection)
    }
    
    // 5. Relevant Memories section
    let memoriesSection = ""
    if (includeMemories && searchQuery) {
      memoriesSection = await this.buildMemoriesSection(searchQuery, searchLimit)
      sections.push(memoriesSection)
    }
    
    // 6. Knowledge Context section
    let knowledgeSection = ""
    if (includeKnowledge && task) {
      knowledgeSection = await this.buildKnowledgeSection(task)
      sections.push(knowledgeSection)
    }
    
    // 7. Task Context section
    let taskSection = ""
    if (taskContext) {
      taskSection = await this.buildTaskSection(taskContext)
      sections.push(taskSection)
    }

    // Combine all sections
    const fullContext = sections.join("\n\n---\n\n")

    // Get stats for metadata
    let memoryCount = 0
    if (this.memoryStorage) {
      memoryCount = await this.memoryStorage.getCount()
    }

    return {
      system: systemSection,
      aiPersonality: aiPersonalitySection,
      userContext: userContextSection,
      communication: communicationSection,
      relevantMemories: memoriesSection,
      knowledgeContext: knowledgeSection,
      taskContext: taskSection,
      fullContext,
      metadata: {
        createdAt: new Date().toISOString(),
        memoryCount,
        hasPersonality: includePersonality,
        hasUserContext: includeUserContext,
      },
    }
  }

  // ============================================================================
  // SECTION BUILDERS
  // ============================================================================

  /**
   * Build system section with base instructions
   */
  private async buildSystemSection(): Promise<string> {
    return `# System Instructions

You are a helpful AI assistant with persistent memory. You:
- Remember previous interactions and learn from them
- Adapt your communication style to match the user
- Provide contextually appropriate responses
- Use your learned knowledge to provide better assistance
- Are honest about what you know and don't know`
  }

  /**
   * Build AI personality section
   */
  private async buildPersonalitySection(): Promise<string> {
    try {
      const personalityContext = await this.personalityService?.buildContext()
      if (personalityContext) {
        return `# AI Personality\n\n${personalityContext}`
      }
    } catch {
      // Service not available
    }
    
    return `# AI Personality

You are a helpful, friendly AI assistant. You communicate clearly and helpfully.`
  }

  /**
   * Build user context section
   */
  private async buildUserContextSection(): Promise<string> {
    try {
      const userContext = await this.userProfileService?.buildContext()
      if (userContext) {
        return `# User Context\n\n${userContext}`
      }
      
      // Try direct method
      const profile = await this.userProfileService?.getProfile()
      if (profile) {
        return `# User Context

- Tech level: ${profile.techLevel}
- Primary language: ${profile.primaryLanguage}
- Communication style: ${profile.communication}
- Learning style: ${profile.learningStyle}
- Work style: ${profile.workStyle}`
      }
    } catch {
      // Service not available
    }
    
    return ""
  }

  /**
   * Build communication style section
   */
  private async buildCommunicationSection(): Promise<string> {
    try {
      const commContext = await this.communicationService?.buildContext()
      if (commContext) {
        return `# Communication Style\n\n${commContext}`
      }
    } catch {
      // Service not available
    }
    
    return ""
  }

  /**
   * Build relevant memories section
   */
  private async buildMemoriesSection(query: string, limit: number): Promise<string> {
    if (!this.memoryStorage) {
      return ""
    }

    try {
      const memories = await this.memoryStorage.search(query, { 
        limit,
        minRelevance: 0,
        tags: [],
      })
      
      if (memories.length === 0) {
        return ""
      }

      const memoryTexts = memories.map((m, i) => {
        let text = `## Memory ${i + 1}: ${m.title}\n`
        text += `- Type: ${m.type}\n`
        text += `- Context: ${m.context}\n`
        text += `- Content: ${m.content}\n`
        if (m.solution) {
          text += `- Solution: ${m.solution}\n`
        }
        text += `- Used ${m.metadata.usageCount} times, success rate: ${(m.metadata.successRate * 100).toFixed(0)}%`
        return text
      }).join("\n\n")

      return `# Relevant Past Knowledge

Based on your history, here are relevant memories:

${memoryTexts}`
    } catch (error) {
      return ""
    }
  }

  /**
   * Build knowledge section based on task
   */
  private async buildKnowledgeSection(task: string): Promise<string> {
    // This would connect to the knowledge graph
    // For now, return a placeholder
    
    return ""
  }

  /**
   * Build task-specific context
   */
  private async buildTaskSection(taskContext: string): Promise<string> {
    return `# Current Task Context

${taskContext}`
  }

  // ============================================================================
  // QUICK BUILDERS
  // ============================================================================

  /**
   * Build context for a simple query
   */
  async buildQueryContext(query: string): Promise<string> {
    const context = await this.buildContext({
      searchQuery: query,
      searchLimit: 3,
    })
    return context.fullContext
  }

  /**
   * Build context for code generation
   */
  async buildCodeContext(
    language: string,
    task: string,
    existingCode?: string
  ): Promise<string> {
    const context = await this.buildContext({
      task: `Write ${language} code for: ${task}`,
      taskContext: `
# Code Generation Context

## Language
${language}

## Task
${task}

${existingCode ? `## Existing Code
\`\`\`
${existingCode}
\`\`\`` : ""}

## Guidelines
- Follow the user's code style preferences
- Add comments for complex logic
- Handle edge cases
- Use modern language features`,
    })
    return context.fullContext
  }

  /**
   * Build context for debugging
   */
  async buildDebugContext(
    error: string,
    code: string,
    stackTrace?: string
  ): Promise<string> {
    const context = await this.buildContext({
      searchQuery: error,
      searchLimit: 5,
      taskContext: `
# Debug Context

## Error
${error}

${stackTrace ? `## Stack Trace
\`\`\`
${stackTrace}
\`\`\`\n` : ""}

## Code
\`\`\`
${code}
\`\`\``,
    })
    return context.fullContext
  }

  // ============================================================================
  // MEMORY ENRICHMENT
  // ============================================================================

  /**
   * Add context to a memory item before saving
   */
  async enrichMemory(
    item: Omit<MemoryItem, "metadata">,
    context: {
      task?: string
      success?: boolean
      userFeedback?: string
    }
  ): Promise<MemoryItem> {
    // Add task context as tags if provided
    if (context.task) {
      // Extract keywords from task
      const keywords = context.task
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5)
      
      item.tags = [...(item.tags || []), ...keywords]
    }

    // Create the full MemoryItem with metadata
    const enrichedItem: MemoryItem = {
      ...item,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "interaction",
        usageCount: 0,
        successRate: context.success ? 1 : 0.5,
      },
    }

    return enrichedItem
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultInstance: PromptContextBuilder | null = null

export function getPromptContextBuilder(
  memoryStorage?: MemoryStorage,
  embeddingService?: EmbeddingService
): PromptContextBuilder {
  if (!defaultInstance) {
    defaultInstance = new PromptContextBuilder(memoryStorage, embeddingService)
  }
  return defaultInstance
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default PromptContextBuilder
