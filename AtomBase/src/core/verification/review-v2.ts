import path from "path"
import fs from "fs/promises"
import z from "zod"
import type { SubAgentRuntime } from "@/integrations/tool/subagent-runtime"

const MAX_FINDINGS_PER_REVIEWER = 100
const MAX_REJECTED_FINDINGS = 200
const MAX_DIFF_CHUNK_LINES = 320
const MAX_DIFF_CHUNK_BYTES = 24_000
const MAX_FILE_BYTES = 2 * 1024 * 1024

export namespace ReviewV2 {
  export const Severity = z.enum(["P0", "P1", "P2", "P3"])
  export type Severity = z.infer<typeof Severity>

  export const Finding = z.object({
    file: z.string().min(1).max(1_000),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    severity: Severity,
    confidence: z.number().min(0).max(1),
    title: z.string().min(1).max(500),
    evidence: z.string().min(1).max(4_000),
    recommendation: z.string().max(4_000),
  })
  export type Finding = z.infer<typeof Finding>

  export const ReviewerOutput = z.object({
    verdict: z.enum(["passed", "rejected", "inconclusive"]),
    summary: z.string().min(1).max(4_000),
    findings: z.array(Finding).max(MAX_FINDINGS_PER_REVIEWER),
  })
  export type ReviewerOutput = z.infer<typeof ReviewerOutput>

