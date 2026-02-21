/**
 * Session Persistence Service
 * 
 * Maintains session state across sessions.
 * Stores conversation summaries, task states, and learned items.
 */

import os from "os"
import path from "path"
import fs from "fs/promises"

import type {
  SessionState,
  SessionSummary,
  PersistedTask,
  MemoryItem,
} from "../types"

import { Log } from "@/util/util/log"

const log = Log.create({ service: "memory.session" })

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSIONS_DIR = ".atomcli/sessions"
const SESSIONS_FILE = "sessions.json"
const CURRENT_SESSION_FILE = "current.json"

// ============================================================================
// SESSION SERVICE
// ============================================================================

export class SessionService {
  private sessionsDir: string
  private sessionsPath: string
  private currentSessionPath: string
  private currentSession: SessionState | null = null
  private initialized = false

  constructor(userId: string = "default") {
    this.sessionsDir = path.join(os.homedir(), SESSIONS_DIR, userId)
    this.sessionsPath = path.join(this.sessionsDir, SESSIONS_FILE)
    this.currentSessionPath = path.join(this.sessionsDir, CURRENT_SESSION_FILE)
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await fs.mkdir(this.sessionsDir, { recursive: true })

      // Load current session if exists
      try {
        const content = await fs.readFile(this.currentSessionPath, "utf-8")
        this.currentSession = JSON.parse(content)
        log.info("Loaded current session", { id: this.currentSession?.id })
      } catch {
        log.info("No existing session found")
      }

      this.initialized = true
      log.info("Session service initialized", { path: this.sessionsDir })
    } catch (error) {
      log.error("Failed to initialize session service", { error })
      throw error
    }
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  /**
   * Start a new session
   */
  async start(projectPath?: string): Promise<SessionState> {
    await this.initialize()

    // Save previous session if exists
    if (this.currentSession) {
      await this.archiveSession(this.currentSession)
    }

    const now = new Date().toISOString()

    this.currentSession = {
      id: `session_${Date.now()}`,
      userId: os.userInfo().username || "default",
      projectPath,
      startedAt: now,
      lastActive: now,
      summary: "",
      tasks: [],
      learnedItems: [],
      preferences: [],
      conversationSummary: "",
    }

    await this.saveCurrentSession()
    log.info("Started new session", { id: this.currentSession.id })

    return this.currentSession
  }

  /**
   * Get current session
   */
  async getCurrent(): Promise<SessionState | null> {
    await this.initialize()
    return this.currentSession
  }

  /**
   * Update current session
   */
  async update(updates: Partial<SessionState>): Promise<void> {
    await this.initialize()

    if (!this.currentSession) {
      throw new Error("No active session")
    }

    this.currentSession = {
      ...this.currentSession,
      ...updates,
      lastActive: new Date().toISOString(),
    }

    await this.saveCurrentSession()
  }

  /**
   * End current session and generate summary
   */
  async end(): Promise<SessionSummary | null> {
    await this.initialize()

    if (!this.currentSession) {
      return null
    }

    const session = this.currentSession
    const now = new Date()

    // Calculate duration
    const startedAt = new Date(session.startedAt)
    const durationMs = now.getTime() - startedAt.getTime()
    const durationMinutes = Math.round(durationMs / 60000)

    // Generate summary
    const summary = await this.generateSummary(session)

    // Create session summary
    const sessionSummary: SessionSummary = {
      id: session.id,
      date: startedAt.toISOString().split("T")[0],
      duration: durationMinutes,
      tasks: session.tasks.map(t => t.description),
      filesModified: this.collectModifiedFiles(session),
      errors: this.collectErrors(session),
      learnedCount: session.learnedItems.length,
      highlights: this.extractHighlights(session),
    }

    // Archive session
    await this.archiveSession(session)
    this.currentSession = null

    // Clean up current session file
    try {
      await fs.unlink(this.currentSessionPath)
    } catch {
      // Ignore
    }

    log.info("Ended session", {
      id: sessionSummary.id,
      duration: durationMinutes,
      learned: sessionSummary.learnedCount,
    })

    return sessionSummary
  }

