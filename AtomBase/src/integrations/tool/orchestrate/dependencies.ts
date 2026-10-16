import { escapeXmlText } from "@/core/session/harness-state"
import { WorkflowBlackboard } from "@/core/orchestration/blackboard"
import {
  MAX_DEPENDENCY_CONTEXT_BYTES,
  MAX_TASK_OUTPUT_BYTES,
  type TaskNode,
  type WorkflowState,
} from "./state"

export function limitText(value: string, maxBytes = MAX_TASK_OUTPUT_BYTES): string {
  const data = Buffer.from(value)
  if (data.byteLength <= maxBytes) return value
  const marker = Buffer.from("\n\n... output preview truncated; full output is in .atomcli/runs/ ...")
  const suffix = marker.byteLength > maxBytes ? marker.subarray(0, maxBytes) : marker
  return `${data.subarray(0, Math.max(0, maxBytes - suffix.byteLength)).toString("utf8")}${suffix.toString("utf8")}`
}

/** Return every upstream dependency once, oldest ancestor first. */
export function dependencyIds(task: TaskNode, tasks: TaskNode[]): string[] {
  const byID = new Map(tasks.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const ordered: string[] = []

  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const dependency = byID.get(id)
    for (const parent of dependency?.dependsOn ?? []) visit(parent)
    ordered.push(id)
  }

  for (const id of task.dependsOn) visit(id)
  return ordered
}

export function buildDependencyContext(task: TaskNode, workflow: WorkflowState): string {
  const direct = new Set(task.dependsOn)
  const allArtifacts: WorkflowBlackboard.Artifact[] = []
  const context = dependencyIds(task, workflow.tasks)
    .map((dependencyID) => {
      const structuredOutput = workflow.results[dependencyID]?.structuredOutput
      const output =
        structuredOutput === undefined ? workflow.results[dependencyID]?.output : JSON.stringify(structuredOutput)
      if (!output) return ""
      const relation = direct.has(dependencyID) ? "direct" : "upstream"
      const extracted = workflow.results[dependencyID]?.artifacts ?? WorkflowBlackboard.fromOutput(dependencyID, output)
      allArtifacts.push(...extracted)
      const artifacts = WorkflowBlackboard.render(extracted)
      const tag = structuredOutput === undefined ? "dependency_artifacts" : "dependency_structured_result"
      return `<${tag} task="${escapeXmlText(dependencyID)}" relation="${relation}">\n${escapeXmlText(
        structuredOutput === undefined ? artifacts : JSON.stringify(structuredOutput),
      )}\n</${tag}>`
    })
    .filter(Boolean)
    .join("\n\n")
  const conflicts = WorkflowBlackboard.conflicts(allArtifacts)
  const conflictContext = conflicts.length
    ? `\n\n<dependency_conflicts>\n${conflicts
        .map((conflict) =>
          escapeXmlText(
            `${conflict.key}: ${conflict.artifacts.map((item) => `${item.taskID}=${item.content}`).join(" <> ")}`,
          ),
        )
        .join("\n")}\n</dependency_conflicts>`
    : ""
  return limitText(context + conflictContext, MAX_DEPENDENCY_CONTEXT_BYTES)
}
