/**
 * Semantic Learning - LLM-based Memory Extraction
 * 
 * Uses LLM to understand and extract information from conversations
 * instead of rigid regex patterns.
 */

import { Log } from "../../util/log"
import { Provider } from "../../provider/provider"
import { getStreamText } from "../../util/ai-compat"
import { z } from "zod"

const log = Log.create({ service: "memory.semantic-learning" })

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Information extracted from user message
 */
export const UserInformationSchema = z.object({
  hasInformation: z.boolean().describe("Whether the message contains user information"),
  name: z.string().optional().describe("User's name if mentioned"),
  preferences: z.array(z.object({
    category: z.enum(["code_style", "communication", "tool_usage", "workflow", "language"]),
    key: z.string(),
    value: z.any(),
    confidence: z.number().min(0).max(1),
  })).optional().describe("User preferences mentioned"),
  interests: z.array(z.string()).optional().describe("Topics or technologies user is interested in"),
  corrections: z.array(z.object({
    field: z.string(),
    oldValue: z.string(),
    newValue: z.string(),
  })).optional().describe("Corrections to previously stored information"),
})

export type UserInformation = z.infer<typeof UserInformationSchema>

// ============================================================================
// SEMANTIC LEARNING SERVICE
// ============================================================================

export class SemanticLearningService {
  private static model: Awaited<ReturnType<typeof Provider.getModel>> | null = null

  /**
   * Get or initialize the model for semantic learning
   */
  private static async getModel() {
    if (!this.model) {
      const defaultModel = await Provider.defaultModel()
      this.model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    }
    return this.model
  }

  /**
   * Extract user information from a message using LLM
   */
  static async extractUserInformation(
    message: string,
    context?: {
      currentName?: string
      recentMessages?: string[]
    }
  ): Promise<UserInformation> {
    try {
      const model = await this.getModel()
      const language = await Provider.getLanguage(model)
      const streamText = await getStreamText()

      const systemPrompt = `You are a memory extraction assistant. Your job is to analyze user messages and extract personal information, preferences, and corrections.

IMPORTANT RULES:
1. Only extract information that is EXPLICITLY stated by the user
2. Do NOT infer or guess information
3. Pay attention to corrections (e.g., "actually my name is X", "I prefer Y not Z")
4. Distinguish between questions and statements
5. Return hasInformation=false if the message is just a question or doesn't contain user info

EXAMPLES:

User: "My name is John"
→ hasInformation: true, name: "John"

User: "What is my name?"
→ hasInformation: false (this is a question, not providing info)

User: "Actually, my name is Alice, not Bob"
→ hasInformation: true, name: "Alice", corrections: [{field: "name", oldValue: "Bob", newValue: "Alice"}]

User: "I prefer TypeScript over JavaScript"
→ hasInformation: true, preferences: [{category: "language", key: "preferred_language", value: "TypeScript", confidence: 0.9}]

User: "I'm interested in React and Vue"
→ hasInformation: true, interests: ["React", "Vue"]

User: "Benim adım Akif"
→ hasInformation: true, name: "Akif"

User: "Aslında benim adım Mehmet, Akif değil"
→ hasInformation: true, name: "Mehmet", corrections: [{field: "name", oldValue: "Akif", newValue: "Mehmet"}]

${context?.currentName ? `\nCURRENT STORED NAME: ${context.currentName}` : ""}
${context?.recentMessages ? `\nRECENT CONVERSATION:\n${context.recentMessages.join("\n")}` : ""}

Now analyze this message:`

      const result = await streamText({
        model: language,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.1, // Low temperature for consistent extraction
        maxOutputTokens: 500,
      })

      let responseText = ""
      for await (const chunk of result.textStream) {
        responseText += chunk
      }

      // Try to parse as JSON
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                         responseText.match(/(\{[\s\S]*\})/)
        
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1])
          return UserInformationSchema.parse(parsed)
        }
      } catch (parseError) {
        log.warn("Failed to parse LLM response as JSON", { responseText, parseError })
      }

      // Fallback: no information extracted
      return {
        hasInformation: false,
      }

    } catch (error) {
      log.error("Failed to extract user information", { error })
      return {
        hasInformation: false,
      }
    }
  }

  /**
   * Analyze assistant response to verify what was learned
   */
  static async analyzeAssistantResponse(
    response: string,
    userMessage: string
  ): Promise<{
    confirmedName?: string
    acknowledgedPreferences?: string[]
  }> {
    try {
      const model = await this.getModel()
      const language = await Provider.getLanguage(model)
      const streamText = await getStreamText()

      const systemPrompt = `You are analyzing an AI assistant's response to determine what information it acknowledged or confirmed about the user.

TASK: Extract what the assistant confirmed or acknowledged.

EXAMPLES:

User: "My name is John"
Assistant: "Hello John! How can I help?"
→ confirmedName: "John"

User: "I prefer TypeScript"
Assistant: "Got it, I'll use TypeScript for examples."
→ acknowledgedPreferences: ["TypeScript"]

User: "What's my name?"
Assistant: "Your name is Alice."
→ confirmedName: "Alice"

Now analyze:`

      const result = await streamText({
        model: language,
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `User said: "${userMessage}"\nAssistant replied: "${response}"\n\nWhat did the assistant confirm?` 
          },
        ],
        temperature: 0.1,
        maxOutputTokens: 200,
      })

      let responseText = ""
      for await (const chunk of result.textStream) {
        responseText += chunk
      }

      // Simple extraction
      const nameMatch = responseText.match(/confirmedName[:\s]+"([^"]+)"/i)
      
      return {
        confirmedName: nameMatch ? nameMatch[1] : undefined,
        acknowledgedPreferences: [],
      }

    } catch (error) {
      log.error("Failed to analyze assistant response", { error })
      return {}
    }
  }

  /**
   * Quick check if message is a question (not providing information)
   */
  static isQuestion(message: string): boolean {
    const questionPatterns = [
      /^(what|who|where|when|why|how|which|whose|whom)/i,
      /\?$/,
      /^(ne|kim|nerede|neden|nasıl|hangi)/i, // Turkish
      /biliyor musun/i,
      /söyler misin/i,
    ]
    
    return questionPatterns.some(pattern => pattern.test(message.trim()))
  }
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default SemanticLearningService
