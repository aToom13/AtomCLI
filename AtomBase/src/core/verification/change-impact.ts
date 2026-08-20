import { Instance } from "@/services/project/instance"
import path from "path"
import fs from "fs/promises"

export namespace ChangeImpact {
  export type Level = "low" | "medium" | "high"
  export interface Report {
    level: Level
    score: number
    reasons: string[]
    suggestedTests: string[]
  }

  export function analyze(input: { files?: string[]; diff?: string; prompt?: string }): Report {
    const files = input.files ?? []
    const diff = input.diff ?? ""
    const text = `${files.join("\n")}\n${input.prompt ?? ""}\n${diff}`
    const reasons: string[] = []
    let score = files.length > 0 ? 1 : 0
    const add = (points: number, reason: string) => {
      score += points
      reasons.push(reason)
    }

    if (/(^|\/)(auth|security|permission)|credential|secret/i.test(text))
      add(5, "authentication, secrets, or permissions changed")
    if (/(^|\/)server\/routes\/|\b(route|endpoint|public api)\b/i.test(text))
      add(4, "public route or API surface changed")
    if (/migration|schema|CREATE TABLE|ALTER TABLE/i.test(text)) add(5, "persistent schema or migration changed")
    if (/package\.json|bun\.lock|workspace|dependency/i.test(text)) add(3, "dependency or workspace metadata changed")
    if (/\.github\/workflows|release|Dockerfile/i.test(text)) add(4, "release or deployment path changed")
    if (/^-\s*(?:if|throw|return).*?(?:auth|permission|validate|sanitize|check)/im.test(diff))
      add(5, "a validation or guard branch was removed")
    if (/^[-+]\s*export\s+(?:async\s+)?(?:function|class|const|type|interface)/m.test(diff))
      add(3, "exported contract changed")
    if (/^[-+]\s*(?:app\.|router\.|server\.).*?(?:get|post|put|patch|delete)\s*\(/m.test(diff))
      add(4, "HTTP endpoint behavior changed")
    if (files.length >= 8) add(2, "wide multi-file change")
    const packages = new Set(files.map((file) => file.split("/")[0]).filter(Boolean))
    if (packages.size >= 3) add(2, "change crosses multiple package boundaries")

    const sourceFiles = files.filter((file) => !/\.(test|spec)\.|(^|\/)test(s)?\//i.test(file))
    const testFiles = files.filter((file) => /\.(test|spec)\.|(^|\/)test(s)?\//i.test(file))
    if (sourceFiles.length > 2 && testFiles.length === 0)
      add(2, "multiple source files changed without a matching test edit")

    const suggestedTests = [
      ...new Set(
        sourceFiles.flatMap((file) => {
          const stem = file
            .replace(/\.[^.\/]+$/, "")
            .split("/")
            .pop()
          return stem ? [`${stem}.test`, `${stem}.spec`] : []
        }),
      ),
    ].slice(0, 12)

    return { level: score >= 6 ? "high" : score >= 2 ? "medium" : "low", score, reasons, suggestedTests }
  }

  export async function diff(files: string[]) {
    if (files.length === 0 || Instance.project.vcs !== "git") return ""
    const selected = files.slice(0, 200)
    const git = async (args: string[]) => {
      const proc = Bun.spawn(["git", ...args], {
        cwd: Instance.directory,
        stdout: "pipe",
        stderr: "ignore",
      })
      const output = await Bun.readableStreamToText(proc.stdout)
      await proc.exited
      return output
    }
    const [working, staged, untrackedList] = await Promise.all([
      git(["diff", "--no-ext-diff", "--unified=0", "--", ...selected]),
      git(["diff", "--cached", "--no-ext-diff", "--unified=0", "--", ...selected]),
      git(["ls-files", "--others", "--exclude-standard", "--", ...selected]),
    ])
    const untracked: string[] = []
    for (const relative of untrackedList.split("\n").filter(Boolean).slice(0, 50)) {
      const absolute = path.resolve(Instance.directory, relative)
      if (!absolute.startsWith(`${path.resolve(Instance.directory)}${path.sep}`)) continue
      const stat = await fs.lstat(absolute).catch(() => undefined)
      if (!stat?.isFile() || stat.isSymbolicLink()) continue
      const file = Bun.file(absolute)
      if (!(await file.exists()) || file.size > 50_000) continue
      const content = await file.text().catch(() => "")
      if (content.includes("\0")) continue
      untracked.push(
        [
          `diff --git a/${relative} b/${relative}`,
          "new file mode 100644",
          "--- /dev/null",
          `+++ b/${relative}`,
          ...content
            .split("\n")
            .slice(0, 1_000)
            .map((line) => `+${line}`),
        ].join("\n"),
      )
    }
    return [working, staged, ...untracked].filter(Boolean).join("\n").slice(0, 100_000)
  }
}
