import fs from "fs/promises"
import { ReviewV2 } from "@/core/verification/review-v2"
import { Session } from "@/core/session"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"
import { SubAgent } from "@/integrations/tool/subagent"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"
import { cmd } from "./cmd"

const DEFAULT_REVIEWERS = 2
const MAX_PARALLEL_REVIEWERS = 4

export namespace CodeReview {
  const log = Log.create({ service: "code-review" })

  export type ProviderName = "github" | "gitlab"
  export type ReviewOptions = {
    pr: number
    repo: string
    provider?: ProviderName
    token?: string
    reviewerCount?: number
  }
  export type ReviewComment = ReviewV2.ValidatedFinding
  export type ReviewResult = ReviewV2.Report & {
    pr: number
    provider: ProviderName
    comments: ReviewComment[]
    stats: Record<"total" | "p0" | "p1" | "p2" | "p3" | "invalid", number>
  }
  export type ReviewExecutor = (assignment: ReviewV2.DiffChunk, index: number) => Promise<ReviewV2.ReviewerResult>

  export async function getGitHubPRDiff(repo: string, pr: number, token?: string): Promise<string> {
    return fetchText(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
      Accept: "application/vnd.github.v3.diff",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    })
  }

  export async function getGitLabMRDiff(repo: string, mr: number, token?: string): Promise<string> {
    const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/merge_requests/${mr}/changes`
    const response = await fetch(url, { headers: token ? { "PRIVATE-TOKEN": token } : undefined })
    if (!response.ok) throw new Error(`GitLab diff request failed (${response.status} ${response.statusText})`)
    const payload = (await response.json()) as {
      changes?: Array<{ old_path: string; new_path: string; diff: string; new_file?: boolean; deleted_file?: boolean }>
    }
    if (!Array.isArray(payload.changes)) throw new Error("GitLab diff response did not contain changes")
    return payload.changes
      .map((change) =>
        [
          `diff --git a/${change.old_path} b/${change.new_path}`,
          `--- ${change.new_file ? "/dev/null" : `a/${change.old_path}`}`,
          `+++ ${change.deleted_file ? "/dev/null" : `b/${change.new_path}`}`,
          change.diff,
        ].join("\n"),
      )
      .join("\n")
  }

  export async function reviewDiff(input: {
    diff: string
    pr: number
    provider: ProviderName
    reviewerCount?: number
    execute?: ReviewExecutor
  }): Promise<ReviewResult> {
    const chunks = ReviewV2.chunkUnifiedDiff(input.diff)
    const sources = ReviewV2.parseUnifiedDiff(input.diff)
    const files = [...sources.keys()]
    if (chunks.length === 0 || files.length === 0) return toResult(emptyReport(), input.pr, input.provider)

    const requested = Math.max(1, Math.min(input.reviewerCount ?? DEFAULT_REVIEWERS, MAX_PARALLEL_REVIEWERS))
    const assignments =
      chunks.length === 1
        ? Array.from({ length: requested }, (_, index) => ({
            ...chunks[0],
            id: `${chunks[0].id}-reviewer-${index + 1}`,
          }))
        : chunks
    let parent: Session.Info | undefined
    try {
      let execute = input.execute
      if (!execute) {
        parent = await Session.create({ title: `Review V2 ${input.provider} #${input.pr}` })
        const agent = await Agent.get("reviewer")
        if (!agent) throw new Error("Reviewer agent not found")
        const fallback = await Provider.defaultModel()
        const model = await Provider.getModel(fallback.providerID, fallback.modelID)
        execute = async (assignment, index) => {
          const prompt = ReviewV2.formatPrompt({
            target: `${input.provider} change #${input.pr}, chunk ${assignment.id}, files: ${assignment.files.join(", ")}`,
            diff: assignment.content,
            instructions:
              "This is a remote review. Do not claim test execution unless the checked-out workspace matches the supplied diff. Review every line in this bounded chunk.",
          })
          const result = await SubAgent.spawn({
            parentSessionID: parent!.id,
            agent,
            model: { providerID: model.providerID, modelID: model.id },
            permissions: SubAgent.buildFromAgent(agent),
            parts: [{ type: "text", text: prompt }],
            description: `Review V2 ${assignment.id}`,
            outputSchema: ReviewV2.OutputSchema,
            validationMode: "strict",
          })
          return { reviewer: `${assignment.id}-${index + 1}`, output: result.structuredOutput }
        }
      }
      const results = await runBounded(assignments, requested, execute)
      return toResult(ReviewV2.aggregate({ results, sources, allowedFiles: files }), input.pr, input.provider)
    } finally {
      if (parent) await Session.remove(parent.id).catch(() => undefined)
    }
  }

  export async function review(options: ReviewOptions): Promise<ReviewResult> {
    const provider = options.provider ?? "github"
    log.info("starting structured review", { pr: options.pr, repo: options.repo, provider })
    const diff =
      provider === "github"
        ? await getGitHubPRDiff(options.repo, options.pr, options.token)
        : await getGitLabMRDiff(options.repo, options.pr, options.token)
    return reviewDiff({ diff, pr: options.pr, provider, reviewerCount: options.reviewerCount })
  }

  export async function postReview(repo: string, pr: number, result: ReviewResult, token?: string): Promise<void> {
    if (result.provider === "gitlab") {
      const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/merge_requests/${pr}/notes`
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "PRIVATE-TOKEN": token } : {}) },
        body: JSON.stringify({ body: formatSummary(result) }),
      })
      if (!response.ok) throw new Error(`GitLab review post failed (${response.status} ${response.statusText})`)
      return
    }

    const baseUrl = `https://api.github.com/repos/${repo}/pulls/${pr}`
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
    const summary = await fetch(`${baseUrl}/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        body: formatSummary(result),
        event: result.verdict === "rejected" ? "REQUEST_CHANGES" : "COMMENT",
      }),
    })
    if (!summary.ok) throw new Error(`GitHub review post failed (${summary.status} ${summary.statusText})`)

    for (const comment of result.comments) {
      const response = await fetch(`${baseUrl}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: comment.file,
          line: comment.endLine,
          side: "RIGHT",
          body: formatFinding(comment),
        }),
      })
      if (!response.ok) {
        log.warn("GitHub line comment was rejected", {
          file: comment.file,
          line: comment.endLine,
          status: response.status,
        })
      }
    }
  }

  function toResult(report: ReviewV2.Report, pr: number, provider: ProviderName): ReviewResult {
    return {
      ...report,
      pr,
      provider,
      comments: report.findings,
      stats: {
        total: report.findings.length,
        p0: report.findings.filter((finding) => finding.severity === "P0").length,
        p1: report.findings.filter((finding) => finding.severity === "P1").length,
        p2: report.findings.filter((finding) => finding.severity === "P2").length,
        p3: report.findings.filter((finding) => finding.severity === "P3").length,
        invalid: report.rejectedFindings.length,
      },
    }
  }

  function emptyReport(): ReviewV2.Report {
    return {
      verdict: "passed",
      summary: "The change contains no reviewable text hunks.",
      findings: [],
      rejectedFindings: [],
      reviewers: [],
    }
  }

  function formatSummary(result: ReviewResult) {
    const lines = [
      `## AtomCLI Review V2: ${result.verdict.toUpperCase()}`,
      "",
      result.summary,
      "",
      `Validated findings: ${result.stats.total} (P0 ${result.stats.p0}, P1 ${result.stats.p1}, P2 ${result.stats.p2}, P3 ${result.stats.p3})`,
      `Rejected invalid findings: ${result.stats.invalid}`,
    ]
    if (result.comments.length > 0) lines.push("", ...result.comments.map(formatFinding))
    return lines.join("\n")
  }

  function formatFinding(finding: ReviewComment) {
    return `**${finding.severity}** ${finding.file}:${finding.startLine}-${finding.endLine} — ${finding.title} (confidence ${finding.confidence.toFixed(2)})\n\n${finding.recommendation}`
  }

  async function fetchText(url: string, headers: Record<string, string>) {
    const response = await fetch(url, { headers })
    if (!response.ok) throw new Error(`Review diff request failed (${response.status} ${response.statusText})`)
    return response.text()
  }

  async function runBounded<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next++
        if (index >= items.length) return
        try {
          results[index] = await fn(items[index], index)
        } catch (error) {
          results[index] = {
            reviewer: `reviewer-${index + 1}`,
            error: error instanceof Error ? error.message : String(error),
          } as R
        }
      }
    })
    await Promise.all(workers)
    return results
  }
}

