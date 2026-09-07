import { Log } from "@/util/util/log"
import { ModelPurpose } from "@/core/routing/model-purpose"
import { getStreamText } from "@/util/util/ai-compat"
import { z } from "zod"
import { MessageV2 } from "@/core/session/message-v2"
import { Provider } from "@/integrations/provider/provider"
import { ModelVerification } from "@/integrations/provider/verification"
import memorySystem from "../index"
import { ExecutionRuntime } from "@/core/execution/runtime"

const log = Log.create({ service: "memory.retrospective" })

export const SessionRetrospectiveSchema = z.object({
  hasValuableInfo: z
    .boolean()
    .describe("Whether this session contained any valuable learning, errors, or generic info to remember"),
  activities: z.array(z.string()).default([]).describe("A summary of actions taken or things built during the session"),
  learnings: z.array(z.string()).default([]).describe("New factual information, research results, or web discoveries"),
  errors: z
    .array(
      z.object({
        error: z.string().default("Unknown error").describe("The exact error message or technical problem encountered"),
        context: z
          .string()
          .default("Unknown context")
          .describe("What the AI or user was trying to do when the error happened"),
        solution: z.string().default("No solution recorded").describe("How the error was eventually solved"),
        confidence: z.number().min(0).max(1).default(0.5).describe("Confidence in this solution (0.0 to 1.0)"),
      }),
    )
    .default([])
    .describe("Technical mistakes made and their concrete solutions"),
})

export type SessionRetrospective = z.infer<typeof SessionRetrospectiveSchema>

export class SessionRetrospectiveService {
  /**
   * Analyze the session messages and extract memories
   */
  static async execute(sessionID: string, messages: MessageV2.WithParts[]): Promise<void> {
    try {
      log.info("Starting background retrospective learning", { sessionID })

      if (!messages || messages.length === 0) {
        log.info("No messages to analyze")
        return
      }

      // 1. Format conversation history for the LLM
      let conversationDump = ""
      for (const msg of messages) {
        const textParts = msg.parts
          .filter((p) => !("synthetic" in p && p.synthetic))
          .map((p) => {
            if (p.type === "text") return (p as any).text
            if (p.type === "tool" && p.state.status === "completed")
              return `[Tool ${p.tool} output: ${p.state.output?.substring(0, 500)}]...`
            if (p.type === "tool" && p.state.status === "error") return `[Tool ${p.tool} failed: ${p.state.error}]`
            return `[${p.type}]`
          })
          .filter(Boolean)
          .join("\\n")

        if (textParts) {
          conversationDump += `\\n[${msg.info.role.toUpperCase()}]: ${textParts}`
        }
      }

      if (conversationDump.trim().length < 50) {
        log.info("Conversation too short for retrospective")
        return
      }

      // 2. Get LLM Model
      const routeModel = messages.findLast((message) => message.info.role === "user")?.info
      const execution = await ModelPurpose.resolve(
        "analysis",
        conversationDump.slice(0, 2_000),
        routeModel?.role === "user" ? routeModel.model : undefined,
        sessionID,
      )
      const language = execution.language
      const streamText = await getStreamText()

      // 3. System Prompt
      const systemPrompt = `You are a specialized Background Memory Analyst for AtomCLI.
Your job is to read the transcript of a completed CLI interaction session and extract structured learning data.

Analyze the conversation for:
1. WHAT DID WE DO? (activities) - e.g., "Refactored the authentication system" or "Built a new React component".
2. WHAT DID WE LEARN? (learnings) - Look for web searches, new facts, or discovered truths.
3. WHAT MISTAKES WERE MADE & HOW WERE THEY SOLVED? (errors) - Look for CLI tool errors, compiler errors, or wrong assumptions, and extract exactly how the issue was fixed.

RULES:
- Be concise.
- Output ONLY valid JSON matching the exact schema required. 
- If nothing notable happened, set hasValuableInfo: false.`

      // 4. Run Extraction
      const prompt = `Please analyze this session:\\n\\n${conversationDump}`
      const executionAttempt = await ExecutionRuntime.admitModelCall({
        sessionID,
        purpose: "memory:retrospective",
        estimateMicrousd: ExecutionRuntime.estimateMicrousd(execution.model, `${systemPrompt}\n${prompt}`, 2_000),
      })
      let responseText = ""
      try {
        const result = await streamText({
          model: language,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          maxOutputTokens: 2000,
        })
        for await (const chunk of result.textStream) responseText += chunk
        executionAttempt?.settle(ExecutionRuntime.usageCostUsd(execution.model, await result.usage))
      } catch (error) {
        executionAttempt?.uncertain()
        throw error
      }
      if (responseText.trim()) {
        const provider = await Provider.getProvider(execution.model.providerID)
        if (provider) await ModelVerification.observe(execution.model, provider, ["text"])
      }

      // 5. Parse JSON
      const jsonMatch =
        responseText.match(/\`\`\`(?:json)?\s*(\{[\s\S]*?\})\s*\`\`\`/) || responseText.match(/(\{[\s\S]*\})/)

      if (!jsonMatch) {
        log.warn("Failed to extract JSON from retrospective", { responseText })
        return
      }

      const parsed = JSON.parse(jsonMatch[1])
      const retrospective = SessionRetrospectiveSchema.parse(parsed)

      // 6. Save to Memory System
      if (retrospective.hasValuableInfo) {
        log.info("Extracted valuable retrospective information", { retrospective })

        // Initialize local storage connection for daemon
        const { storage } = await memorySystem.initialize()

        // 6.1 Save Activities
        for (const act of retrospective.activities || []) {
          await storage.create(
            memorySystem.createMemoryItem({
              content: act,
              type: "knowledge",
              tags: ["activity", "session_summary", sessionID],
              strength: 0.5,
            }),
          )
        }

        // 6.2 Save Learnings
        for (const learn of retrospective.learnings || []) {
          await storage.create(
            memorySystem.createMemoryItem({
              content: learn,
              type: "research",
              tags: ["learning", "web_search", sessionID],
              strength: 0.7,
            }),
          )
        }

        // 6.3 Save Errors & Solutions
        for (const err of retrospective.errors || []) {
          await storage.create(
            memorySystem.createMemoryItem({
              content: `Error: ${err.error}\nContext: ${err.context}\nSolution: ${err.solution}`,
              type: "error",
              tags: ["technical_error", "solution", sessionID],
              strength: Math.max(0.6, err.confidence),
            }),
          )
        }

        log.info("Retrospective successfully saved to memory storage")
      } else {
        log.info("No valuable info found in this session")
      }
    } catch (error) {
      log.error("Failed to execute session retrospective", { error })
    }
  }
}

export default SessionRetrospectiveService
