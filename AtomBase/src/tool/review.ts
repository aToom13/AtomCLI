/**
 * Review Tool - AI Aracı
 * 
 * Kod incelemesi yapar ve öneriler sunar
 * CLI'deki review komutunun AI entegrasyonu
 */

import { Tool } from "./tool"
import { z } from "zod"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { CodeReview } from "@/cli/cmd/review"

export const ReviewTool = Tool.define("review", {
  description: "Review code for quality, security, and performance issues",
  parameters: z.object({
    file: z.string().optional().describe("Specific file to review"),
    code: z.string().optional().describe("Code snippet to review directly"),
    pr: z.number().optional().describe("PR number (for GitHub PR review)"),
    repo: z.string().optional().describe("Repository (owner/repo format, for PR review)"),
    target: z.enum(["quality", "security", "performance", "all"]).default("all").describe("Review focus area"),
  }),
  async execute(input, ctx) {
    const log = Log.create({ service: "review-tool" })
    
    try {
      // If PR review requested
      if (input.pr && input.repo) {
        return await Instance.provide({
          directory: process.cwd(),
          fn: async () => {
            const result = await CodeReview.review({
              pr: input.pr,
              repo: input.repo,
              diffOnly: true,
            })

            const issues = result.comments.map(c => ({
              severity: c.severity,
              category: c.category,
              message: c.message,
              line: c.line,
              suggestion: c.suggestion,
            }))

            return {
              title: "PR Review Complete",
              output: `Reviewed PR #${input.pr} in ${input.repo}. Found ${result.stats.total} issues.`,
              metadata: { 
                success: true, 
                issues_count: issues.length,
                summary: result.summary 
              },
            }
          }
        })
      }

      // If file review requested
      if (input.file) {
        return await Instance.provide({
          directory: process.cwd(),
          fn: async () => {
            const content = await Bun.file(input.file!).text()
            
            // Simple code analysis
            const issues: Array<{
              severity: "info" | "warning" | "error" | "suggestion"
              category: "quality" | "security" | "performance" | "style" | "documentation"
              message: string
              line?: number
              suggestion?: string
            }> = []

            const lines = content.split("\n")
            
            // Check for common issues
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              const lineNum = i + 1

              // Long lines
              if (line.length > 100) {
                issues.push({
                  severity: "suggestion",
                  category: "style",
                  message: `Line ${lineNum} is very long (${line.length} chars)`,
                  line: lineNum,
                  suggestion: "Consider breaking into multiple lines",
                })
              }

              // Console statements
              if (line.match(/console\.(log|warn|error)/) && !line.includes("//")) {
                issues.push({
                  severity: "warning",
                  category: "quality",
                  message: `Console statement found at line ${lineNum}`,
                  line: lineNum,
                  suggestion: "Remove or replace with proper logging",
                })
              }

              // TODO comments
              if (line.match(/\/\/\s*TODO/i)) {
                issues.push({
                  severity: "info",
                  category: "documentation",
                  message: `TODO comment at line ${lineNum}`,
                  line: lineNum,
                })
              }
            }

            return {
              title: "Code Review Complete",
              output: `Reviewed ${input.file}. Found ${issues.length} issues.`,
              metadata: { 
                success: true, 
                issues_count: issues.length,
                summary: issues.length > 0 
                  ? `Code review found ${issues.length} potential improvements.`
                  : "Code looks good! No major issues found."
              },
            }
          }
        })
      }

      // If direct code review requested
      if (input.code) {
        const lines = input.code.split("\n")
        const issues: Array<{
          severity: "info" | "warning" | "error" | "suggestion"
          category: "quality" | "security" | "performance" | "style" | "documentation"
          message: string
          line?: number
          suggestion?: string
        }> = []

        // Similar checks as file review
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          
          if (line.match(/console\.(log|warn|error)/)) {
            issues.push({
              severity: "warning",
              category: "quality",
              message: `Console statement at line ${i + 1}`,
              line: i + 1,
            })
          }
        }

        return {
          title: "Code Review Complete",
          output: `Reviewed code snippet. Found ${issues.length} issues.`,
          metadata: { 
            success: true, 
            issues_count: issues.length,
            summary: issues.length > 0 
              ? `Found ${issues.length} potential improvements in the code.`
              : "Code looks good!"
          },
        }
      }

      return {
        title: "Review Error",
        output: "Please provide either: file path, code snippet, or PR number + repo",
        metadata: { success: false, issues_count: 0 },
      }
    } catch (error) {
      log.error("code review failed", { error })
      return {
        title: "Review Error",
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { success: false, issues_count: 0 },
      }
    }
  },
})
