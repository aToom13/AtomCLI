/**
 * Performance Profiler Command
 *
 * Analyzes code for performance issues, Big-O complexity, and anti-patterns.
 * Detects N+1 queries, memory leaks, and inefficient algorithms.
 *
 * Usage: atomcli perf --analyze
 */

import { cmd } from "./cmd"
import { Log } from "@/util/util/log"
import { Read } from "@/integrations/tool/read"
import path from "path"
import fs from "fs/promises"

export namespace PerformanceProfiler {
  const log = Log.create({ service: "perf" })

  export interface PerfOptions {
    files?: string[]
    threshold?: number
  }

  export interface PerformanceIssue {
    file: string
    line: number
    type: "complexity" | "n-plus-one" | "memory" | "algorithm" | "async" | "render"
    severity: "low" | "medium" | "high" | "critical"
    message: string
    description: string
    suggestion: string
    complexity?: string
    estimatedImpact?: string
  }

  export interface ComplexityAnalysis {
    function: string
    line: number
    bigO: string
    cyclomatic: number
    nestedLoops: number
    recursion: boolean
  }

  export interface PerfResult {
    issues: PerformanceIssue[]
    complexity: ComplexityAnalysis[]
    summary: {
      totalIssues: number
      critical: number
      high: number
      medium: number
      low: number
      averageComplexity: number
      filesAnalyzed: number
    }
    recommendations: string[]
  }

