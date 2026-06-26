import fs from "fs/promises"
import path from "path"
import { Instance } from "@/services/project/instance"

/**
 * WorkflowFS — File-based workflow output management.
 *
 * Writes sub-agent results to `.atomcli/runs/wf_[id]/` so the parent LLM
 * is never woken up by `<system_notification>` injections.
 *
 * The root directory defaults to `Instance.worktree` but can be overridden
 * via `setRootDir()` for testing purposes.
 */
export namespace WorkflowFS {
  const RUNS_DIR = ".atomcli/runs"

  let _rootDirOverride: string | undefined

  /**
   * Override the project root directory (used in tests where
   * `Instance.worktree` is not available).
   */
  export function setRootDir(dir: string): void {
    _rootDirOverride = dir
  }

  /** Reset root dir override (restores Instance.worktree). */
  export function resetRootDir(): void {
    _rootDirOverride = undefined
  }

  function rootDir(): string {
    return _rootDirOverride ?? Instance.worktree
  }

  /**
   * Absolute path to the workflow run directory.
   * Example: `/project/root/.atomcli/runs/wf_1719000000000_abc123/`
   */
  export function getRunDir(workflowId: string): string {
    return path.join(rootDir(), RUNS_DIR, workflowId)
  }

  /**
   * Ensure the run directory exists, creating it recursively if needed.
   * Returns the absolute path to the directory.
   */
  export async function ensureRunDir(workflowId: string): Promise<string> {
    const dir = getRunDir(workflowId)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  /**
   * Write a success marker file for a completed task.
   * Returns the absolute path to the written file.
   */
  export async function writeSuccess(
    workflowId: string,
    taskId: string,
    agentType: string,
    output: string,
  ): Promise<string> {
    const dir = await ensureRunDir(workflowId)
    const filePath = path.join(dir, `${taskId}_${agentType}_success.md`)
    const content = [
      `# Task: ${taskId} (@${agentType})`,
      `**Status:** ✅ Success`,
      `**Completed At:** ${new Date().toISOString()}`,
      ``,
      `## Output`,
      ``,
      output,
    ].join("\n")
    await fs.writeFile(filePath, content, "utf-8")
    return filePath
  }

  /**
   * Write a failure marker file for a failed task.
   * When `originalOutput` is provided (e.g. QA failure after sub-agent succeeded),
   * it is included so the valuable output is not lost.
   * Returns the absolute path to the written file.
   */
  export async function writeFailed(
    workflowId: string,
    taskId: string,
    agentType: string,
    error: string,
    attempts?: number,
    originalOutput?: string,
  ): Promise<string> {
    const dir = await ensureRunDir(workflowId)
    const filePath = path.join(dir, `${taskId}_${agentType}_failed.md`)
    const parts: string[] = [
      `# Task: ${taskId} (@${agentType})`,
      `**Status:** ❌ Failed`,
      `**Attempts:** ${attempts ?? 1}`,
      `**Failed At:** ${new Date().toISOString()}`,
    ]

    if (originalOutput !== undefined) {
      parts.push(``)
      parts.push(`## Original Output`)
      parts.push(``)
      parts.push(originalOutput)
    }

    parts.push(``)
    parts.push(`## Error`)
    parts.push(``)
    parts.push("```")
    parts.push(error)
    parts.push("```")

    const content = parts.join("\n")
    await fs.writeFile(filePath, content, "utf-8")
    return filePath
  }

  /**
   * Check whether a workflow run directory exists on disk.
   */
  export async function exists(workflowId: string): Promise<boolean> {
    try {
      await fs.access(getRunDir(workflowId))
      return true
    } catch {
      return false
    }
  }

  /**
   * List all `.md` output files in a workflow run directory.
   * Returns an empty array if the directory does not exist.
   */
  export async function listFiles(workflowId: string): Promise<string[]> {
    const dir = getRunDir(workflowId)
    try {
      const entries = await fs.readdir(dir)
      return entries.filter((e) => e.endsWith(".md"))
    } catch {
      return []
    }
  }
}
