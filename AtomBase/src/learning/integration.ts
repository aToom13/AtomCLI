import { Log } from "../util/log"
import { Learning } from "./index"
import { MessageV2 } from "../session/message-v2"
import { ulid } from "ulid"

export namespace LearningIntegration {
  const log = Log.create({ service: "learning.integration" })

  // Learning modes
  export type LearningMode = "full" | "errors-only" | "manual" | "disabled"

  // Learning context
  export interface LearningContext {
    sessionID: string
    messageID: string
    task?: string
    technology?: string
  }

  // Track learning state per session
  const sessionState = new Map<string, {
    learnedCount: number
    errorsCount: number
    lastError?: string
  }>()

  // Initialize learning context for a session
  export function initSession(sessionID: string): void {
    if (!sessionState.has(sessionID)) {
      sessionState.set(sessionID, { learnedCount: 0, errorsCount: 0 })
    }
  }

  // Clean up session state
  export function clearSession(sessionID: string): void {
    sessionState.delete(sessionID)
  }

  // Get session learning stats
  export function getSessionStats(sessionID: string): { learnedCount: number; errorsCount: number } {
    const state = sessionState.get(sessionID)
    return state ? { learnedCount: state.learnedCount, errorsCount: state.errorsCount } : { learnedCount: 0, errorsCount: 0 }
  }

  // Learn from a tool error
  export async function learnFromError(
    error: Error,
    toolName: string,
    input: Record<string, any>,
    context: LearningContext
  ): Promise<void> {
    const state = sessionState.get(context.sessionID)
    if (state) {
      state.errorsCount++
      state.lastError = `${toolName}: ${error.message}`
    }

    log.info("learning from error", {
      sessionID: context.sessionID,
      tool: toolName,
      error: error.message,
    })

    // Extract error type
    const errorType = error.constructor.name || "Error"
    
    // Create a meaningful title
    const title = `${errorType} in ${toolName}`
    
    // Analyze the error
    const description = analyzeError(error, toolName, input)

    // Learn the error
    await Learning.learn({
      type: "error",
      title,
      description: description.rootCause,
      context: context.technology || "general",
      problem: error.message,
      solution: description.solution,
      codeBefore: input ? JSON.stringify(input).slice(0, 200) : undefined,
      tags: ["tool-error", toolName, errorType.toLowerCase()],
    })

    if (sessionState) {
      sessionState.learnedCount++
    }

    log.info("learned from error", { title, tool: toolName })
  }

  // Learn from a successful pattern
  export async function learnFromSuccess(
    action: string,
    result: any,
    context: LearningContext
  ): Promise<void> {
    log.info("learning from success", {
      sessionID: context.sessionID,
      action,
    })

    // Only learn from significant successful operations
    if (typeof result === "object" && result !== null) {
      if (result.success === true || result.filesModified > 0) {
        await Learning.learn({
          type: "pattern",
          title: `Successful ${action}`,
          description: `Successfully completed ${action}`,
          context: context.technology || "general",
          solution: "This pattern worked well",
          tags: ["success", action],
        })
      }
    }
  }

  // Learn from user feedback
  export async function learnFromFeedback(
    feedback: {
      type: "correction" | "praise" | "improvement"
      originalAction: string
      userFeedback: string
      betterApproach?: string
    },
    context: LearningContext
  ): Promise<void> {
    log.info("learning from feedback", {
      sessionID: context.sessionID,
      type: feedback.type,
      originalAction: feedback.originalAction,
    })

    await Learning.learn({
      type: feedback.type === "correction" ? "error" : "pattern",
      title: `User Feedback: ${feedback.type} on ${feedback.originalAction}`,
      description: feedback.userFeedback,
      context: context.technology || "general",
      problem: feedback.type === "correction" ? feedback.originalAction : undefined,
      solution: feedback.betterApproach || feedback.userFeedback,
      tags: ["feedback", feedback.type, feedback.originalAction],
    })
  }

  // Get relevant learned knowledge for a task
  export async function getRelevantKnowledge(
    task: string,
    technology?: string
  ): Promise<string> {
    return Learning.buildContext(task, technology)
  }

  // Analyze error and generate solution description
  function analyzeError(
    error: Error,
    toolName: string,
    input: Record<string, any>
  ): { rootCause: string; solution: string } {
    const message = error.message.toLowerCase()
    
    // Common error patterns
    const patterns: Array<{
      match: RegExp
      rootCause: string
      solution: string
    }> = [
      {
        match: /not found|cannot find module/i,
        rootCause: "Missing dependency or file",
        solution: `Check if the file/dependency exists. Use absolute paths.`,
      },
      {
        match: /permission denied|access denied/i,
        rootCause: "Insufficient permissions",
        solution: `Check file permissions or use permission system.`,
      },
      {
        match: /timeout/i,
        rootCause: "Operation timed out",
        solution: `Increase timeout or optimize the operation.`,
      },
      {
        match: /network|connection/i,
        rootCause: "Network issue",
        solution: `Check network connectivity and retry logic.`,
      },
      {
        match: /syntax|parse/i,
        rootCause: "Syntax error",
        solution: `Fix the syntax error in the input.`,
      },
      {
        match: /type|undefined is not/i,
        rootCause: "Type mismatch or undefined value",
        solution: `Add type checking or null guards.`,
      },
      {
        match: /already exists/i,
        rootCause: "Duplicate operation",
        solution: `Check if already exists before creating.`,
      },
    ]

    for (const p of patterns) {
      if (p.match.test(message)) {
        return { rootCause: p.rootCause, solution: p.solution }
      }
    }

    // Default analysis
    return {
      rootCause: `Error in ${toolName}`,
      solution: `Review the error and adjust the input. Tool: ${toolName}`,
    }
  }

  // Build a learning summary for the agent
  export async function buildLearningSummary(
    sessionID: string
  ): Promise<string> {
    const stats = getSessionStats(sessionID)
    
    if (stats.learnedCount === 0) {
      return ""
    }

    const items = await Learning.Memory.search("", undefined, 5)
    const recentItems = items.slice(0, 3)

    let summary = `## Session Learning Summary (${stats.learnedCount} items learned, ${stats.errorsCount} errors)\n\n`
    
    if (recentItems.length > 0) {
      summary += "### Recent Learnings:\n"
      for (const item of recentItems) {
        summary += `- **${item.title}**: ${item.description.slice(0, 100)}...\n`
      }
    }

    return summary
  }
}
