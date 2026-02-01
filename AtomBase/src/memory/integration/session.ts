/**
 * Memory Integration for Session System
 * 
 * Integrates memory services into the agent session lifecycle.
 * Automatically learns from user interactions and provides context.
 */

import { getUserProfile } from "../services/user-profile"
import { getPreferencesService } from "../services/preferences"
import { SemanticLearningService } from "./semantic-learning"
import { Log } from "../../util/log"

const log = Log.create({ service: "memory.integration.session" })

// ============================================================================
// SESSION MEMORY INTEGRATION
// ============================================================================

export class SessionMemoryIntegration {
  private static initialized = false
  private static userProfile = getUserProfile()
  private static preferences = getPreferencesService()

  /**
   * Initialize memory system for a new session
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Initialize user profile
      await this.userProfile.initialize()
      
      // Initialize preferences
      await this.preferences.initialize()
      
      // Increment interaction count
      await this.userProfile.incrementInteractions()
      
      this.initialized = true
      log.info("Memory system initialized for session")
    } catch (error) {
      log.error("Failed to initialize memory system", { error })
      // Don't throw - memory is optional
    }
  }

  /**
   * Get user context for system prompt
   */
  static async getUserContext(): Promise<string> {
    try {
      await this.initialize()
      
      const profile = await this.userProfile.getProfile()
      const stats = await this.preferences.getStats()
      
      const parts: string[] = []
      
      // User name if available
      if (profile.name) {
        parts.push(`# User Information`)
        parts.push(`- Name: ${profile.name}`)
        parts.push(``)
      }
      
      // Technical profile
      parts.push(`# User Profile`)
      parts.push(`- Tech Level: ${profile.techLevel}`)
      parts.push(`- Primary Language: ${profile.primaryLanguage}`)
      parts.push(`- Communication Style: ${profile.communication}`)
      parts.push(`- Learning Style: ${profile.learningStyle}`)
      parts.push(`- Work Style: ${profile.workStyle}`)
      
      // Preferences
      if (stats.total > 0) {
        parts.push(``)
        parts.push(`# Learned Preferences`)
        parts.push(`- Total preferences learned: ${stats.total}`)
        parts.push(`- High confidence preferences: ${stats.highConfidenceCount}`)
      }
      
      // Recent work
      if (profile.recentlyWorkedOn.length > 0) {
        parts.push(``)
        parts.push(`# Recent Work`)
        parts.push(`- ${profile.recentlyWorkedOn.join(", ")}`)
      }
      
      // Interests
      if (profile.interests.length > 0) {
        parts.push(``)
        parts.push(`# Interests`)
        parts.push(`- ${profile.interests.join(", ")}`)
      }
      
      // Statistics
      parts.push(``)
      parts.push(`# Session Statistics`)
      parts.push(`- Total interactions: ${profile.totalInteractions}`)
      if (profile.lastActive) {
        parts.push(`- Last active: ${profile.lastActive}`)
      }
      
      return parts.join("\n")
    } catch (error) {
      log.error("Failed to get user context", { error })
      return ""
    }
  }

  /**
   * Learn from user message using semantic analysis
   */
  static async learnFromMessage(message: string): Promise<void> {
    try {
      await this.initialize()
      
      // Quick check: Skip if it's just a question
      if (SemanticLearningService.isQuestion(message)) {
        log.debug("Skipping question message", { message: message.slice(0, 50) })
        return
      }
      
      // Get current context
      const profile = await this.userProfile.getProfile()
      
      // Use LLM to extract information
      const extracted = await SemanticLearningService.extractUserInformation(message, {
        currentName: profile.name,
      })
      
      if (!extracted.hasInformation) {
        log.debug("No information extracted from message")
        return
      }
      
      // Process extracted information
      if (extracted.name) {
        await this.userProfile.learnName(extracted.name)
        log.info("Learned user name (semantic)", { name: extracted.name })
      }
      
      if (extracted.preferences) {
        for (const pref of extracted.preferences) {
          await this.preferences.learn(
            pref.category,
            pref.key,
            pref.value,
            message.slice(0, 100)
          )
          log.info("Learned preference (semantic)", { 
            category: pref.category, 
            key: pref.key,
            confidence: pref.confidence 
          })
        }
      }
      
      if (extracted.interests) {
        for (const interest of extracted.interests) {
          await this.userProfile.addInterest(interest)
          log.info("Learned interest (semantic)", { interest })
        }
      }
      
      if (extracted.corrections) {
        for (const correction of extracted.corrections) {
          if (correction.field === "name") {
            await this.userProfile.learnName(correction.newValue)
            log.info("Corrected name (semantic)", { 
              from: correction.oldValue, 
              to: correction.newValue 
            })
          }
        }
      }
      
      // Learn from message length (communication preference)
      await this.userProfile.learnFromBehavior({
        type: "question_length",
        data: { questionLength: message.length },
      })
      
    } catch (error) {
      log.error("Failed to learn from message", { error })
    }
  }

