import type { WorkflowState } from "./state"
import { WorkflowBlackboard } from "@/core/orchestration/blackboard"

export const AGENT_RESULT_CONTRACT = `At the end, include one machine-readable block using this exact shape (valid JSON, no comments):
<agent_result>{"status":"complete","summary":"...","facts":[{"key":"stable-key","value":"...","evidence":["file:line or command"]}],"decisions":[{"key":"stable-key","value":"...","evidence":["..."]}],"constraints":[],"openQuestions":[],"editedFiles":[],"tests":[],"failures":[],"confidence":0.0}</agent_result>
Types are strict: summary is a string; facts and decisions are arrays of strings or objects {key?: string, value: string, evidence?: string[]}; constraints, openQuestions, editedFiles, tests, and failures are arrays of strings only. Never put diagnostic objects in tests or failures. Put non-blocking diagnostics in facts or constraints; use failures for unfinished work only.
Use status "incomplete" or "blocked" when requested work is unfinished; put concrete problems in failures. Never report status "complete" while a required check fails.
Use confidence between 0 and 1. Keep the normal human-readable answer before the block.`

export const REVIEW_RESULT_CONTRACT = `${AGENT_RESULT_CONTRACT}
For a read-only review, status describes whether the inspection is finished, not whether the product passes. Put product defects in a separate findings array and set productVerdict to "passed", "rejected", or "inconclusive". A completed inspection may reject the product while status is "complete" and failures is empty. Use failures only for unfinished inspection or unavailable evidence. Return findings to the editing agent; do not try to fix files.`

type AgentResultReport = Record<string, unknown> & { status?: unknown; failures?: unknown }

export class AgentResultValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentResultValidationError"
  }
}

export function parseAgentResult(output: string): AgentResultReport | undefined {
  const blocks = [...output.matchAll(/<agent_result>\s*([\s\S]*?)\s*<\/agent_result>/gi)]
  if (blocks.length === 0) return undefined
  if (blocks.length !== 1) throw new AgentResultValidationError("Agent task requires exactly one agent_result block")
  let result: unknown
  try {
    result = JSON.parse(blocks[0][1])
  } catch {
    throw new AgentResultValidationError("Agent task returned invalid agent_result JSON")
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AgentResultValidationError("Agent task returned invalid agent_result object")
  }
  const parsed = WorkflowBlackboard.StructuredResult.safeParse(result)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AgentResultValidationError(`Agent task agent_result.${issue.path.join(".")} invalid: ${issue.message}`)
  }
  return result as AgentResultReport
}

/** Reject an explicitly incomplete child result without requiring legacy read-only agents to emit the block. */
export function checkAgentResultStatus(output: string) {
  const report = parseAgentResult(output)
  if (!report) return
  if (report.status !== "complete") {
    const failures = Array.isArray(report.failures) ? report.failures.filter((item) => typeof item === "string") : []
    throw new Error(`Agent task incomplete: ${failures.join("; ") || String(report.status ?? "status missing")}`)
  }
  if (Array.isArray(report.failures) && report.failures.some((item) => typeof item === "string" && item.trim())) {
    throw new Error(
      `Agent task reported failures: ${report.failures.filter((item): item is string => typeof item === "string").join("; ")}`,
    )
  }
}

export function checkEditedTaskResult(output: string) {
  const report = parseAgentResult(output)
  if (!report) throw new AgentResultValidationError("Edited task requires exactly one agent_result block")
  if (!Array.isArray(report.failures) || report.failures.some((item) => typeof item !== "string")) {
    throw new AgentResultValidationError("Edited task agent_result.failures must be a string array")
  }
  if (report.status !== "complete" || report.failures.length > 0) {
    throw new Error(
      `Edited task incomplete: ${report.failures.join("; ") || String(report.status ?? "status missing")}`,
    )
  }
}

export function humanOutput(output: string) {
  return output
    .replace(/<agent_result>\s*[\s\S]*?\s*<\/agent_result>/gi, "")
    .replace(/```agent-result\s*[\s\S]*?```/gi, "")
    .replace(/<structured_output>\s*[\s\S]*?\s*<\/structured_output>/gi, "")
    .trim()
}

export function formatWorkflowOutput(workflow: WorkflowState): string {
  const parts = [
    `## Workflow Results: ${workflow.id}`,
    `**Status:** ${workflow.status}`,
    `**Total Tasks:** ${workflow.tasks.length}`,
    "",
  ]
  if (workflow.error) parts.push(`**Workflow Error:** ${workflow.error}`, "")
  for (const task of workflow.tasks) {
    const result = workflow.results[task.id]
    const status = { pending: "⏳", running: "🔄", completed: "✅", failed: "❌", skipped: "⏭️", unknown: "❓" }[
      result.status
    ]
    parts.push(`### ${status ?? "❓"} ${task.id} (@${task.agent}) [${task.category}]`)
    if (result.error) parts.push("", `**Error:** ${result.error}`)
    if (result.review) parts.push("", `**Independent Review:** ${result.review.status}: ${result.review.summary}`)
    if (result.output) parts.push("", result.output)
    if (result.structuredOutput !== undefined) {
      parts.push("", "**Structured Result:**", "```json", JSON.stringify(result.structuredOutput, null, 2), "```")
    }
    if (result.structuredError) {
      parts.push("", `**Structured Error:** ${result.structuredError.code}: ${result.structuredError.message}`)
    }
    parts.push("", "---")
  }
  const count = (status: string) => workflow.tasks.filter((task) => workflow.results[task.id].status === status).length
  parts.push(
    `**${count("completed")} succeeded, ${count("failed")} failed, ${count("skipped")} skipped, ${count("unknown")} unknown (${workflow.tasks.length} total)**`,
  )
  return parts.join("\n")
}
