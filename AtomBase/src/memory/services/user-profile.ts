/**
 * User Personality Profile
 * 
 * Remembers user characteristics, preferences, and how
 * the user prefers to interact with the AI.
 */

import { z } from "zod"

// ============================================================================
// USER PERSONALITY SCHEMAS
// ============================================================================

/**
 * How the user addresses the AI
 */
export const UserToAIRelation = z.enum([
  "formal",         // Uses formal language
  "casual",         // Relaxed, friendly
  "kanka",          // Turkish "buddy" style
  "bro",            // Western "bro" style
  "sen",            // Turkish informal "you"
  "siz",            // Turkish formal "you"
  "intimate",       // Very close, informal
])

export type UserToAIRelation = z.infer<typeof UserToAIRelation>

/**
 * User's technical level
 */
export const TechLevel = z.enum([
  "beginner",       // New to coding
  "junior",         // Some experience
  "mid",            // Comfortable developer
  "senior",         // Very experienced
  "expert",         // Deep expertise
])

export type TechLevel = z.infer<typeof TechLevel>

/**
 * User's learning style
 */
export const LearningStyle = z.enum([
  "visual",         // Prefers visual explanations
  "text",           // Prefers text/documentation
  "hands_on",       // Prefers doing it themselves
  "questioning",   // Asks lots of questions
  "direct",         // Just give me the answer
  "balanced",       // Mix of approaches
])

export type LearningStyle = z.infer<typeof LearningStyle>

/**
 * User's work style
 */
export const WorkStyle = z.enum([
  "structured",     // Follows processes
  "flexible",       // Adapts as needed
  "experimental",   // Tries new things
  "efficient",      // Gets it done fast
  "thorough",       // Does it right
])

export type WorkStyle = z.infer<typeof WorkStyle>

/**
 * Communication preference
 */
export const CommunicationPreference = z.enum([
  "brief",          // Short, to the point
  "detailed",       // Want all the details
  "balanced",       // Depends on context
  "storytelling",   // Prefers narratives
])

export type CommunicationPreference = z.infer<typeof CommunicationPreference>

/**
 * Time preference
 */
export const TimePreference = z.enum([
  "morning",        // Works best in morning
  "afternoon",      // Afternoon person
  "night",          // Night owl
  "whenever",       // Flexible
])

export type TimePreference = z.infer<typeof TimePreference>

// ============================================================================
// USER PROFILE
// ============================================================================

/**
 * Complete user profile
 */
export const UserProfile = z.object({
  // Basic info (optional, privacy-respecting)
  name: z.string().optional(),
  preferredPronouns: z.string().optional(),
  
  // Relationship to AI
  userToAIRelation: UserToAIRelation.default("casual"),
  
  // Technical background
  techLevel: TechLevel.default("mid"),
  primaryLanguage: z.string().default("TypeScript"),
  languages: z.array(z.string()).default(["TypeScript", "JavaScript"]),
  
  // Learning & work
  learningStyle: LearningStyle.default("balanced"),
  workStyle: WorkStyle.default("flexible"),
  communication: CommunicationPreference.default("balanced"),
  
  // Preferences
  timePreference: TimePreference.default("whenever"),
  prefersExplanations: z.boolean().default(true),
  prefersCodeExamples: z.boolean().default(true),
  likesHumor: z.boolean().default(true),
  
  // Interests (auto-learned)
  interests: z.array(z.string()).default([]),
  recentlyWorkedOn: z.array(z.string()).default([]),
  
  // Statistics
  totalInteractions: z.number().default(0),
  lastActive: z.string().optional(),
  
  // Custom preferences (free-form)
  customPreferences: z.record(z.string(), z.any()).default({}),
})

export type UserProfile = z.infer<typeof UserProfile>

// ============================================================================
// USER PERSONALITY SERVICE
// ============================================================================

import os from "os"
import path from "path"
import fs from "fs/promises"

const USER_PROFILE_DIR = ".atomcli/personality"
const USER_PROFILE_FILE = "user-profile.json"

export class UserProfileService {
  private profilePath: string
  private profile: UserProfile | null = null