  // Anti-patterns that indicate performance issues
  const ANTI_PATTERNS = [
    {
      name: "Nested Loop (O(n²))",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*for\s*\(/,
      type: "complexity" as const,
      severity: "high" as const,
      message: "Nested loops detected - O(n²) complexity",
      suggestion: "Consider using a Map/Set for O(1) lookup or refactor to reduce complexity",
    },
    {
      name: "Triple Nested Loop (O(n³))",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*for\s*\([^)]*\)\s*\{[^}]*for\s*\(/,
      type: "complexity" as const,
      severity: "critical" as const,
      message: "Triple nested loops - O(n³) complexity",
      suggestion: "This is very inefficient. Consider completely refactoring this algorithm",
    },
    {
      name: "Array.includes in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*\.includes\s*\(/,
      type: "complexity" as const,
      severity: "medium" as const,
      message: "Array.includes() inside loop - O(n²) complexity",
      suggestion: "Convert array to Set for O(1) lookup with Set.has()",
    },
    {
      name: "Array.indexOf in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*\.indexOf\s*\(/,
      type: "complexity" as const,
      severity: "medium" as const,
      message: "Array.indexOf() inside loop - O(n²) complexity",
      suggestion: "Use a Map for O(1) key lookup instead",
    },
    {
      name: "Potential N+1 Query",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*(await\s+.*\.find|await\s+.*\.query|\.get\()/,
      type: "n-plus-one" as const,
      severity: "high" as const,
      message: "Potential N+1 query pattern",
      suggestion: "Use eager loading or batch queries to reduce database round-trips",
    },
    {
      name: "Synchronous File Operations in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*readFileSync|writeFileSync/,
      type: "async" as const,
      severity: "high" as const,
      message: "Synchronous file operations in loop",
      suggestion: "Use async file operations or process files in parallel with Promise.all()",
    },
    {
      name: "Memory Leak - Event Listener",
      pattern: /\.addEventListener\s*\([^)]*\)\s*[^}]*[^\{]*\}(?!.*removeEventListener)/,
      type: "memory" as const,
      severity: "medium" as const,
      message: "Potential memory leak - event listener added without removal",
      suggestion: "Ensure event listeners are removed when component unmounts or use AbortController",
    },
    {
      name: "Memory Leak - setInterval",
      pattern: /setInterval\s*\([^)]*\)(?!.*clearInterval)/,
      type: "memory" as const,
      severity: "high" as const,
      message: "Potential memory leak - setInterval without clearInterval",
      suggestion: "Always clear intervals when component unmounts or use clearInterval",
    },
    {
      name: "Memory Leak - Closure in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*setTimeout.*\(.*\$\{/,
      type: "memory" as const,
      severity: "medium" as const,
      message: "Potential memory leak - closure capturing loop variable",
      suggestion: "Use let/const in loop or bind the variable properly",
    },
    {
      name: "Inefficient DOM Query in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*querySelector|getElementById/,
      type: "render" as const,
      severity: "medium" as const,
      message: "DOM queries inside loop - expensive operations",
      suggestion: "Query DOM once outside the loop and cache the reference",
    },
    {
      name: "Array.concat in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*\.concat\s*\(/,
      type: "complexity" as const,
      severity: "medium" as const,
      message: "Array.concat() in loop creates O(n²) copies",
      suggestion: "Use .push() with spread or collect items and concat once at end",
    },
    {
      name: "JSON.parse/stringify in Loop",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*JSON\.(parse|stringify)/,
      type: "complexity" as const,
      severity: "medium" as const,
      message: "JSON operations in loop - expensive serialization",
      suggestion: "Structure data to avoid repeated serialization or process outside loop",
    },
    {
      name: "Recursive Function without Base Case Check",
      pattern: /function\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\1\s*\([^)]*\)(?!.*if)/,
      type: "algorithm" as const,
      severity: "high" as const,
      message: "Recursive function may lack proper termination check",
      suggestion: "Ensure recursion has proper base case and will terminate",
    },
    {
      name: "Promise in Loop without await",
      pattern: /for\s*\([^)]*\)\s*\{[^}]*new\s+Promise|Promise\.resolve(?!.*await)/,
      type: "async" as const,
      severity: "high" as const,
      message: "Promises created in loop without proper handling",
      suggestion: "Use Promise.all() to handle promises concurrently or await properly",
    },
  ]

  /**
   * Analyze file for performance issues
   */
  export async function analyzeFile(
    filePath: string,
    threshold = 10,
  ): Promise<{
    issues: PerformanceIssue[]
    complexity: ComplexityAnalysis[]
  }> {
    const issues: PerformanceIssue[] = []
    const complexity: ComplexityAnalysis[] = []

    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.split("\n")

    // Skip test files and minified files
    if (filePath.includes(".test.") || filePath.includes(".spec.") || isMinified(content)) {
      return { issues: [], complexity: [] }
    }

    // Check the whole file so multi-line patterns (for example nested loops)
    // are not missed simply because their braces are on different lines.
    for (const antiPattern of ANTI_PATTERNS) {
      const match = content.match(antiPattern.pattern)
      if (!match || match.index === undefined) continue
      const lineNumber = content.slice(0, match.index).split("\n").length
      issues.push({
        file: filePath,
        line: lineNumber,
        type: antiPattern.type,
        severity: antiPattern.severity,
        message: antiPattern.message,
        description: `Line ${lineNumber} may have performance issues: ${antiPattern.name}`,
        suggestion: antiPattern.suggestion,
      })
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1
      // Analyze function complexity
      const funcMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/)
      if (funcMatch) {
        const funcComplexity = analyzeFunctionComplexity(content, i, funcMatch[1])
        if (funcComplexity) {
          complexity.push(funcComplexity)

          // Add issue if complexity is high
          if (funcComplexity.cyclomatic > threshold) {
            issues.push({
              file: filePath,
              line: lineNumber,
              type: "complexity",
              severity: funcComplexity.cyclomatic > threshold * 2 ? "critical" : "high",
              message: `High cyclomatic complexity (${funcComplexity.cyclomatic})`,
              description: `Function ${funcComplexity.function} has high complexity`,
              suggestion: "Refactor into smaller functions or reduce branching logic",
              complexity: `O(${funcComplexity.bigO})`,
            })
          }
        }
      }
    }

    return { issues, complexity }
  }

  function isMinified(content: string): boolean {
    const lines = content.split("\n")
    const avgLineLength = content.length / lines.length
    return avgLineLength > 200 || lines.some((line) => line.length > 1000)
  }

  function analyzeFunctionComplexity(content: string, startLine: number, funcName: string): ComplexityAnalysis | null {
    const lines = content.split("\n")
    let braceCount = 0
    let inFunction = false
    const body: string[] = []

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]
      const openBraces = (line.match(/\{/g) || []).length
      const closeBraces = (line.match(/\}/g) || []).length

      if (!inFunction && openBraces > 0) {
        inFunction = true
        body.push(line.slice(line.indexOf("{") + 1))
      } else if (inFunction) {
        body.push(line)
      }

      if (inFunction) {
        braceCount += openBraces - closeBraces
        if (braceCount <= 0) {
          break
        }
      }
    }

    if (!inFunction) return null

    const bodyText = body.join("\n")
    const escapedName = funcName.replace(/\W/g, "\\$&")
    const hasRecursion = new RegExp("\\b" + escapedName + "\\s*\\(").test(bodyText)
    const decisions =
      (bodyText.match(/\b(?:if|for|while|case|catch)\b/g) || []).length +
      (bodyText.match(/&&|\|\|/g) || []).length +
      (bodyText.match(/\?(?![?.])/g) || []).length
    const cyclomatic = 1 + decisions
    const maxNestedLoops = analyzeLoopNesting(bodyText)

    let bigO = "O(1)"
    if (hasRecursion) {
      bigO = "input-dependent (recursive)"
    } else if (maxNestedLoops >= 3) {
      bigO = "O(n³)"
    } else if (maxNestedLoops === 2) {
      bigO = "O(n²)"
    } else if (maxNestedLoops === 1) {
      bigO = "O(n)"
    }

    return {
      function: funcName,
      line: startLine + 1,
      bigO,
      cyclomatic,
      nestedLoops: maxNestedLoops,
      recursion: hasRecursion,
    }
  }

  function analyzeLoopNesting(body: string) {
    const tokens = body.match(/\bfor\s*\(|\bwhile\s*\(|\bdo\b|[{}]/g) ?? []
    const loopScopes: number[] = []
    let braceDepth = 0
    let pendingLoops = 0
    let loopCount = 0
    let maximum = 0

    for (const token of tokens) {
      if (token !== "{" && token !== "}") {
        pendingLoops++
        loopCount++
        continue
      }
      if (token === "{") {
        braceDepth++
        while (pendingLoops > 0) {
          loopScopes.push(braceDepth)
          pendingLoops--
        }
        maximum = Math.max(maximum, loopScopes.length)
        continue
      }
      while (loopScopes.at(-1) === braceDepth) loopScopes.pop()
      braceDepth = Math.max(0, braceDepth - 1)
    }

    return Math.max(maximum, loopCount > 0 ? 1 : 0)
  }

  /**
   * Run full performance analysis
   */
  export async function analyze(options: PerfOptions = {}): Promise<PerfResult> {
    const issues: PerformanceIssue[] = []
    const complexity: ComplexityAnalysis[] = []
    let filesAnalyzed = 0

    const excludePatterns = ["node_modules", "dist", "build", ".git", ".test.", ".spec."]

    const files = options.files?.length ? [...options.files] : []
    if (files.length === 0) {
      const glob = new Bun.Glob("**/*.{ts,js,tsx,jsx}")
      for await (const file of glob.scan(".")) files.push(file)
    }

    for (const file of files) {
      if (!options.files?.length && excludePatterns.some((p) => file.includes(p))) {
        continue
      }

      try {
        const result = await analyzeFile(file, options.threshold)
        issues.push(...result.issues)
        complexity.push(...result.complexity)
        filesAnalyzed++
      } catch (e) {
        log.warn("failed to analyze file", { file, error: e })
      }
    }

    // Calculate summary
    const summary = {
      totalIssues: issues.length,
      critical: issues.filter((i) => i.severity === "critical").length,
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length,
      averageComplexity:
        complexity.length > 0 ? complexity.reduce((acc, c) => acc + c.cyclomatic, 0) / complexity.length : 0,
      filesAnalyzed,
    }

    // Generate recommendations
    const recommendations = generateRecommendations(issues, complexity)

    return {
      issues,
      complexity,
      summary,
      recommendations,
    }
  }

  function generateRecommendations(issues: PerformanceIssue[], complexity: ComplexityAnalysis[]): string[] {
    const recommendations: string[] = []
    const issueTypes = new Set(issues.map((i) => i.type))

    if (issueTypes.has("complexity")) {
      recommendations.push("Consider refactoring functions with high cyclomatic complexity (>10)")
    }

    if (issueTypes.has("n-plus-one")) {
      recommendations.push("Review database queries in loops - consider eager loading or batching")
    }

    if (issueTypes.has("memory")) {
      recommendations.push("Check for memory leaks - ensure event listeners and intervals are cleaned up")
    }

    if (complexity.some((c) => c.bigO === "O(n²)" || c.bigO === "O(n³)")) {
      recommendations.push("Optimize nested loops - consider using Maps/Sets for O(1) lookup")
    }

    if (issueTypes.has("async")) {
      recommendations.push("Review async operations - use Promise.all() for concurrent operations")
    }

    return recommendations
  }

  /**
   * Generate performance report
   */
  export function generateReport(result: PerfResult): string {
    let report = `# Performance Analysis Report\n\n`
    report += `Generated: ${new Date().toISOString()}\n`
    report += `Files Analyzed: ${result.summary.filesAnalyzed}\n\n`

    report += `## Summary\n\n`
    report += `- **Total Issues:** ${result.summary.totalIssues}\n`
    report += `- **Critical:** ${result.summary.critical}\n`
    report += `- **High:** ${result.summary.high}\n`
    report += `- **Medium:** ${result.summary.medium}\n`
    report += `- **Low:** ${result.summary.low}\n`
    report += `- **Average Complexity:** ${result.summary.averageComplexity.toFixed(2)}\n\n`

    if (result.recommendations.length > 0) {
      report += `## Recommendations\n\n`
      for (const rec of result.recommendations) {
        report += `- ${rec}\n`
      }
      report += `\n`
    }

    if (result.issues.length > 0) {
      report += `## Issues by Severity\n\n`

      const bySeverity = {
        critical: result.issues.filter((i) => i.severity === "critical"),
        high: result.issues.filter((i) => i.severity === "high"),
        medium: result.issues.filter((i) => i.severity === "medium"),
        low: result.issues.filter((i) => i.severity === "low"),
      }

      for (const [severity, issues] of Object.entries(bySeverity)) {
        if (issues.length === 0) continue

        report += `### ${severity.toUpperCase()} (${issues.length})\n\n`

        for (const issue of issues) {
          report += `**${issue.message}**\n`
          report += `- File: ${issue.file}:${issue.line}\n`
          report += `- Type: ${issue.type}\n`
          if (issue.complexity) report += `- Complexity: ${issue.complexity}\n`
          report += `- Description: ${issue.description}\n`
          report += `- Suggestion: ${issue.suggestion}\n\n`
        }
      }
    }

    if (result.complexity.length > 0) {
      report += `## Function Complexity Analysis\n\n`
      report += `| Function | Line | Big-O | Cyclomatic | Nested Loops | Recursion |\n`
      report += `|----------|------|-------|------------|--------------|-----------|\n`

      for (const c of result.complexity.sort((a, b) => b.cyclomatic - a.cyclomatic).slice(0, 20)) {
        report += `| ${c.function} | ${c.line} | ${c.bigO} | ${c.cyclomatic} | ${c.nestedLoops} | ${c.recursion ? "Yes" : "No"} |\n`
      }
    }

    return report
  }
}

/**
 * CLI Command Definition
 */
export const PerfCommand = cmd({
  command: "perf",
  describe: "Analyze code for performance issues and complexity",
  builder: (yargs) =>
    yargs
      .option("files", {
        type: "string",
        alias: "f",
        describe: "Specific files to analyze (comma-separated)",
      })
      .option("threshold", {
        type: "number",
        alias: "t",
        describe: "Cyclomatic complexity threshold",
        default: 10,
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output file for report",
        default: "performance-report.md",
      })
      .option("json", {
        type: "boolean",
        alias: "j",
        describe: "Output results as JSON",
        default: false,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "perf-cli" })

    try {
      console.log("⚡ Running performance analysis...\n")

      const result = await PerformanceProfiler.analyze({
        files: args.files?.split(","),
        threshold: args.threshold,
      })

      // Output results
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        const report = PerformanceProfiler.generateReport(result)
        console.log(report)

        // Save report
        await fs.writeFile(args.output, report, "utf-8")
        console.log(`\n📄 Report saved to: ${args.output}`)
      }

      // Exit with error if critical issues found
      if (result.summary.critical > 0) {
        console.log(`\n❌ ${result.summary.critical} critical performance issues found!`)
        process.exit(1)
      }

      if (result.summary.high > 0) {
        console.log(`\n⚠️  ${result.summary.high} high severity issues found`)
      }

      console.log("\n✅ Performance analysis complete!")
    } catch (error) {
      log.error("performance analysis failed", { error })
      console.error("Error:", error instanceof Error ? error.message : error)
      process.exit(1)
    }
  },
})
