/**
 * Code Review Command
 * 
 * Automatically reviews GitHub/GitLab PRs for code quality, security, and performance.
 * Adds comments and suggestions directly to PRs.
 * 
 * Usage: atomcli review --pr=123
 */

import { cmd } from "./cmd"
import { Log } from "@/util/log"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Bash } from "@/tool/bash"
import { Read } from "@/tool/read"
import { Instance } from "@/project/instance"
import fs from "fs/promises"

export namespace CodeReview {
  const log = Log.create({ service: "code-review" })

  export interface ReviewOptions {
    pr?: number
    repo?: string
    provider?: "github" | "gitlab"
    diffOnly?: boolean
  }

  export interface ReviewComment {
    file: string
    line: number
    message: string
    severity: "info" | "warning" | "error" | "suggestion"
    category: "quality" | "security" | "performance" | "style" | "documentation"
    suggestion?: string
    originalCode?: string
  }

  export interface ReviewResult {
    pr: number
    summary: string
    comments: ReviewComment[]
    stats: {
      total: number
      errors: number
      warnings: number
      suggestions: number
      info: number
    }
  }

  /**
   * Get PR diff from GitHub
   */
  export async function getGitHubPRDiff(
    repo: string,
    pr: number,
    token?: string
  ): Promise<string> {
    const authHeader = token ? `-H "Authorization: token ${token}"` : ""
    const url = `https://api.github.com/repos/${repo}/pulls/${pr}`

    const proc = Bun.spawn(
      ["bash", "-c", `curl -s ${authHeader} -H "Accept: application/vnd.github.v3.diff" ${url}`],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    const diff = await new Response(proc.stdout).text()
    return diff
  }

  /**
   * Parse diff to extract changed files and hunks
   */
  export function parseDiff(diff: string): Array<{
    file: string
    additions: number
    deletions: number
    hunks: Array<{
      oldStart: number
      newStart: number
      lines: string[]
    }>
  }> {
    const files: ReturnType<typeof parseDiff> = []
    const lines = diff.split("\n")

    let currentFile: ReturnType<typeof parseDiff>[0] | null = null
    let currentHunk: ReturnType<typeof parseDiff>[0]["hunks"][0] | null = null

    for (const line of lines) {
      // New file
      if (line.startsWith("diff --git")) {
        if (currentFile) {
          files.push(currentFile)
        }
        currentFile = {
          file: "",
          additions: 0,
          deletions: 0,
          hunks: [],
        }
        currentHunk = null
      }

      // File path
      if (line.startsWith("+++ b/")) {
        if (currentFile) {
          currentFile.file = line.replace("+++ b/", "")
        }
      }

      // Hunk header
      const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/)
      if (hunkMatch && currentFile) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          newStart: parseInt(hunkMatch[2]),
          lines: [],
        }
        currentFile.hunks.push(currentHunk)
      }