  // ============================================================================
  // TASK MANAGEMENT
  // ============================================================================

  /**
   * Add a task to current session
   */
  async addTask(description: string): Promise<PersistedTask> {
    await this.initialize()

    if (!this.currentSession) {
      throw new Error("No active session")
    }

    const task: PersistedTask = {
      id: `task_${Date.now()}`,
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.currentSession.tasks.push(task)
    await this.saveCurrentSession()

    return task
  }

  /**
   * Update task status
   */
  async updateTask(
    taskId: string,
    updates: Partial<PersistedTask>
  ): Promise<void> {
    await this.initialize()

    if (!this.currentSession) {
      throw new Error("No active session")
    }

    const taskIndex = this.currentSession.tasks.findIndex(t => t.id === taskId)
    if (taskIndex === -1) {
      throw new Error(`Task not found: ${taskId}`)
    }

    this.currentSession.tasks[taskIndex] = {
      ...this.currentSession.tasks[taskIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    await this.saveCurrentSession()
  }

  /**
   * Get tasks from current session
   */
  async getTasks(): Promise<PersistedTask[]> {
    await this.initialize()
    return this.currentSession?.tasks || []
  }

  // ============================================================================
  // LEARNED ITEMS TRACKING
  // ============================================================================

  /**
   * Add a learned item to session
   */
  async addLearnedItem(memoryId: string): Promise<void> {
    await this.initialize()

    if (!this.currentSession) {
      throw new Error("No active session")
    }

    if (!this.currentSession.learnedItems.includes(memoryId)) {
      this.currentSession.learnedItems.push(memoryId)
      await this.saveCurrentSession()
    }
  }

  /**
   * Get learned items from current session
   */
  async getLearnedItems(): Promise<string[]> {
    await this.initialize()
    return this.currentSession?.learnedItems || []
  }

  // ============================================================================
  // CROSS-SESSION MEMORY
  // ============================================================================

  /**
   * Get memories relevant to current task from all sessions
   */
  async getRelevantMemories(
    task: string,
    limit: number = 5
  ): Promise<SessionSummary[]> {
    await this.initialize()

    const sessions = await this.loadArchivedSessions()
    const taskLower = task.toLowerCase()

    // Find relevant sessions
    const relevant = sessions
      .filter(s => (s.summary || "").toLowerCase().includes(taskLower))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit)

    return relevant
  }

  /**
   * Get all archived sessions
   */
  async getAllSessions(): Promise<SessionSummary[]> {
    await this.initialize()
    return this.loadArchivedSessions()
  }

  /**
   * Search previous sessions for context
   */
  async searchContext(query: string): Promise<string[]> {
    const sessions = await this.loadArchivedSessions()
    const queryLower = query.toLowerCase()

    const contexts: string[] = []

    for (const session of sessions) {
      // Check summary
      if ((session.summary || "").toLowerCase().includes(queryLower)) {
        contexts.push(session.summary || "")
      }

      // Check tasks
      for (const task of session.tasks) {
        if (task.toLowerCase().includes(queryLower)) {
          contexts.push(`In session ${session.date}: worked on "${task}"`)
        }
      }

      // Check highlights
      for (const highlight of session.highlights) {
        if (highlight.toLowerCase().includes(queryLower)) {
          contexts.push(highlight)
        }
      }
    }

    return contexts.slice(0, 10)
  }

  // ============================================================================
  // SESSION SUMMARY
  // ============================================================================

  /**
   * Generate a summary for the session
   */
  private async generateSummary(session: SessionState): Promise<string> {
    const parts: string[] = []

    if (session.tasks.length > 0) {
      const completed = session.tasks.filter(t => t.status === "complete").length
      parts.push(`Completed ${completed}/${session.tasks.length} tasks`)
    }

    if (session.learnedItems.length > 0) {
      parts.push(`Learned ${session.learnedItems.length} new things`)
    }

    if (session.conversationSummary) {
      parts.push(session.conversationSummary)
    }

    return parts.join(". ") || "General work session"
  }

  /**
   * Extract highlights from session
   */
  private extractHighlights(session: SessionState): string[] {
    const highlights: string[] = []

    // Completed tasks
    const completedTasks = session.tasks.filter(t => t.status === "complete")
    for (const task of completedTasks.slice(-3)) {
      highlights.push(`Completed: ${task.description}`)
    }

    // Learned items
    if (session.learnedItems.length > 0) {
      highlights.push(`Learned ${session.learnedItems.length} new concepts`)
    }

    return highlights
  }

  /**
   * Collect modified files from task descriptions
   */
  private collectModifiedFiles(session: SessionState): string[] {
    const files = new Set<string>()
    for (const task of session.tasks) {
      // Extract file paths from task descriptions (common patterns like "edited foo.ts")
      const filePattern = /(?:edited|modified|created|updated|changed)\s+(\S+\.\w+)/gi
      let match: RegExpExecArray | null
      while ((match = filePattern.exec(task.description)) !== null) {
        files.add(match[1])
      }
    }
    return Array.from(files)
  }

  /**
   * Collect errors from failed tasks
   */
  private collectErrors(session: SessionState): string[] {
    return session.tasks
      .filter(t => t.status === "failed")
      .map(t => `Task failed: ${t.description}`)
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  /**
   * Save current session to file
   */
  private async saveCurrentSession(): Promise<void> {
    if (!this.currentSession) return

    await fs.writeFile(
      this.currentSessionPath,
      JSON.stringify(this.currentSession, null, 2)
    )
  }

  /**
   * Archive a session
   */
  private async archiveSession(session: SessionState): Promise<void> {
    const sessions = await this.loadArchivedSessions()

    const summary: SessionSummary = {
      id: session.id,
      date: new Date(session.startedAt).toISOString().split("T")[0],
      duration: 0, // Would need to calculate
      tasks: session.tasks.map(t => t.description),
      filesModified: [],
      errors: [],
      learnedCount: session.learnedItems.length,
      highlights: this.extractHighlights(session),
    }

    sessions.push(summary)

    await fs.writeFile(this.sessionsPath, JSON.stringify(sessions, null, 2))
  }

  /**
   * Load archived sessions
   */
  private async loadArchivedSessions(): Promise<SessionSummary[]> {
    try {
      const content = await fs.readFile(this.sessionsPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return []
    }
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    totalSessions: number
    totalTasks: number
    completedTasks: number
    totalLearned: number
    totalTimeMinutes: number
  }> {
    const sessions = await this.loadArchivedSessions()

    let totalTasks = 0
    let completedTasks = 0
    let totalLearned = 0
    let totalTime = 0

    for (const session of sessions) {
      totalTasks += session.tasks.length
      completedTasks += session.tasks.filter(t =>
        t.toLowerCase().includes("complete") ||
        t.toLowerCase().includes("done")
      ).length
      totalLearned += session.learnedCount
      totalTime += session.duration
    }

    // Add current session
    if (this.currentSession) {
      totalTasks += this.currentSession.tasks.length
      totalLearned += this.currentSession.learnedItems.length
    }

    return {
      totalSessions: sessions.length + (this.currentSession ? 1 : 0),
      totalTasks,
      completedTasks,
      totalLearned,
      totalTimeMinutes: totalTime,
    }
  }

  // ============================================================================
  // MAINTENANCE
  // ============================================================================

  /**
   * Clear all session data
   */
  async clear(): Promise<void> {
    this.currentSession = null

    try {
      await fs.rm(this.sessionsDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }

    log.info("Cleared all session data")
  }

  /**
   * Export session history
   */
  async export(): Promise<string> {
    const sessions = await this.loadArchivedSessions()
    return JSON.stringify(sessions, null, 2)
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultInstance: SessionService | null = null

export function getSessionService(userId?: string): SessionService {
  if (!defaultInstance) {
    defaultInstance = new SessionService(userId)
  }
  return defaultInstance
}

export async function initializeDefaultSession(): Promise<SessionService> {
  const service = getSessionService()
  await service.initialize()
  return service
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default SessionService
