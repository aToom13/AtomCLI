import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"

const DESCRIPTION = `Screen capture and screenshot tool.

Provides:
- Take screenshots of entire screen or specific windows
- Save screenshots to specified location
- List available displays
- Support for different image formats

**USE CASES:**
- Document current screen state
- Capture error messages or UI issues
- Monitor running applications visually

**REQUIREMENTS:**
- gnome-screenshot (Linux/GNOME)
- scrot (alternative)
- Or similar screenshot utility

**ACTIONS:**
- "capture": Take a screenshot
- "displays": List available displays
- "windows": List available windows to capture`

export const ScreenCaptureTool = Tool.define("screen_capture", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["capture", "displays", "windows"]).describe("The action to perform"),
    output_path: z.string().optional().describe("Path to save screenshot (default: /tmp/screenshot-{timestamp}.png)"),
    window: z.boolean().optional().describe("Capture only the active window (default: false)"),
    display: z.string().optional().describe("Specific display to capture (e.g., ':0')"),
    delay: z.number().optional().describe("Delay in seconds before capturing (default: 0)"),
  }),
  async execute(params, ctx): Promise<any> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const defaultPath = `/tmp/screenshot-${timestamp}.png`
    const outputPath = params.output_path || defaultPath

    switch (params.action) {
      case "capture": {
        let cmd = ""

        // Try gnome-screenshot first
        try {
          if (params.window) {
            cmd = `gnome-screenshot -w -f "${outputPath}"`
          } else {
            cmd = `gnome-screenshot -f "${outputPath}"`
          }

          if (params.delay && params.delay > 0) {
            cmd += ` --delay=${params.delay}`
          }

          execSync(cmd, { encoding: "utf-8", timeout: 30000 })

          // Check if file was created
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath)
            return {
              title: "Screenshot Captured",
              output: `Screenshot saved to: ${outputPath}\nSize: ${(stats.size / 1024).toFixed(1)} KB`,
              metadata: { path: outputPath, size: stats.size, error: undefined },
            }
          }
        } catch (e) {
          // Try scrot as fallback
          try {
            cmd = params.window ? `scrot -u "${outputPath}"` : `scrot "${outputPath}"`

            if (params.delay && params.delay > 0) {
              cmd = params.window
                ? `scrot -u -d ${params.delay} "${outputPath}"`
                : `scrot -d ${params.delay} "${outputPath}"`
            }

            execSync(cmd, { encoding: "utf-8", timeout: 30000 })

            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath)
              return {
                title: "Screenshot Captured (scrot)",
                output: `Screenshot saved to: ${outputPath}\nSize: ${(stats.size / 1024).toFixed(1)} KB`,
                metadata: { path: outputPath, size: stats.size, error: undefined },
              }
            }
          } catch (scrotError) {
            return {
              title: "Screenshot Failed",
              output: `Failed to capture screenshot. Neither gnome-screenshot nor scrot available.\nError: ${(e as Error).message}`,
              metadata: { path: undefined, size: undefined, error: (e as Error).message },
            }
          }
        }

        return {
          title: "Screenshot Failed",
          output: "Failed to capture screenshot for unknown reason.",
          metadata: { path: undefined, size: undefined, error: "unknown" },
        }
      }

      case "displays": {
        let output = "## Available Displays\n\n"

        try {
          // Check DISPLAY environment variable
          const display = process.env.DISPLAY || "Not set"
          output += `Current DISPLAY: ${display}\n\n`

          // Try to get display info using xrandr
          try {
            const xrandr = execSync("xrandr --query 2>/dev/null | grep ' connected'", { encoding: "utf-8" })
            output += "**Connected Displays:**\n"
            for (const line of xrandr.trim().split("\n")) {
              output += `- ${line}\n`
            }
          } catch {
            output += "xrandr not available or no displays found.\n"
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}`
        }

        return {
          title: "Display Information",
          output,
          metadata: { path: undefined, size: undefined, error: undefined },
        }
      }

      case "windows": {
        let output = "## Active Windows\n\n"

        try {
          // Use wmctrl to list windows
          const windows = execSync("wmctrl -l 2>/dev/null", { encoding: "utf-8" })

          if (windows.trim()) {
            output += "| Window ID | Desktop | Title\n"
            output += "|-----------|---------|-------\n"
            for (const line of windows.trim().split("\n")) {
              const parts = line.split(/\s+/)
              if (parts.length >= 3) {
                const id = parts[0]
                const desktop = parts[1]
                const title = parts.slice(3).join(" ")
                output += `| ${id} | ${desktop} | ${title}\n`
              }
            }
          } else {
            output += "No windows found or wmctrl not available.\n"
          }
        } catch {
          output += "wmctrl not available. Install with: sudo apt install wmctrl\n"
        }

        return {
          title: "Window List",
          output,
          metadata: { path: undefined, size: undefined, error: undefined },
        }
      }
    }
  },
})