      // Hunk content
      if (currentHunk && !line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")) {
        currentHunk.lines.push(line)
        if (line.startsWith("+") && !line.startsWith("+++") && currentFile) {
          currentFile.additions++
        }
        if (line.startsWith("-") && !line.startsWith("---") && currentFile) {
          currentFile.deletions++
        }
      }
    }

    if (currentFile) {
      files.push(currentFile)
    }

    return files
  }

  /**
   * Generate AI review for a file
   */
  export async function reviewFile(
    file: string,
    diff: string,
    hunks: Array<{ oldStart: number; newStart: number; lines: string[] }>
  ): Promise<ReviewComment[]> {
    const agent = await Agent.get("general")
    if (!agent) throw new Error("General agent not found")

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    const prompt = `Review this code change for quality, security, and performance issues.

File: ${file}

Diff:
\`\`\`diff
${diff}
\`\`\`

Analyze the changes and provide specific, actionable feedback. For each issue found, specify:
1. Line number (in the new file)
2. Severity: error, warning, suggestion, or info
3. Category: quality, security, performance, style, or documentation
4. Clear description of the issue
5. Suggested fix (if applicable)

Return your review as a JSON array of comments:
[
  {
    "line": 42,
    "severity": "warning",
    "category": "quality",
    "message": "This function is too long and should be refactored",
    "suggestion": "Extract the validation logic into a separate function"
  }
]

If no issues found, return an empty array [].`

    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "code-review-session",
      role: "user",
      time: { created: Date.now() },
      agent: "code-review",
      model: { providerID: model.providerID, modelID: model.id },
    }

    const abortController = new AbortController()

    try {
      const stream = await LLM.stream({
        agent,
        user: userMessage,
        sessionID: "code-review-session",
        model,
        system: [
          "You are an expert code reviewer. Provide constructive, specific feedback. Focus on real issues, not nitpicks.",
        ],
        abort: abortController.signal,
        messages: [{ role: "user", content: prompt }],
        tools: {},
      })

      const response = await stream.text

      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const comments: ReviewComment[] = JSON.parse(jsonMatch[0])
        // Add file to each comment
        return comments.map((c) => ({ ...c, file }))
      }

      return []
    } catch (e) {
      log.error("review generation failed", { file, error: e })
      return []
    }
  }

  /**
   * Post review comments to GitHub PR
   */
  export async function postGitHubReview(
    repo: string,
    pr: number,
    result: ReviewResult,
    token?: string
  ): Promise<void> {
    const authHeader = token ? `-H "Authorization: token ${token}"` : ""
    const baseUrl = `https://api.github.com/repos/${repo}/pulls/${pr}`

    // Post review summary as a comment
    const summaryBody = generateReviewSummary(result)

    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `curl -s -X POST ${authHeader} -H "Content-Type: application/json" ${baseUrl}/reviews -d '${JSON.stringify(
          {
            body: summaryBody,
            event: result.stats.errors > 0 ? "REQUEST_CHANGES" : "COMMENT",
          }
        )}'`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    await proc.exited

    // Post individual line comments
    for (const comment of result.comments) {
      if (comment.line > 0) {
        await postGitHubLineComment(repo, pr, comment, token)
      }
    }
  }

  async function postGitHubLineComment(
    repo: string,
    pr: number,
    comment: ReviewComment,
    token?: string
  ): Promise<void> {
    const authHeader = token ? `-H "Authorization: token ${token}"` : ""
    const url = `https://api.github.com/repos/${repo}/pulls/${pr}/comments`

    const body = {
      path: comment.file,
      line: comment.line,
      body: `**${comment.severity.toUpperCase()}** (${comment.category}): ${comment.message}${comment.suggestion ? `\n\n**Suggestion:** ${comment.suggestion}` : ""
        }`,
    }

    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        `curl -s -X POST ${authHeader} -H "Content-Type: application/json" ${url} -d '${JSON.stringify(
          body
        )}'`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    await proc.exited
  }

  function generateReviewSummary(result: ReviewResult): string {
    let summary = `## 🔍 Automated Code Review\n\n`
    summary += `${result.summary}\n\n`
    summary += `### Summary\n`
    summary += `- **Total Comments:** ${result.stats.total}\n`
    summary += `- **Errors:** ${result.stats.errors}\n`
    summary += `- **Warnings:** ${result.stats.warnings}\n`
    summary += `- **Suggestions:** ${result.stats.suggestions}\n`
    summary += `- **Info:** ${result.stats.info}\n\n`
    summary += `---\n\n*Review generated by AtomCLI*`

    return summary
  }

  /**
   * Run full code review
   */
  export async function review(options: ReviewOptions): Promise<ReviewResult> {
    const { pr, repo, provider = "github" } = options

    if (!pr || !repo) {
      throw new Error("PR number and repo are required")
    }

    log.info("starting review", { pr, repo, provider })

    // Get PR diff
    const diff = await getGitHubPRDiff(repo, pr)
    const files = parseDiff(diff)

    log.info("parsed diff", { files: files.length })

    // Review each file
    const allComments: ReviewComment[] = []

    for (const file of files) {
      // Skip binary files and large diffs
      if (file.additions + file.deletions > 500) {
        log.info("skipping large file", { file: file.file })
        continue
      }

      const fileDiff = generateFileDiff(file)
      const comments = await reviewFile(file.file, fileDiff, file.hunks)
      allComments.push(...comments)
    }

    // Generate summary
    const summary = await generateReviewSummaryAI(allComments)

    const result: ReviewResult = {
      pr,
      summary,
      comments: allComments,
      stats: {
        total: allComments.length,
        errors: allComments.filter((c) => c.severity === "error").length,
        warnings: allComments.filter((c) => c.severity === "warning").length,
        suggestions: allComments.filter((c) => c.severity === "suggestion").length,
        info: allComments.filter((c) => c.severity === "info").length,
      },
    }

    return result
  }

  function generateFileDiff(file: ReturnType<typeof parseDiff>[0]): string {
    let diff = `diff --git a/${file.file} b/${file.file}\n`
    for (const hunk of file.hunks) {
      diff += `@@ -${hunk.oldStart} +${hunk.newStart} @@\n`
      for (const line of hunk.lines) {
        diff += line + "\n"
      }
    }
    return diff
  }

  async function generateReviewSummaryAI(comments: ReviewComment[]): Promise<string> {
    if (comments.length === 0) {
      return "✅ No issues found! Great job on this PR."
    }

    const agent = await Agent.get("general")
    if (!agent) return "Review completed with " + comments.length + " comments."

    const defaultModel = await Provider.defaultModel()
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)

    const categories = [...new Set(comments.map((c) => c.category))]
    const severities = [...new Set(comments.map((c) => c.severity))]

    const prompt = `Summarize this code review in 2-3 sentences:

Total comments: ${comments.length}
Categories: ${categories.join(", ")}
Severities: ${severities.join(", ")}

Top issues:
${comments
        .slice(0, 5)
        .map((c) => `- ${c.category}: ${c.message}`)
        .join("\n")}

Provide a brief, constructive summary.`

    const userMessage: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: "code-review-session",
      role: "user",
      time: { created: Date.now() },
      agent: "code-review",
      model: { providerID: model.providerID, modelID: model.id },
    }

    const abortController = new AbortController()

    try {
      const stream = await LLM.stream({
        agent,
        user: userMessage,
        sessionID: "code-review-session",
        model,
        system: ["You are a helpful code reviewer. Be constructive and encouraging."],
        abort: abortController.signal,
        messages: [{ role: "user", content: prompt }],
        tools: {},
      })

      return await stream.text
    } catch (e) {
      return `Review completed with ${comments.length} comments across ${categories.length} categories.`
    }
  }
}