  export const OutputSchema: SubAgentRuntime.OutputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "findings"],
    properties: {
      verdict: { type: "string", enum: ["passed", "rejected", "inconclusive"] },
      summary: { type: "string", minLength: 1, maxLength: 4_000 },
      findings: {
        type: "array",
        maxItems: MAX_FINDINGS_PER_REVIEWER,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["file", "startLine", "endLine", "severity", "confidence", "title", "evidence", "recommendation"],
          properties: {
            file: { type: "string", minLength: 1, maxLength: 1_000 },
            startLine: { type: "integer", minimum: 1 },
            endLine: { type: "integer", minimum: 1 },
            severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            title: { type: "string", minLength: 1, maxLength: 500 },
            evidence: { type: "string", minLength: 1, maxLength: 4_000 },
            recommendation: { type: "string", maxLength: 4_000 },
          },
        },
      },
    },
  }

  export type SourceFile = {
    path: string
    lines: Map<number, string>
    lineCount?: number
    changedRanges?: Array<{ startLine: number; endLine: number }>
  }

  export type ReviewerResult = {
    reviewer: string
    output?: unknown
    error?: string
  }

  export type ValidatedFinding = Finding & {
    reviewers: string[]
  }

  export type RejectedFinding = {
    reviewer: string
    finding?: unknown
    reason: string
  }

  export type Report = {
    verdict: "passed" | "rejected" | "inconclusive"
    summary: string
    findings: ValidatedFinding[]
    rejectedFindings: RejectedFinding[]
    reviewers: Array<{
      reviewer: string
      verdict?: ReviewerOutput["verdict"]
      summary?: string
      error?: string
    }>
  }

  export type DiffChunk = {
    id: string
    files: string[]
    content: string
  }

  export function parseUnifiedDiff(diff: string): Map<string, SourceFile> {
    const files = new Map<string, SourceFile>()
    let current: SourceFile | undefined
    let newLine = 0
    let inHunk = false

    for (const rawLine of diff.split("\n")) {
      if (rawLine.startsWith("diff --git ")) {
        current = undefined
        inHunk = false
        continue
      }
      if (rawLine.startsWith("+++ ")) {
        const rawPath = rawLine.slice(4).trim()
        if (rawPath === "/dev/null") {
          current = undefined
          continue
        }
        const normalized = normalizeRelativePath(rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath)
        if (!normalized) {
          current = undefined
          continue
        }
        current = files.get(normalized) ?? { path: normalized, lines: new Map(), changedRanges: [] }
        files.set(normalized, current)
        continue
      }
      const hunk = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/)
      if (hunk && current) {
        newLine = Number(hunk[1])
        inHunk = true
        continue
      }
      if (!current || !inHunk || rawLine.startsWith("\\ No newline")) continue
      if (rawLine.startsWith("-")) continue
      if (rawLine.startsWith("+") || rawLine.startsWith(" ")) {
        current.lines.set(newLine, rawLine.slice(1))
        if (rawLine.startsWith("+")) addRange(current.changedRanges!, newLine)
        current.lineCount = Math.max(current.lineCount ?? 0, newLine)
        newLine++
      }
    }
    return files
  }

  export function chunkUnifiedDiff(diff: string): DiffChunk[] {
    if (!diff.trim()) return []
    const chunks: DiffChunk[] = []
    let current: string[] = []
    let currentFiles = new Set<string>()
    let bytes = 0
    let activeFile = ""
    let activeNewLine = 0
    let inHunk = false

    const append = (line: string) => {
      current.push(line)
      bytes += Buffer.byteLength(line) + 1
      if (activeFile) currentFiles.add(activeFile)
    }

    const flush = () => {
      if (current.length === 0) return
      chunks.push({
        id: `diff-${chunks.length + 1}`,
        files: [...currentFiles],
        content: current.join("\n"),
      })
      current = []
      currentFiles = new Set<string>()
      bytes = 0
    }

    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) inHunk = false
      const nextFile = line.startsWith("+++ b/") ? normalizeRelativePath(line.slice(6).trim()) : undefined
      if (nextFile) activeFile = nextFile
      const hunk = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (hunk) {
        activeNewLine = Number(hunk[1])
        inHunk = true
      }
      const lineBytes = Buffer.byteLength(line) + 1
      if (current.length > 0 && (current.length >= MAX_DIFF_CHUNK_LINES || bytes + lineBytes > MAX_DIFF_CHUNK_BYTES)) {
        flush()
        if (activeFile && inHunk && !line.startsWith("@@") && !line.startsWith("diff --git ")) {
          append(`diff --git a/${activeFile} b/${activeFile}`)
          append(`+++ b/${activeFile}`)
          append(`@@ -0,0 +${activeNewLine},0 @@ continued`)
        }
      }
      append(line)
      if (inHunk && (line.startsWith("+") || line.startsWith(" ")) && !line.startsWith("+++")) activeNewLine++
    }
    flush()
    return chunks
  }

  export async function loadWorkspaceSources(directory: string, files: string[]): Promise<Map<string, SourceFile>> {
    const root = path.resolve(directory)
    const sources = new Map<string, SourceFile>()
    for (const input of [...new Set(files)]) {
      const relative = normalizeRelativePath(input)
      if (!relative) continue
      const absolute = path.resolve(root, relative)
      if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue
      const stat = await fs.lstat(absolute).catch(() => undefined)
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue
      const content = await fs.readFile(absolute, "utf8").catch(() => undefined)
      if (content === undefined || content.includes("\0")) continue
      const lines = content.split("\n")
      sources.set(relative, {
        path: relative,
        lineCount: lines.length,
        lines: new Map(lines.map((line, index) => [index + 1, line])),
      })
    }
    return sources
  }

  export function mergeSources(primary: Map<string, SourceFile>, fallback: Map<string, SourceFile>) {
    const result = new Map(fallback)
    for (const [file, source] of primary) {
      const fallbackSource = fallback.get(file)
      result.set(file, {
        ...source,
        changedRanges: fallbackSource?.changedRanges ?? source.changedRanges,
      })
    }
    return result
  }

  export function aggregate(input: {
    results: ReviewerResult[]
    sources: Map<string, SourceFile>
    allowedFiles: string[]
  }): Report {
    const allowed = new Set(input.allowedFiles.map(normalizeRelativePath).filter((value): value is string => !!value))
    const valid: ValidatedFinding[] = []
    const rejected: RejectedFinding[] = []
    const reviewers: Report["reviewers"] = []
    let inconclusive = false

    for (const result of input.results) {
      if (result.error) {
        inconclusive = true
        reviewers.push({ reviewer: result.reviewer, error: result.error })
        continue
      }
      const parsed = ReviewerOutput.safeParse(result.output)
      if (!parsed.success) {
        inconclusive = true
        reviewers.push({ reviewer: result.reviewer, error: "reviewer output failed schema validation" })
        rejected.push({
          reviewer: result.reviewer,
          reason: parsed.error.issues[0]?.message ?? "invalid reviewer output",
        })
        continue
      }
      reviewers.push({ reviewer: result.reviewer, verdict: parsed.data.verdict, summary: parsed.data.summary })
      let acceptedForReviewer = 0
      let rejectedForReviewer = 0
      for (const finding of parsed.data.findings) {
        const reason = validateFinding(finding, input.sources, allowed)
        if (reason) {
          rejectedForReviewer++
          rejected.push({ reviewer: result.reviewer, finding, reason })
          continue
        }
        acceptedForReviewer++
        mergeFinding(valid, finding, result.reviewer)
      }
      if (
        parsed.data.verdict === "inconclusive" ||
        rejectedForReviewer > 0 ||
        (parsed.data.verdict === "rejected" && acceptedForReviewer === 0)
      ) {
        inconclusive = true
      }
    }

    const verdict = valid.length > 0 ? "rejected" : inconclusive || reviewers.length === 0 ? "inconclusive" : "passed"
    const counts = Object.fromEntries(
      Severity.options.map((severity) => [severity, valid.filter((f) => f.severity === severity).length]),
    )
    return {
      verdict,
      summary:
        verdict === "passed"
          ? `${reviewers.length} reviewer(s) found no validated issues.`
          : verdict === "inconclusive"
            ? `Review was inconclusive; ${rejected.length} invalid finding(s) or reviewer failure(s) were rejected.`
            : `${valid.length} validated issue(s): P0 ${counts.P0}, P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}.`,
      findings: valid.sort(compareFindings),
      rejectedFindings: rejected.slice(0, MAX_REJECTED_FINDINGS),
      reviewers,
    }
  }

  export function formatPrompt(input: {
    target: string
    originalRequest?: string
    diff?: string
    instructions?: string
  }) {
    const sections = [
      "Perform an evidence-based code review. Do not modify files.",
      `Review target: ${input.target}`,
      input.originalRequest ? `<original_request>\n${input.originalRequest}\n</original_request>` : "",
      input.diff ? `<bounded_diff_chunk>\n${input.diff}\n</bounded_diff_chunk>` : "",
      input.instructions ?? "",
      "Inspect the real file content around every reported range. For remote diffs, evidence must quote an exact line present in the supplied diff chunk.",
      "Only report issues caused by the reviewed change. Use P0 for catastrophic, P1 for high-priority, P2 for normal, and P3 for low-priority issues.",
      "Set confidence from 0 to 1. The evidence field must be an exact, concise source excerpt from startLine..endLine.",
      "Return verdict=rejected only with at least one concrete finding; use inconclusive when verification cannot be completed.",
    ]
    return sections.filter(Boolean).join("\n\n")
  }

  function validateFinding(
    finding: Finding,
    sources: Map<string, SourceFile>,
    allowed: Set<string>,
  ): string | undefined {
    const relative = normalizeRelativePath(finding.file)
    if (!relative || !allowed.has(relative)) return "file is outside the review scope"
    const source = sources.get(relative)
    if (!source) return "file content is unavailable or unsafe to read"
    if (finding.startLine > finding.endLine) return "startLine is after endLine"
    if (source.lineCount && finding.endLine > source.lineCount) return "line range exceeds the file length"
    const selected: string[] = []
    for (let line = finding.startLine; line <= finding.endLine; line++) {
      const content = source.lines.get(line)
      if (content !== undefined) selected.push(content)
    }
    if (selected.length === 0) return "line range is not present in the reviewed source"
    if (source.changedRanges?.length && !source.changedRanges.some((range) => overlaps(finding, range))) {
      return "line range does not overlap a changed line"
    }
    const evidence = normalizeEvidence(finding.evidence)
    const actual = normalizeEvidence(selected.join("\n"))
    if (evidence.length < 3 || !actual.includes(evidence)) return "evidence does not match the real source range"
    return undefined
  }

  function mergeFinding(findings: ValidatedFinding[], finding: Finding, reviewer: string) {
    const relative = normalizeRelativePath(finding.file)!
    const duplicate = findings.find(
      (candidate) =>
        candidate.file === relative &&
        overlaps(candidate, finding) &&
        (normalizeEvidence(candidate.evidence) === normalizeEvidence(finding.evidence) ||
          tokenSimilarity(
            `${candidate.title} ${candidate.recommendation}`,
            `${finding.title} ${finding.recommendation}`,
          ) >= 0.6),
    )
    if (!duplicate) {
      findings.push({ ...finding, file: relative, reviewers: [reviewer] })
      return
    }
    if (!duplicate.reviewers.includes(reviewer)) duplicate.reviewers.push(reviewer)
    duplicate.startLine = Math.min(duplicate.startLine, finding.startLine)
    duplicate.endLine = Math.max(duplicate.endLine, finding.endLine)
    duplicate.confidence = Math.max(duplicate.confidence, finding.confidence)
    if (severityRank(finding.severity) < severityRank(duplicate.severity)) duplicate.severity = finding.severity
  }

  function compareFindings(a: ValidatedFinding, b: ValidatedFinding) {
    return (
      severityRank(a.severity) - severityRank(b.severity) || a.file.localeCompare(b.file) || a.startLine - b.startLine
    )
  }

  function severityRank(severity: Severity) {
    return Severity.options.indexOf(severity)
  }

  function overlaps(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }) {
    return a.startLine <= b.endLine && b.startLine <= a.endLine
  }

  function addRange(ranges: Array<{ startLine: number; endLine: number }>, line: number) {
    const previous = ranges.at(-1)
    if (previous && previous.endLine + 1 === line) previous.endLine = line
    else ranges.push({ startLine: line, endLine: line })
  }

  function normalizeEvidence(value: string) {
    return value.replace(/\s+/g, " ").trim()
  }

  function tokenSimilarity(left: string, right: string) {
    const a = new Set(left.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    const b = new Set(right.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    if (a.size === 0 || b.size === 0) return 0
    const intersection = [...a].filter((token) => b.has(token)).length
    return intersection / (a.size + b.size - intersection)
  }

  function normalizeRelativePath(value: string): string | undefined {
    if (!value || value.includes("\0")) return undefined
    const slash = value.replaceAll("\\", "/").replace(/^\.\//, "")
    if (slash.startsWith("/") || /^[A-Za-z]:\//.test(slash)) return undefined
    const normalized = path.posix.normalize(slash)
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined
    return normalized
  }
}
