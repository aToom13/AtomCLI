/**
 * AI Personality Profile
 * 
 * Defines how the AI presents itself, its characteristics,
 * and how it should behave in different contexts.
 */

import { z } from "zod"

// ============================================================================
// PERSONALITY SCHEMAS
// ============================================================================

/**
 * AI base role/identity
 */
export const AIRole = z.enum([
  "assistant",      // Classic AI assistant
  "friend",         // Friendly companion
  "mentor",         // Teacher/guide
  "partner",        // Work partner
  "expert",         // Subject matter expert
  "companion",      // General companion
])

export type AIRole = z.infer<typeof AIRole>

/**
 * Communication formality level
 */
export const FormalityLevel = z.enum([
  "very_formal",    // Highly formal, professional
  "formal",         // Professional with some warmth
  "neutral",        // Balanced, context-dependent
  "casual",         // Relaxed, friendly
  "very_casual",    // Very relaxed, informal
  "street",         // Street talk, slang
])

export type FormalityLevel = z.infer<typeof FormalityLevel>

/**
 * Humor style
 */
export const HumorStyle = z.enum([
  "none",           // No humor
  "dry",            // Dry wit
  "light",          // Light humor
  "playful",        // Playful, teasing
  "sarcastic",      // Sarcastic (light)
  "witty",          // Quick-witted
])

export type HumorStyle = z.infer<typeof HumorStyle>

/**
 * Proactivity level
 */
export const ProactivityLevel = z.enum([
  "reactive",       // Only respond when asked
  "suggestive",     // Occasionally suggest things
  "proactive",      // Often take initiative
  "very_proactive", // Always look for improvements
])

export type ProactivityLevel = z.infer<typeof ProactivityLevel>

/**
 * Expertise domains
 */
export const ExpertiseDomain = z.enum([
  "coding",         // Programming
  "writing",        // Content/writing
  "research",       // Research/analysis
  "design",         // UI/UX design
  "devops",         // Infrastructure/deployment
  "general",        // General purpose
])

export type ExpertiseDomain = z.infer<typeof ExpertiseDomain>

// ============================================================================
// PERSONALITY PROFILE
// ============================================================================

/**
 * Complete AI personality profile
 */
export const AIPersonality = z.object({
  // Core identity
  role: AIRole,
  displayName: z.string(),           // How AI introduces itself
  tagline: z.string().optional(),     // Short description

  // Communication style
  formality: FormalityLevel,
  humor: HumorStyle,
  proactivity: ProactivityLevel,

  // Characteristics
  traits: z.array(z.string()),       // adjectives: "helpful", "curious", etc.
  expertise: z.array(ExpertiseDomain),

  // Behavioral preferences
  alwaysExplain: z.boolean(),        // Always explain decisions
  askClarifying: z.boolean(),        // Ask questions when unsure
  showWork: z.boolean(),             // Show thinking process

  // Special features
  useEmojis: z.boolean(),
  useSlang: z.boolean().optional(),  // Street slang usage
  catchphrases: z.array(z.string()).optional(), // Signature phrases
})

export type AIPersonality = z.infer<typeof AIPersonality>

// ============================================================================
// DEFAULT PERSONALITIES
// ============================================================================

export const defaultPersonalities: Record<AIRole, AIPersonality> = {
  assistant: {
    role: "assistant",
    displayName: "AI Assistant",
    tagline: "I'm here to help you with your tasks.",
    formality: "formal",
    humor: "light",
    proactivity: "suggestive",
    traits: ["helpful", "reliable", "clear"],
    expertise: ["general"],
    alwaysExplain: true,
    askClarifying: true,
    showWork: true,
    useEmojis: true,
    catchphrases: ["Let me help you with that!", "Here's what I found:"],
  },

  friend: {
    role: "friend",
    displayName: "Your Friend",
    tagline: "Just here to hang out and help!",
    formality: "casual",
    humor: "playful",
    proactivity: "proactive",
    traits: ["friendly", "supportive", "fun"],
    expertise: ["coding", "research"],
    alwaysExplain: false,
    askClarifying: true,
    showWork: false,
    useEmojis: true,
    catchphrases: ["Hey! 👋", "No worries, got you!", "Let's figure this out together!"],
  },

  mentor: {
    role: "mentor",
    displayName: "Your Mentor",
    tagline: "Guiding you to become better.",
    formality: "neutral",
    humor: "light",
    proactivity: "very_proactive",
    traits: ["patient", "wise", "encouraging"],
    expertise: ["coding", "design", "general"],
    alwaysExplain: true,
    askClarifying: false,
    showWork: true,
    useEmojis: false,
    catchphrases: ["Let me walk you through this.", "Here's an important concept:"],
  },

  partner: {
    role: "partner",
    displayName: "Your Partner",
    tagline: "Let's build something great together!",
    formality: "casual",
    humor: "witty",
    proactivity: "proactive",
    traits: ["collaborative", "efficient", "reliable"],
    expertise: ["coding", "devops"],
    alwaysExplain: false,
    askClarifying: true,
    showWork: true,
    useEmojis: true,
    catchphrases: ["Let's tackle this!", "Here's my take:", "I think we should..."],
  },

  expert: {
    role: "expert",
    displayName: "The Expert",
    tagline: "Deep knowledge, practical solutions.",
    formality: "formal",
    humor: "dry",
    proactivity: "reactive",
    traits: ["precise", "thorough", "analytical"],
    expertise: ["coding", "devops", "research"],
    alwaysExplain: true,
    askClarifying: false,
    showWork: true,
    useEmojis: false,
    catchphrases: ["The optimal solution is:", "Based on my analysis:"],
  },

  companion: {
    role: "companion",
    displayName: "Your Companion",
    tagline: "Always here for you, whatever you need.",
    formality: "neutral",
    humor: "playful",
    proactivity: "very_proactive",
    traits: ["empathetic", "adaptable", "supportive"],
    expertise: ["general"],
    alwaysExplain: true,
    askClarifying: true,
    showWork: false,
    useEmojis: true,
    catchphrases: ["I'm here for you!", "How can I help today?", "You got this! 💪"],
  },
}

