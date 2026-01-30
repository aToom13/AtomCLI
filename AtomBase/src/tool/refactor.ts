/**
 * Refactor Tool - AI Aracı
 * 
 * Kod kokularını tespit eder ve refactoring önerir
 * CLI'deki refactor komutunun AI entegrasyonu
 */

import { Tool } from "./tool"
import { z } from "zod"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { RefactoringAssistant } from "@/cli/cmd/refactor"

export const RefactorTool = Tool.define("refactor", {
  description: "Detect code smells and suggest automated refactorings",
  parameters: z.object({
    target: z.enum(["performance", "readability", "maintainability", "all"]).default("all").describe("Refactoring target"),
    file: z.string().optional().describe("Specific file to analyze (default: all files)"),
    fix: z.boolean().default(false).describe("Apply auto-fixable changes"),
    dry_run: z.boolean().default(true).describe("Show changes without applying"),
  }),
  async execute(input, ctx) {
    const log = Log.create({ service: "refactor-tool" })
    
    try {
      return await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
          const result = await RefactoringAssistant.analyze({
            target: input.target,
            file: input.file,
            dryRun: input.dry_run,
          })

          if (result.smells.length === 0) {
            return {
              title: "Clean Code",
              output: "No code smells detected! Your code looks clean.",
              metadata: { success: true, issues_found: 0, auto_fixable: 0 },
            }
          }

          let message = `Found ${result.stats.total} issues: `
          message += `${result.stats.autoFixable} auto-fixable, `
          message += `${result.stats.total - result.stats.autoFixable} require manual review. `

          // Group by type
          const byType = result.stats.byType
          const typeList = Object.entries(byType).map(([type, count]) => `${type}: ${count}`).join(", ")
          message += `Types: ${typeList}. `

          // Apply auto-fixes if requested
          let fixesApplied = 0
          if (input.fix && !input.dry_run) {
            for (const smell of result.smells) {
              if (smell.autoFixable) {
                const content = await Bun.file(smell.file).text()
                const fixed = await RefactoringAssistant.applyAutoFix(smell, content)
                if (fixed) {
                  await Bun.write(smell.file, fixed)
                  fixesApplied++
                }
              }
            }
            message += `Applied ${fixesApplied} auto-fixes. `
          }

          if (input.dry_run && result.stats.autoFixable > 0) {
            message += "Run with fix=true to apply auto-fixes."
          }

          return {
            title: "Refactoring Analysis",
            output: message.trim(),
            metadata: { 
              success: true, 
              issues_found: result.stats.total, 
              auto_fixable: result.stats.autoFixable,
              fixes_applied: input.fix ? fixesApplied : undefined 
            },
          }
        }
      })
    } catch (error) {
      log.error("refactoring analysis failed", { error })
      return {
        title: "Refactoring Error",
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { success: false, issues_found: 0, auto_fixable: 0 },
      }
    }
  },
})
