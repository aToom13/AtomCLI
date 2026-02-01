/**
 * Communication Style Manager
 * 
 * Manages how the AI communicates with the user based on
 * learned preferences and personality compatibility.
 */

import { z } from "zod"

// ============================================================================
// COMMUNICATION SCHEMAS
// ============================================================================

/**
 * Overall communication mode
 */
export const CommunicationMode = z.enum([
  "professional",   // Business-like
  "friendly",       // Warm and approachable
  "humorous",       // Fun and playful
  "technical",      // Focus on facts
  "supportive",     // Encouraging and caring
  "adaptive",       // Adapts to user
])

export type CommunicationMode = z.infer<typeof CommunicationMode>

/**
 * Response length preference
 */
export const ResponseLength = z.enum([
  "very_short",     // One-liners
  "short",          // Brief
  "medium",         // Balanced
  "long",           // Detailed
  "very_long",      // Comprehensive
])

export type ResponseLength = z.infer<typeof ResponseLength>

/**
 * Vocabulary preference
 */
export const VocabularyStyle = z.enum([
  "simple",         // Easy to understand
  "technical",      // Industry terms
  "casual",         // Everyday language
  "academic",       // Formal/academic
  "mixed",          // Context-dependent
])

export type VocabularyStyle = z.infer<typeof VocabularyStyle>

/**
 * Emoji usage preference
 */
export const EmojiPreference = z.enum([
  "none",           // No emojis
  "minimal",        // Rarely
  "moderate",       // Sometimes
  "frequent",       // Often
  "abundant",       // Lots of emojis
])

export type EmojiPreference = z.infer<typeof EmojiPreference>

// ============================================================================
// COMMUNICATION PROFILE
// ============================================================================

/**
 * Complete communication profile
 */
export const CommunicationProfile = z.object({
  // Core settings
  mode: CommunicationMode.default("adaptive"),
  length: ResponseLength.default("medium"),
  vocabulary: VocabularyStyle.default("mixed"),
  emojiUsage: EmojiPreference.default("moderate"),
  
  // Phrasing preferences
  useContractions: z.boolean().default(true),
  useFirstPerson: z.boolean().default(true),
  useQuestions: z.boolean().default(true),
  
  // Special
  useSlang: z.boolean().default(false),
  useTurkish: z.boolean().default(false),  // For Turkish users
  useGenZSlang: z.boolean().default(false),
  
  // Personalized phrases (learned from user)
  likedPhrases: z.array(z.string()).default([]),
  dislikedPhrases: z.array(z.string()).default([]),
  
  // Context modifiers
  formalGreetings: z.array(z.string()).default([
    "Hello", "Hi there", "Good day"
  ]),
  casualGreetings: z.array(z.string()).default([
    "Hey", "Yo", "Hi", "Hey hey"
  ]),
  turkishCasualGreetings: z.array(z.string()).default([
    "Selam", "Naber", "Merhaba", "Hey"
  ]),
})

export type CommunicationProfile = z.infer<typeof CommunicationProfile>

// ============================================================================
// COMMUNICATION SERVICE
// ============================================================================

import os from "os"
import path from "path"
import fs from "fs/promises"

const COMM_DIR = ".atomcli/personality"
const COMM_FILE = "communication.json"

export class CommunicationService {
  private commPath: string
  private comm: CommunicationProfile | null = null

