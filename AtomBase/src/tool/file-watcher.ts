import z from "zod"
import { Tool } from "./tool"
import * as fs from "fs"
import * as path from "path"

const DESCRIPTION = `File system watcher tool.

Provides:
- Watch files and directories for changes
- List recent file modifications
- Monitor file system events (create, modify, delete)

**USE CASES:**
- Monitor project files for changes during development
- Detect when files are modified by external processes
- Track file system activity

**ACTIONS:**
- "recent": List recently modified files in a directory
- "watch": Start watching a directory (returns immediately, logs changes)
- "changes": Get list of files changed since last check

**NOTE:** This tool does not persist watch state between calls.
For continuous monitoring, use the "recent" action periodically.`

export const FileWatcherTool = Tool.define("file_watcher", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["recent", "watch", "changes"]).describe("The action to perform"),
    path: z.string().optional().describe("Directory or file to watch (default: current project)"),
    since_minutes: z.number().optional().describe("For 'recent': show files modified in last N minutes (default: 5)"),
    pattern: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts')"),
  }),
  async execute(params, ctx) {
    const watchPath = params.path || process.cwd()
    const sinceMinutes = params.since_minutes || 5

    switch (params.action) {
      case "recent": {
        let output = `## Recently Modified Files\n`
        output += `Path: ${watchPath}\n`
        output += `Within last: ${sinceMinutes} minutes\n\n`

        try {
          const cutoffTime = Date.now() - sinceMinutes * 60 * 1000
          const recentFiles: { path: string; modified: Date; size: number }[] = []

          const scanDir = (dir: string) => {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true })
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name)

                // Skip hidden and common ignore directories
                if (
                  entry.name.startsWith(".") ||
                  ["node_modules", "dist", "build", "__pycache__", ".git"].includes(entry.name)
                ) {
                  continue
                }

                if (entry.isDirectory()) {
                  scanDir(fullPath)
                } else if (entry.isFile()) {
                  try {
                    const stats = fs.statSync(fullPath)
                    if (stats.mtimeMs > cutoffTime) {
                      // Apply pattern filter if specified
                      if (params.pattern) {
                        const regex = new RegExp(params.pattern.replace("*", ".*"))
                        if (!regex.test(entry.name)) continue
                      }
                      recentFiles.push({
                        path: fullPath,
                        modified: stats.mtime,
                        size: stats.size,
                      })
                    }
                  } catch {}
                }
              }
            } catch {}
          }

          if (fs.existsSync(watchPath)) {
            scanDir(watchPath)
          }

          // Sort by modification time, newest first
          recentFiles.sort((a, b) => b.modified.getTime() - a.modified.getTime())

          if (recentFiles.length === 0) {
            output += "No recently modified files found.\n"
          } else {
            output += "| File | Modified | Size |\n"
            output += "|------|----------|------|\n"
            for (const file of recentFiles.slice(0, 50)) {
              // Limit to 50 files
              const relPath = path.relative(watchPath, file.path)
              const timeAgo = Math.floor((Date.now() - file.modified.getTime()) / 1000)
              const timeStr =
                timeAgo < 60
                  ? `${timeAgo}s ago`
                  : timeAgo < 3600
                    ? `${Math.floor(timeAgo / 60)}m ago`
                    : `${Math.floor(timeAgo / 3600)}h ago`
              output += `| ${relPath} | ${timeStr} | ${(file.size / 1024).toFixed(1)}KB |\n`
            }
            output += `\n**Total:** ${recentFiles.length} files\n`
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}\n`
        }

        return {
          title: "Recent Files",
          output,
          metadata: {},
        }
      }

      case "watch": {
        let output = `## File Watch Started\n\n`
        output += `Path: ${watchPath}\n`
        output += `Duration: 5 seconds (sample)\n\n`

        try {
          if (!fs.existsSync(watchPath)) {
            return {
              title: "Error",
              output: `Path does not exist: ${watchPath}`,
              metadata: {},
            }
          }

          const changes: { event: string; file: string; time: Date }[] = []

          // Watch for 5 seconds as a sample
          const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
            if (filename) {
              changes.push({
                event: eventType,
                file: filename,
                time: new Date(),
              })
            }
          })

          // Wait 5 seconds
          await new Promise((resolve) => setTimeout(resolve, 5000))
          watcher.close()

          if (changes.length === 0) {
            output += "No changes detected in 5 seconds.\n"
          } else {
            output += "**Changes detected:**\n"
            output += "| Time | Event | File |\n"
            output += "|------|-------|------|\n"
            for (const change of changes.slice(0, 20)) {
              output += `| ${change.time.toISOString().split("T")[1].slice(0, 8)} | ${change.event} | ${change.file} |\n`
            }
            if (changes.length > 20) {
              output += `\n... and ${changes.length - 20} more changes\n`
            }
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}\n`
        }

        return {
          title: "File Watch",
          output,
          metadata: {},
        }
      }

      case "changes": {
        // This action returns files that changed recently (alias for recent with 1 minute)
        const quickCheckPath = params.path || process.cwd()
        let output = `## Quick Change Check\n\n`

        try {
          const cutoffTime = Date.now() - 60000 // 1 minute
          const changedFiles: string[] = []

          const quickScan = (dir: string, depth: number = 0) => {
            if (depth > 5) return // Limit depth
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true })
              for (const entry of entries) {
                if (entry.name.startsWith(".") || ["node_modules", "dist", "build", ".git"].includes(entry.name)) {
                  continue
                }
                const fullPath = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                  quickScan(fullPath, depth + 1)
                } else {
                  const stats = fs.statSync(fullPath)
                  if (stats.mtimeMs > cutoffTime) {
                    changedFiles.push(path.relative(quickCheckPath, fullPath))
                  }
                }
              }
            } catch {}
          }

          quickScan(quickCheckPath)

          if (changedFiles.length === 0) {
            output += "No changes in the last minute.\n"
          } else {
            output += `Found ${changedFiles.length} recently changed files:\n`
            for (const file of changedFiles) {
              output += `- ${file}\n`
            }
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}\n`
        }

        return {
          title: "Changes Check",
          output,
          metadata: {},
        }
      }
    }
  },
})