export const ReviewCommand = cmd({
  command: "review",
  describe: "Run a structured review of a GitHub pull request or GitLab merge request",
  builder: (yargs) =>
    yargs
      .option("pr", { type: "number", alias: "p", describe: "Pull/merge request number", demandOption: true })
      .option("repo", { type: "string", alias: "r", describe: "Repository (owner/repo)", demandOption: true })
      .option("provider", { type: "string", choices: ["github", "gitlab"], default: "github" })
      .option("diff-only", { type: "boolean", alias: "d", describe: "Do not post the review", default: false })
      .option("token", { type: "string", alias: "t", describe: "GitHub/GitLab access token" })
      .option("reviewers", { type: "number", describe: "Maximum parallel reviewers (1-4)", default: DEFAULT_REVIEWERS })
      .option("output", { type: "string", alias: "o", describe: "Write the structured report to a file" }),
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const result = await CodeReview.review({
          pr: args.pr,
          repo: args.repo,
          provider: args.provider as CodeReview.ProviderName,
          token: args.token,
          reviewerCount: args.reviewers,
        })
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        if (args.output) await fs.writeFile(args.output, JSON.stringify(result, null, 2), "utf8")
        if (!args.diffOnly) await CodeReview.postReview(args.repo, args.pr, result, args.token)
        if (result.verdict !== "passed") process.exitCode = 1
      },
    })
  },
})