  constructor() {
    this.commPath = path.join(os.homedir(), COMM_DIR, COMM_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<CommunicationProfile> {
    try {
      await fs.mkdir(path.dirname(this.commPath), { recursive: true })
      
      try {
        await fs.access(this.commPath)
        await this.loadComm()
      } catch {
        this.comm = this.createDefaultComm()
        await this.saveComm()
      }
      
      return this.comm!
    } catch (error) {
      console.error("Failed to initialize communication:", error)
      return this.createDefaultComm()
    }
  }

  private createDefaultComm(): CommunicationProfile {
    return {
      mode: "adaptive",
      length: "medium",
      vocabulary: "mixed",
      emojiUsage: "moderate",
      useContractions: true,
      useFirstPerson: true,
      useQuestions: true,
      useSlang: false,
      useTurkish: false,
      useGenZSlang: false,
      likedPhrases: [],
      dislikedPhrases: [],
      formalGreetings: ["Hello", "Hi there", "Good day"],
      casualGreetings: ["Hey", "Yo", "Hi", "Hey hey"],
      turkishCasualGreetings: ["Selam", "Naber", "Merhaba", "Hey"],
    }
  }

  // ============================================================================
  // PROFILE MANAGEMENT
  // ============================================================================

  async getProfile(): Promise<CommunicationProfile> {
    if (!this.comm) {
      await this.initialize()
    }
    return this.comm!
  }

  async updateProfile(updates: Partial<CommunicationProfile>): Promise<void> {
    if (!this.comm) {
      await this.initialize()
    }
    
    this.comm = {
      ...this.comm!,
      ...updates,
    }
    
    await this.saveComm()
  }

  // ============================================================================
  // STYLE MODIFIERS
  // ============================================================================

  /**
   * Get current communication style based on mode
   */
  async getCurrentStyle(): Promise<{
    tone: string
    emojiDensity: number
    questionFrequency: number
    formalLevel: number  // 0-1
  }> {
    const c = await this.getProfile()
    
    const styles: Record<CommunicationMode, { tone: string; emojiDensity: number; questionFrequency: number; formalLevel: number }> = {
      professional: {
        tone: "professional",
        emojiDensity: 0.1,
        questionFrequency: 0.3,
        formalLevel: 0.9,
      },
      friendly: {
        tone: "warm",
        emojiDensity: 0.5,
        questionFrequency: 0.5,
        formalLevel: 0.4,
      },
      humorous: {
        tone: "playful",
        emojiDensity: 0.7,
        questionFrequency: 0.4,
        formalLevel: 0.3,
      },
      technical: {
        tone: "precise",
        emojiDensity: 0.0,
        questionFrequency: 0.2,
        formalLevel: 0.7,
      },
      supportive: {
        tone: "caring",
        emojiDensity: 0.6,
        questionFrequency: 0.6,
        formalLevel: 0.4,
      },
      adaptive: {
        tone: "balanced",
        emojiDensity: 0.4,
        questionFrequency: 0.4,
        formalLevel: 0.5,
      },
    }
    
    return styles[c.mode]
  }

  /**
   * Get appropriate greeting
   */
  async getGreeting(
    options: {
      timeOfDay?: "morning" | "afternoon" | "evening" | "night"
      formality?: "formal" | "casual" | "turkish_casual"
    } = {}
  ): Promise<string> {
    const c = await this.getProfile()
    const { formality = "casual" } = options
    
    let greetings: string[] = []
    
    if (formality === "formal") {
      greetings = c.formalGreetings
    } else if (formality === "turkish_casual") {
      greetings = c.turkishCasualGreetings
    } else {
      greetings = c.casualGreetings
    }
    
    // Add time-based
    const timeGreetings: Record<string, string[]> = {
      morning: ["Good morning", "Morning", "Günaydın", "Sabahın ışığıyla!"],
      afternoon: ["Good afternoon", "Afternoon", "Tünaydın"],
      evening: ["Good evening", "Evening", "İyi akşamlar"],
      night: ["Good night", "Night owl!", "Gece çalışması mı?"],
    }
    
    if (options.timeOfDay && timeGreetings[options.timeOfDay]) {
      greetings = [...greetings, ...timeGreetings[options.timeOfDay]]
    }
    
    return greetings[Math.floor(Math.random() * greetings.length)]
  }

  /**
   * Get sign-off based on style
   */
  async getSignOff(): Promise<string> {
    const c = await this.getProfile()
    
    const signoffs: Record<CommunicationMode, string[]> = {
      professional: ["Best regards", "Regards", "Sincerely"],
      friendly: ["Cheers", "Take care", "Talk soon"],
      humorous: ["Stay awesome!", "Catch you later!", "Bye for now! 👋"],
      technical: ["Let me know if you need anything else.", "Happy coding."],
      supportive: ["You've got this!", "I'm here if you need me! 💜"],
      adaptive: ["Take care!", "See you next time!", "Bye!"],
    }
    
    const modeSignoffs = signoffs[c.mode]
    return modeSignoffs[Math.floor(Math.random() * modeSignoffs.length)]
  }

  // ============================================================================
  // TEXT TRANSFORMATION
  // ============================================================================

  /**
   * Transform text to match communication style
   */
  async transformText(text: string): Promise<string> {
    const c = await this.getProfile()
    
    let transformed = text
    
    // Contractions
    if (c.useContractions) {
      transformed = transformed
        .replace(/\b(would not)\b/g, "won't")
        .replace(/\b(could not)\b/g, "can't")
        .replace(/\b(I am)\b/g, "I'm")
        .replace(/\b(you are)\b/g, "you're")
    }
    
    // Emoji injection based on preference
    const emojiDensity = {
      none: 0,
      minimal: 0.05,
      moderate: 0.15,
      frequent: 0.3,
      abundant: 0.5,
    }[c.emojiUsage] || 0.15
    
    // Only add emojis if density > 0
    if (emojiDensity > 0 && !transformed.includes("```")) {
      // Simple emoji injection for key words
      const emojiMap: Record<string, string> = {
        "great": "🎉",
        "good": "✨",
        "nice": "🙌",
        "perfect": "💯",
        "awesome": "🔥",
        "amazing": "🤩",
        "help": "🙌",
        "thanks": "🙏",
        "thank": "🙏",
        "sorry": "😔",
        "error": "🐛",
        "fix": "🔧",
        "code": "💻",
        "test": "🧪",
        "build": "🚀",
        "deploy": "📦",
        "learn": "📚",
        "question": "❓",
        "idea": "💡",
        "work": "⚡",
        "done": "✅",
        "yes": "👍",
        "no": "👎",
      }
      
      // Randomly add emojis based on density
      for (const [word, emoji] of Object.entries(emojiMap)) {
        if (Math.random() < emojiDensity && transformed.includes(word)) {
          transformed = transformed.replace(new RegExp(`\\b${word}\\b`, "i"), `${word} ${emoji}`)
        }
      }
    }
    
    return transformed
  }

  /**
   * Adjust response length
   */
  async adjustLength(
    text: string,
    targetLength?: ResponseLength
  ): Promise<string> {
    const c = await this.getProfile()
    const length = targetLength || c.length
    
    const wordCount = text.split(/\s+/).length
    
    const targets: Record<ResponseLength, number> = {
      very_short: 10,
      short: 25,
      medium: 50,
      long: 100,
      very_long: 200,
    }
    
    const target = targets[length]
    
    // Simple adjustment - truncate or expand (very basic)
    const words = text.split(/\s+/)
    
    if (wordCount > target * 1.5) {
      // Truncate
      return words.slice(0, target).join(" ") + "..."
    } else if (wordCount < target * 0.5 && wordCount < target) {
      // Could expand, but for now just return as is
      return text
    }
    
    return text
  }

  // ============================================================================
  // CONTEXT BUILDING
  // ============================================================================

  /**
   * Build communication context for prompts
   */
  async buildContext(): Promise<string> {
    const c = await this.getProfile()
    
    return `
# Communication Style Context
- Mode: ${c.mode}
- Response length: ${c.length}
- Vocabulary: ${c.vocabulary}
- Emoji usage: ${c.emojiUsage}
- Use contractions: ${c.useContractions}
- Use first person: ${c.useFirstPerson}
- Use questions: ${c.useQuestions}
- Use slang: ${c.useSlang}
- Use Turkish: ${c.useTurkish}
`.trim()
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  private async loadComm(): Promise<void> {
    const content = await fs.readFile(this.commPath, "utf-8")
    this.comm = JSON.parse(content)
  }

  private async saveComm(): Promise<void> {
    await fs.writeFile(this.commPath, JSON.stringify(this.comm, null, 2))
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultInstance: CommunicationService | null = null

export function getCommunication(): CommunicationService {
  if (!defaultInstance) {
    defaultInstance = new CommunicationService()
  }
  return defaultInstance
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default CommunicationService
