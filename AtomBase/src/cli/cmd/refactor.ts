/**
 * Refactoring Assistant Command
 * 
 * Detects code smells and suggests automated refactorings.
 * Supports extract function, inline variable, and other common refactorings.
 * 
 * Usage: atomcli refactor --target=performance
 */

import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Read } from "@/tool/read"
import { Edit } from "@/tool/edit"
import { Write } from "@/tool/write"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { AbortController } from "abort-controller"
import fs from "fs/promises"
import path from "path"

export namespace RefactoringAssistant {
  const log = Log.create({ service: "refactor" })

  export interface RefactorOptions {
    target?: "performance" | "readability" | "maintainability" | "all"
    file?: string
    dryRun?: boolean
  }

  export interface CodeSmell {
    id: string
    type: string
    file: string
    line: number
    message: string
    description: string
    severity: "low" | "medium" | "high"
    autoFixable: boolean
    suggestedFix?: string
  }

  export interface Refactoring {
    smell: CodeSmell
    originalCode: string
    refactoredCode: string
    explanation: string
  }

  // Code smell patterns
  const CODE_SMELLS = [
    {
      id: "long-function",
      name: "Long Function",
      pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      detect: async (content: string, line: number, lines: string[]) => {
        let braceCount = 0
        let inFunction = false
        let functionLines = 0
        let startLine = line

        for (let i = line; i < lines.length; i++) {
          const l = lines[i]
          if (!inFunction && l.includes("{")) {
            inFunction = true
          }
          if (inFunction) {
            braceCount += (l.match(/\{/g) || []).length
            braceCount -= (l.match(/\}/g) || []).length
            functionLines++
            if (braceCount <= 0) break
          }
        }

        if (functionLines > 30) {
          return {
            type: "long-function",
            message: `Function is ${functionLines} lines long`,
            severity: functionLines > 50 ? ("high" as const) : ("medium" as const),
            autoFixable: false,
          }
        }
        return null
      },
    },
    {
      id: "magic-number",
      name: "Magic Number",
      pattern: /[^"']\b(\d{2,})\b[^"']/,
      detect: async (content: string, line: number, lines: string[]) => {
        const match = content.match(/[^"']\b(\d{2,})\b[^"']/)
        if (match) {
          const num = parseInt(match[1])
          // Common non-magic numbers
          const common = [10, 100, 1000, 24, 60, 365, 200, 201, 404, 500]
          if (!common.includes(num)) {
            return {
              type: "magic-number",
              message: `Magic number ${num} should be a named constant`,
              severity: "low" as const,
              autoFixable: true,
            }
          }
        }
        return null
      },
    },
    {
      id: "duplicate-code",
      name: "Duplicate Code",
      pattern: /.*/, // Check all lines
      detect: async (content: string, line: number, lines: string[]) => {
        // Simple duplicate detection - check for similar consecutive lines
        const current = content.trim()
        if (line > 0) {
          const prev = lines[line - 1].trim()
          if (current === prev && current.length > 20) {
            return {
              type: "duplicate-code",
              message: "Duplicate code detected",
              severity: "medium" as const,
              autoFixable: false,
            }
          }
        }
        return null
      },
    },
    {
      id: "dead-code",
      name: "Dead Code",
      pattern: /^(?:const|let|var)\s+(\w+)\s*=/,
      detect: async (content: string, line: number, lines: string[], fileContent: string) => {
        const match = content.match(/^(?:const|let|var)\s+(\w+)\s*=/)
        if (match) {
          const varName = match[1]
          // Check if variable is used elsewhere in file
          const usagePattern = new RegExp(`\\b${varName}\\b`, "g")
          const usages = fileContent.match(usagePattern) || []
          if (usages.length <= 1) {
            return {
              type: "dead-code",
              message: `Variable '${varName}' appears to be unused`,
              severity: "low" as const,
              autoFixable: true,
            }
          }
        }
        return null
      },
    },
    {
      id: "console-log",
      name: "Console Log",
      pattern: /console\.(log|warn|error|debug)\s*\(/,
      detect: async (content: string, line: number, lines: string[]) => {
        if (/console\.(log|warn|error|debug)\s*\(/.test(content)) {
          return {
            type: "console-log",
            message: "Console statement found in production code",
            severity: "low" as const,
            autoFixable: true,
          }
        }
        return null
      },
    },
    {
      id: "var-usage",
      name: "Var Usage",
      pattern: /\bvar\s+/,
      detect: async (content: string, line: number, lines: string[]) => {
        if (/\bvar\s+/.test(content)) {
          return {
            type: "var-usage",
            message: "Use 'let' or 'const' instead of 'var'",
            severity: "low" as const,
            autoFixable: true,
          }
        }
        return null
      },
    },
    {
      id: "triple-equals",
      name: "Double Equals",
      pattern: /[^=!]==[^=]/,
      detect: async (content: string, line: number, lines: string[]) => {
        if (/[^=!]==[^=]/.test(content) && !content.includes("//")) {
          return {
            type: "triple-equals",
            message: "Use '===' instead of '==' for strict equality",
            severity: "medium" as const,
            autoFixable: true,
          }
        }
        return null
      },
    },
    {
      id: "any-type",
      name: "Any Type",
      pattern: /:\s*any\b/,
      detect: async (content: string, line: number, lines: string[]) => {
        if (/:\s*any\b/.test(content)) {
          return {
            type: "any-type",
            message: "Avoid using 'any' type - use specific type or unknown",
            severity: "medium" as const,
            autoFixable: false,
          }
        }
        return null
      },
    },
  ]

  /**
   * Detect code smells in a file
   */
  export async function detectSmells(filePath: string): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = []
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      for (const smellDef of CODE_SMELLS) {
        if (smellDef.pattern.test(line)) {
          const detection = await smellDef.detect(line, i, lines, content)
          if (detection) {
            smells.push({
              id: `${smellDef.id}-${i}`,
              type: smellDef.id,
              file: filePath,
              line: i + 1,
              message: detection.message,
              description: smellDef.name,
              severity: detection.severity,
              autoFixable: detection.autoFixable,
            })
          }
        }
      }
    }

    return smells
  }

  /**
   * Generate refactoring suggestion using AI
   */
  export async function generateRefactoring(
    smell: CodeSmell,
    fileContent: string
  ): Promise<Refactoring | null> {
    const agent = await Agent.get("general")
    if (!agent) return null

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    const lines = fileContent.split("\n")
    const contextStart = Math.max(0, smell.line - 5)
    const contextEnd = Math.min(lines.length, smell.line + 10)
    const codeContext = lines.slice(contextStart, contextEnd).join("\n")

    const prompt = `Refactor this code to fix: ${smell.message}

Code context:
\`\`\`
${codeContext}
\`\`\`

Provide:
1. The refactored code
2. Explanation of the changes

Return as JSON:
{
  "refactoredCode": "...",
  "explanation": "..."
}`

    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "refactor-session",
      role: "user",
      time: { created: Date.now() },
      text: prompt,
    }

    try {
      const stream = await LLM.stream({
        agent,
        user: userMessage,
        sessionID: "refactor-session",
        model,
        system: ["You are a refactoring expert. Provide clean, improved code."],
        abort: new AbortController().signal,
        messages: [{ role: "user", content: prompt }],
        tools: {},
      })

      const response = await stream.text

      // Extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0])
        return {
          smell,
          originalCode: codeContext,
          refactoredCode: result.refactoredCode,
          explanation: result.explanation,
        }
      }
    } catch (e) {
      log.error("refactoring generation failed", { error: e })
    }

    return null
  }

  /**
   * Apply simple auto-fixes
   */
  export async function applyAutoFix(smell: CodeSmell, content: string): Promise<string | null> {
    const lines = content.split("\n")
    const lineIndex = smell.line - 1
    const line = lines[lineIndex]

    switch (smell.type) {
      case "var-usage":
        lines[lineIndex] = line.replace(/\bvar\b/, "const")
        return lines.join("\n")

      case "triple-equals":
        lines[lineIndex] = line.replace(/==([^=])/g, "===$1")
        return lines.join("\n")

      case "console-log":
        // Comment out console statement
        lines[lineIndex] = line.replace(/console\./, "// console.")
        return lines.join("\n")

      case "magic-number": {
        const match = line.match(/(\d{2,})/)
        if (match) {
          const num = match[1]
          const constName = `CONSTANT_${num}`
          // Add constant declaration at top of file if not exists
          if (!content.includes(constName)) {
            lines.unshift(`const ${constName} = ${num};`)
          }
          // Replace number with constant
          lines[lineIndex + 1] = lines[lineIndex + 1].replace(num, constName)
        }
        return lines.join("\n")
      }

      default:
        return null
    }
  }

  /**
   * Run refactoring analysis
   */
  export async function analyze(options: RefactorOptions = {}): Promise<{
    smells: CodeSmell[]
    refactorings: Refactoring[]
    stats: {
      total: number
      autoFixable: number
      byType: Record<string, number>
    }
  }> {
    const smells: CodeSmell[] = []
    const refactorings: Refactoring[] = []

    // Find files to analyze
    const glob = new Bun.Glob("**/*.{ts,js,tsx,jsx}")
    const excludePatterns = [
      "node_modules",
      "dist",
      "build",
      ".git",
      "*.test.",
      "*.spec.",
    ]

    for await (const file of glob.scan(".")) {
      if (excludePatterns.some((p) => file.includes(p))) {
        continue
      }

      if (options.file && !file.includes(options.file)) {
        continue
      }

      try {
        const fileSmells = await detectSmells(file)
        smells.push(...fileSmells)

        // Generate refactorings for smells
        for (const smell of fileSmells) {
          if (!smell.autoFixable) {
            const content = await fs.readFile(file, "utf-8")
            const refactoring = await generateRefactoring(smell, content)
            if (refactoring) {
              refactorings.push(refactoring)
            }
          }
        }
      } catch (e) {
        log.warn("failed to analyze file", { file, error: e })
      }
    }

    const stats = {
      total: smells.length,
      autoFixable: smells.filter((s) => s.autoFixable).length,
      byType: smells.reduce((acc, s) => {
        acc[s.type] = (acc[s.type] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }

    return { smells, refactorings, stats }
  }

  /**
   * Generate refactoring report
   */
  export function generateReport(result: ReturnType<typeof analyze> extends Promise<infer T> ? T : never): string {
    let report = `# Refactoring Analysis Report\n\n`
    report += `Generated: ${new Date().toISOString()}\n\n`

    report += `## Summary\n\n`
    report += `- **Total Issues:** ${result.stats.total}\n`
    report += `- **Auto-fixable:** ${result.stats.autoFixable}\n`
    report += `- **Manual Review Needed:** ${result.stats.total - result.stats.autoFixable}\n\n`

    if (Object.keys(result.stats.byType).length > 0) {
      report += `### Issues by Type\n\n`
      for (const [type, count] of Object.entries(result.stats.byType)) {
        report += `- ${type}: ${count}\n`
      }
      report += `\n`
    }

    if (result.smells.length > 0) {
      report += `## Detected Issues\n\n`

      const bySeverity = {
        high: result.smells.filter((s) => s.severity === "high"),
        medium: result.smells.filter((s) => s.severity === "medium"),
        low: result.smells.filter((s) => s.severity === "low"),
      }

      for (const [severity, smells] of Object.entries(bySeverity)) {
        if (smells.length === 0) continue

        report += `### ${severity.toUpperCase()} (${smells.length})\n\n`

        for (const smell of smells) {
          report += `**${smell.message}**\n`
          report += `- File: ${smell.file}:${smell.line}\n`
          report += `- Type: ${smell.type}\n`
          report += `- Auto-fixable: ${smell.autoFixable ? "Yes" : "No"}\n\n`
        }
      }
    }

    if (result.refactorings.length > 0) {
      report += `## Suggested Refactorings\n\n`

      for (const ref of result.refactorings.slice(0, 10)) {
        report += `### ${ref.smell.message}\n\n`
        report += `**Original:**\n\`\`\`\n${ref.originalCode}\n\`\`\`\n\n`
        report += `**Refactored:**\n\`\`\`\n${ref.refactoredCode}\n\`\`\`\n\n`
        report += `**Explanation:** ${ref.explanation}\n\n`
        report += `---\n\n`
      }
    }

    return report
  }
}

/**
 * CLI Command Definition
 */
export const RefactorCommand = cmd({
  command: "refactor",
  describe: "Detect code smells and suggest refactorings",
  builder: (yargs) =>
    yargs
      .option("target", {
        type: "string",
        choices: ["performance", "readability", "maintainability", "all"],
        describe: "Refactoring target",
        default: "all",
      })
      .option("file", {
        type: "string",
        alias: "f",
        describe: "Specific file to analyze",
      })
      .option("fix", {
        type: "boolean",
        describe: "Apply auto-fixable changes",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        alias: "d",
        describe: "Show changes without applying",
        default: false,
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output file for report",
        default: "refactoring-report.md",
      }),
  handler: async (args) => {
    const log = Log.create({ service: "refactor-cli" })

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        try {
          console.log("🔧 Analyzing code for refactoring opportunities...\n")

          const result = await RefactoringAssistant.analyze({
            target: args.target,
            file: args.file,
            dryRun: args.dryRun,
          })

          // Generate report
          const report = RefactoringAssistant.generateReport(result)
          console.log(report)

          // Save report
          await fs.writeFile(args.output, report, "utf-8")
          console.log(`\n📄 Report saved to: ${args.output}`)

          // Apply auto-fixes if requested
          if (args.fix && !args.dryRun) {
            console.log("\n🔨 Applying auto-fixes...")
            let fixedCount = 0

            for (const smell of result.smells) {
              if (smell.autoFixable) {
                const content = await fs.readFile(smell.file, "utf-8")
                const fixed = await RefactoringAssistant.applyAutoFix(smell, content)
                if (fixed) {
                  await fs.writeFile(smell.file, fixed, "utf-8")
                  console.log(`✅ Fixed: ${smell.file}:${smell.line} - ${smell.message}`)
                  fixedCount++
                }
              }
            }

            console.log(`\n✅ Applied ${fixedCount} auto-fixes`)
          }

          // Summary
          console.log(`\n📊 Found ${result.stats.total} issues:`)
          console.log(`   - ${result.stats.autoFixable} auto-fixable`)
          console.log(`   - ${result.stats.total - result.stats.autoFixable} require manual review`)

          if (result.stats.total > 0) {
            console.log("\n💡 Run with --fix to apply auto-fixable changes")
            console.log("💡 Run with --dry-run to preview changes")
          }
        } catch (error) {
          log.error("refactoring analysis failed", { error })
          console.error("Error:", error instanceof Error ? error.message : error)
          process.exit(1)
        }
      }
    })
  },
})