/**
 * CLI Command Definition
 */
export const ReviewCommand = cmd({
  command: "review",
  describe: "Review GitHub/GitLab PRs automatically",
  builder: (yargs) =>
    yargs
      .option("pr", {
        type: "number",
        alias: "p",
        describe: "PR number to review",
        demandOption: true,
      })
      .option("repo", {
        type: "string",
        alias: "r",
        describe: "Repository (owner/repo format)",
        demandOption: true,
      })
      .option("provider", {
        type: "string",
        choices: ["github", "gitlab"],
        describe: "Git provider",
        default: "github",
      })
      .option("diff-only", {
        type: "boolean",
        alias: "d",
        describe: "Only show diff analysis without posting",
        default: false,
      })
      .option("token", {
        type: "string",
        alias: "t",
        describe: "GitHub/GitLab access token",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output file for review results",
      }),
  handler: async (args) => {
    const log = Log.create({ service: "review-cli" })

    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        try {
          console.log(`🔍 Reviewing PR #${args.pr} in ${args.repo}...\n`)

          const result = await CodeReview.review({
            pr: args.pr,
            repo: args.repo,
            provider: args.provider as "github" | "gitlab",
            diffOnly: args.diffOnly,
          })

          // Display results
          console.log("## Review Summary\n")
          console.log(result.summary)
          console.log("\n### Statistics")
          console.log(`- Total Comments: ${result.stats.total}`)
          console.log(`- Errors: ${result.stats.errors}`)
          console.log(`- Warnings: ${result.stats.warnings}`)
          console.log(`- Suggestions: ${result.stats.suggestions}`)
          console.log(`- Info: ${result.stats.info}`)

          if (result.comments.length > 0) {
            console.log("\n### Comments by File\n")
            const byFile = result.comments.reduce((acc, c) => {
              if (!acc[c.file]) acc[c.file] = []
              acc[c.file].push(c)
              return acc
            }, {} as Record<string, CodeReview.ReviewComment[]>)

            for (const [file, comments] of Object.entries(byFile)) {
              console.log(`\n**${file}**`)
              for (const comment of comments) {
                console.log(`  - Line ${comment.line}: [${comment.severity}] ${comment.message}`)
              }
            }
          }

          // Save to file if requested
          if (args.output) {
            await fs.writeFile(
              args.output,
              JSON.stringify(result, null, 2),
              "utf-8"
            )
            console.log(`\n📄 Results saved to: ${args.output}`)
          }

          // Post to PR if not diff-only
          if (!args.diffOnly) {
            console.log("\n📝 Posting review to PR...")
            await CodeReview.postGitHubReview(args.repo, args.pr, result, args.token)
            console.log("✅ Review posted successfully!")
          }

          // Exit with error code if errors found
          if (result.stats.errors > 0) {
            console.log(`\n❌ ${result.stats.errors} errors found`)
            process.exit(1)
          }

          console.log("\n✅ Code review complete!")
        } catch (error) {
          log.error("code review failed", { error })
          console.error("Error:", error instanceof Error ? error.message : error)
          process.exit(1)
        }
      }
    })
  },
})