  constructor() {
    this.profilePath = path.join(os.homedir(), USER_PROFILE_DIR, USER_PROFILE_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<UserProfile> {
    try {
      await fs.mkdir(path.dirname(this.profilePath), { recursive: true })
      
      try {
        await fs.access(this.profilePath)
        await this.loadProfile()
      } catch {
        this.profile = this.createDefaultProfile()
        await this.saveProfile()
      }
      
      return this.profile!
    } catch (error) {
      console.error("Failed to initialize user profile:", error)
      return this.createDefaultProfile()
    }
  }

  /**
   * Force reload profile from disk (for testing or manual updates)
   */
  async forceReload(): Promise<void> {
    this.profile = null
    await this.initialize()
  }

  /**
   * Get profile, with optional force reload
   */
  async getProfile(forceRefresh: boolean = false): Promise<UserProfile> {
    if (forceRefresh || !this.profile) {
      await this.initialize()
    }
    return this.profile!
  }

  private createDefaultProfile(): UserProfile {
    return {
      userToAIRelation: "casual",
      techLevel: "mid",
      primaryLanguage: "TypeScript",
      languages: ["TypeScript", "JavaScript"],
      learningStyle: "balanced",
      workStyle: "flexible",
      communication: "balanced",
      timePreference: "whenever",
      prefersExplanations: true,
      prefersCodeExamples: true,
      likesHumor: true,
      interests: [],
      recentlyWorkedOn: [],
      totalInteractions: 0,
      customPreferences: {},
    }
  }

  // ============================================================================
  // PROFILE MANAGEMENT
  // ============================================================================

  async getProfile(): Promise<UserProfile> {
    if (!this.profile) {
      await this.initialize()
    }
    return this.profile!
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    if (!this.profile) {
      await this.initialize()
    }
    
    this.profile = {
      ...this.profile!,
      ...updates,
    }
    
    await this.saveProfile()
  }

  // ============================================================================
  // AUTO-LEARNING FROM BEHAVIOR
  // ============================================================================

  /**
   * Learn from user behavior
   */
  async learnFromBehavior(
    behavior: {
      type: "question_length" | "code_reading" | "error_handling" | "tool_usage" | "explanation_depth"
      data: Record<string, any>
    }
  ): Promise<void> {
    const p = await this.getProfile()
    
    switch (behavior.type) {
      case "question_length":
        if (behavior.data.questionLength < 20) {
          p.communication = "brief"
        } else if (behavior.data.questionLength > 200) {
          p.communication = "detailed"
        }
        break
        
      case "code_reading":
        if (behavior.data.commentsRequested) {
          p.prefersCodeExamples = true
        }
        break
        
      case "error_handling":
        if (behavior.data.askedForExplanation) {
          p.prefersExplanations = true
        }
        break
        
      case "tool_usage":
        // Track preferred tools
        if (behavior.data.tool) {
          if (!p.customPreferences.preferredTools) {
            p.customPreferences.preferredTools = {}
          }
          const tools = p.customPreferences.preferredTools as Record<string, number>
          tools[behavior.data.tool] = (tools[behavior.data.tool] || 0) + 1
        }
        break
        
      case "explanation_depth":
        if (behavior.data.wantsDeepDive) {
          p.learningStyle = "balanced"
        }
        break
    }
    
    p.lastActive = new Date().toISOString()
    await this.saveProfile()
  }

  /**
   * Learn user name if mentioned
   */
  async learnName(name: string): Promise<void> {
    await this.updateProfile({ name })
  }

  /**
   * Add an interest
   */
  async addInterest(interest: string): Promise<void> {
    const p = await this.getProfile()
    if (!p.interests.includes(interest)) {
      p.interests.push(interest)
      await this.saveProfile()
    }
  }

  /**
   * Track recently worked on
   */
  async addRecentWork(projectOrTopic: string): Promise<void> {
    const p = await this.getProfile()
    const recent = p.recentlyWorkedOn
    
    // Remove if exists (to move to front)
    const filtered = recent.filter(item => item !== projectOrTopic)
    
    // Add to front, keep max 5
    p.recentlyWorkedOn = [projectOrTopic, ...filtered].slice(0, 5)
    
    await this.saveProfile()
  }

  // ============================================================================
  // CONTEXT BUILDERS
  // ============================================================================

  /**
   * Get how to address the user
   */
  async getAddressStyle(): Promise<{
    pronoun: string
    verbForm: string
    greeting: string
  }> {
    const p = await this.getProfile()
    
    const styles: Record<UserToAIRelation, { pronoun: string; verbForm: string; greeting: string }> = {
      formal: { pronoun: "you", verbForm: "would", greeting: "May I help you with" },
      casual: { pronoun: "you", verbForm: "", greeting: "What can I help you with" },
      kanka: { pronoun: "sen", verbForm: "", greeting: "Naber, ne yapıyorsun" },
      bro: { pronoun: "you", verbForm: "", greeting: "Yo! What up" },
      sen: { pronoun: "sen", verbForm: "", greeting: "Selam" },
      siz: { pronoun: "siz", verbForm: "", greeting: "Merhaba" },
      intimate: { pronoun: "you", verbForm: "", greeting: "Hey there" },
    }
    
    return styles[p.userToAIRelation]
  }

  /**
   * Get explanation style based on profile
   */
  async getExplanationStyle(): Promise<{
    depth: "brief" | "medium" | "detailed"
    includeCode: boolean
    includeExamples: boolean
  }> {
    const p = await this.getProfile()
    
    return {
      depth: p.communication === "brief" ? "brief" 
           : p.communication === "detailed" ? "detailed" 
           : "medium",
      includeCode: p.prefersCodeExamples,
      includeExamples: p.prefersCodeExamples,
    }
  }

  /**
   * Build user context for prompts
   */
  async buildContext(): Promise<string> {
    const p = await this.getProfile()
    
    const parts: string[] = ["# User Context"]
    
    if (p.name) {
      parts.push(`- User's name: ${p.name}`)
    }
    
    parts.push(`- Tech level: ${p.techLevel}`)
    parts.push(`- Primary language: ${p.primaryLanguage}`)
    parts.push(`- Communication style: ${p.communication}`)
    parts.push(`- Learning style: ${p.learningStyle}`)
    parts.push(`- Work style: ${p.workStyle}`)
    
    if (p.interests.length > 0) {
      parts.push(`- Interests: ${p.interests.join(", ")}`)
    }
    
    if (p.recentlyWorkedOn.length > 0) {
      parts.push(`- Recently working on: ${p.recentlyWorkedOn.join(", ")}`)
    }
    
    if (p.totalInteractions > 0) {
      parts.push(`- Total interactions: ${p.totalInteractions}`)
    }
    
    parts.push("")
    parts.push("## Preferences")
    parts.push(`- Prefers explanations: ${p.prefersExplanations}`)
    parts.push(`- Prefers code examples: ${p.prefersCodeExamples}`)
    parts.push(`- Likes humor: ${p.likesHumor}`)
    
    return parts.join("\n")
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  async incrementInteractions(): Promise<void> {
    const p = await this.getProfile()
    p.totalInteractions++
    p.lastActive = new Date().toISOString()
    await this.saveProfile()
  }

  async getStats(): Promise<{
    totalInteractions: number
    techLevel: string
    interests: string[]
    recentlyWorkedOn: string[]
  }> {
    const p = await this.getProfile()
    return {
      totalInteractions: p.totalInteractions,
      techLevel: p.techLevel,
      interests: p.interests,
      recentlyWorkedOn: p.recentlyWorkedOn,
    }
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  private async loadProfile(): Promise<void> {
    const content = await fs.readFile(this.profilePath, "utf-8")
    this.profile = JSON.parse(content)
  }

  private async saveProfile(): Promise<void> {
    await fs.writeFile(this.profilePath, JSON.stringify(this.profile, null, 2))
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultInstance: UserProfileService | null = null

export function getUserProfile(): UserProfileService {
  if (!defaultInstance) {
    defaultInstance = new UserProfileService()
  }
  return defaultInstance
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default UserProfileService
