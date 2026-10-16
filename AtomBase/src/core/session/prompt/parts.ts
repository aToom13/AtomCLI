import fs from "fs/promises"
import os from "os"
import path from "path"
import { Agent } from "@/integrations/agent/agent"
import { Skill } from "@/integrations/skill"
import { ConfigMarkdown } from "@/core/config/markdown"

export async function resolvePromptParts(template: string, worktree: string): Promise<any[]> {
  const parts: any[] = [{ type: "text", text: template }]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      if (seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/") ? path.join(os.homedir(), name.slice(2)) : path.resolve(worktree, name)
      const stats = await fs.stat(filepath).catch(() => undefined)
      if (!stats) {
        const skill = await Skill.get(name)
        if (skill) {
          const parsed = await ConfigMarkdown.parse(skill.location)
          parts.push({ type: "text", text: `\n<skill name="${skill.name}">\n${parsed.content.trim()}\n</skill>\n` })
          return
        }
        const agent = await Agent.get(name)
        if (agent) parts.push({ type: "agent", name: agent.name })
        return
      }
      if (stats.isDirectory()) {
        parts.push({ type: "file", url: `file://${filepath}`, filename: name, mime: "application/x-directory" })
        return
      }
      parts.push({ type: "file", url: `file://${filepath}`, filename: name, mime: "text/plain" })
    }),
  )
  return parts
}