  /**
   * Learn from assistant response using semantic analysis
   */
  static async learnFromResponse(response: string, userMessage?: string): Promise<void> {
    try {
      await this.initialize()
      
      if (!userMessage) {
        log.debug("No user message context for response analysis")
        return
      }
      
      // Analyze what the assistant confirmed
      const analysis = await SemanticLearningService.analyzeAssistantResponse(
        response,
        userMessage
      )
      
      if (analysis.confirmedName) {
        await this.userProfile.learnName(analysis.confirmedName)
        log.info("Confirmed name from AI response (semantic)", { 
          name: analysis.confirmedName 
        })
      }
      
      if (analysis.acknowledgedPreferences && analysis.acknowledgedPreferences.length > 0) {
        log.info("AI acknowledged preferences (semantic)", { 
          preferences: analysis.acknowledgedPreferences 
        })
      }
      
    } catch (error) {
      log.error("Failed to learn from response", { error })
    }
  }

  /**
   * Process a conversation turn (user message + assistant response)
   * This should be called after each complete interaction
   */
  static async processConversationTurn(userMessage: string, assistantResponse: string): Promise<void> {
    try {
      await this.initialize()
      
      // Learn from user message
      await this.learnFromMessage(userMessage)
      
      // Learn from assistant response
      await this.learnFromResponse(assistantResponse)
      
      // Increment interaction count
      await this.userProfile.incrementInteractions()
      
    } catch (error) {
      log.error("Failed to process conversation turn", { error })
    }
  }

  /**
   * Learn from code preferences
   */
  static async learnCodeStyle(code: string, language: string): Promise<void> {
    try {
      await this.initialize()
      
      // Detect indent style
      const hasSpaces = /^\s{2,}/m.test(code)
      const hasTabs = /^\t/m.test(code)
      
      if (hasSpaces) {
        const match = code.match(/^(\s+)/m)
        if (match) {
          const indentSize = match[1].length
          await this.preferences.learn("code_style", "indent_style", "space", code.slice(0, 100))
          await this.preferences.learn("code_style", "indent_size", indentSize, code.slice(0, 100))
        }
      } else if (hasTabs) {
        await this.preferences.learn("code_style", "indent_style", "tab", code.slice(0, 100))
      }
      
      // Detect quote style (for JS/TS)
      if (["javascript", "typescript", "jsx", "tsx"].includes(language)) {
        const singleQuotes = (code.match(/'/g) || []).length
        const doubleQuotes = (code.match(/"/g) || []).length
        
        if (singleQuotes > doubleQuotes * 2) {
          await this.preferences.learn("code_style", "quote_style", "single", code.slice(0, 100))
        } else if (doubleQuotes > singleQuotes * 2) {
          await this.preferences.learn("code_style", "quote_style", "double", code.slice(0, 100))
        }
        
        // Detect semicolon preference
        const lines = code.split("\n").filter(l => l.trim())
        const withSemicolon = lines.filter(l => l.trim().endsWith(";")).length
        const withoutSemicolon = lines.filter(l => !l.trim().endsWith(";") && !l.trim().endsWith("{") && !l.trim().endsWith("}")).length
        
        if (withSemicolon > withoutSemicolon * 2) {
          await this.preferences.learn("code_style", "semicolons", true, code.slice(0, 100))
        } else if (withoutSemicolon > withSemicolon * 2) {
          await this.preferences.learn("code_style", "semicolons", false, code.slice(0, 100))
        }
      }
      
    } catch (error) {
      log.error("Failed to learn code style", { error })
    }
  }

  /**
   * Track project work
   */
  static async trackProject(projectName: string): Promise<void> {
    try {
      await this.initialize()
      await this.userProfile.addRecentWork(projectName)
    } catch (error) {
      log.error("Failed to track project", { error })
    }
  }

  /**
   * Add interest
   */
  static async addInterest(interest: string): Promise<void> {
    try {
      await this.initialize()
      await this.userProfile.addInterest(interest)
    } catch (error) {
      log.error("Failed to add interest", { error })
    }
  }

  /**
   * Get style guide for code generation
   */
  static async getStyleGuide(): Promise<any> {
    try {
      await this.initialize()
      return await this.preferences.generateStyleGuide()
    } catch (error) {
      log.error("Failed to get style guide", { error })
      return null
    }
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default SessionMemoryIntegration