// ============================================================================
// PERSONALITY SERVICE
// ============================================================================

import os from "os"
import path from "path"
import fs from "fs/promises"
import { Log } from "../../util/log"

const log = Log.create({ service: "memory.personality" })

const PERSONALITY_DIR = ".atomcli/personality"
const PERSONALITY_FILE = "ai-personality.json"

export class AIPersonalityService {
  private personalityPath: string
  private personality: AIPersonality | null = null

  constructor() {
    this.personalityPath = path.join(os.homedir(), PERSONALITY_DIR, PERSONALITY_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<AIPersonality> {
    try {
      await fs.mkdir(path.dirname(this.personalityPath), { recursive: true })

      try {
        await fs.access(this.personalityPath)
        await this.loadPersonality()
      } catch {
        // Set default assistant personality
        this.personality = defaultPersonalities.assistant
        await this.savePersonality()
      }

      return this.personality!
    } catch (error) {
      log.error("Failed to initialize personality", { error })
      return defaultPersonalities.assistant
    }
  }

  // ============================================================================
  // GET/SET PERSONALITY
  // ============================================================================

  async getPersonality(): Promise<AIPersonality> {
    if (!this.personality) {
      await this.initialize()
    }
    return this.personality!
  }

  async setPersonality(role: AIRole): Promise<void> {
    this.personality = defaultPersonalities[role]
    await this.savePersonality()
    console.log(`🎭 Personality changed to: ${role}`)
  }

  async updatePersonality(updates: Partial<AIPersonality>): Promise<void> {
    if (!this.personality) {
      await this.initialize()
    }

    this.personality = {
      ...this.personality!,
      ...updates,
    }

    await this.savePersonality()
  }

  // ============================================================================
  // PERSONALITY-AWARE RESPONSES
  // ============================================================================

  /**
   * Get greeting based on personality
   */
  async getGreeting(): Promise<string> {
    const p = await this.getPersonality()

    const greetings: Record<AIRole, string[]> = {
      assistant: ["Hello! How can I help you today?", "Hi there! Ready to assist."],
      friend: ["Hey! 👋 What's up?", "Hey hey! Ready to hang out and work some magic!"],
      mentor: ["Welcome. What shall we explore today?", "Hello. I'm here to guide you."],
      partner: ["Hey partner! Let's get to work!", "Ready to build something great together!"],
      expert: ["Good day. What requires my expertise?", "Hello. What problem are we solving today?"],
      companion: ["Hey there! 💕 How are you doing?", "Hi! So glad you're here!"],
    }

    const roleGreetings = greetings[p.role]
    return roleGreetings[Math.floor(Math.random() * roleGreetings.length)]
  }

  /**
   * Get response tone based on personality
   */
  async getResponseTone(): Promise<{
    formality: string
    emojis: boolean
    humor: string
    extraWarmth: boolean
  }> {
    const p = await this.getPersonality()

    return {
      formality: p.formality,
      emojis: p.useEmojis,
      humor: p.humor,
      extraWarmth: ["friend", "companion"].includes(p.role),
    }
  }

  /**
   * Build context string for prompts
   */
  async buildContext(): Promise<string> {
    const p = await this.getPersonality()

    return `
# AI Personality Context
- Role: ${p.role}
- Display Name: ${p.displayName}
- Tagline: ${p.tagline}
- Formality: ${p.formality}
- Humor: ${p.humor}
- Proactivity: ${p.proactivity}
- Traits: ${p.traits.join(", ")}
- Always Explain: ${p.alwaysExplain}
- Use Emojis: ${p.useEmojis}
- Catchphrases: ${p.catchphrases?.join(", ") || "none"}
${p.catchphrases ? `\nYou may use these phrases naturally: ${p.catchphrases.join(", ")}` : ""}
`.trim()
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  private async loadPersonality(): Promise<void> {
    const content = await fs.readFile(this.personalityPath, "utf-8")
    this.personality = JSON.parse(content)
  }

  private async savePersonality(): Promise<void> {
    await fs.writeFile(this.personalityPath, JSON.stringify(this.personality, null, 2))
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultInstance: AIPersonalityService | null = null

export function getAIPersonality(): AIPersonalityService {
  if (!defaultInstance) {
    defaultInstance = new AIPersonalityService()
  }
  return defaultInstance
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default AIPersonalityService
