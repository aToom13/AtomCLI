import z from "zod"
import { Tool } from "./tool"
import { execFileSync, execSync } from "child_process"

const DESCRIPTION = `Window and application management tool.

Provides:
- List all open windows
- Switch between applications
- Bring windows to focus
- Close windows
- Get active window info
- Resize and move windows
- Minimize and maximize windows

**USE CASES:**
- Navigate between applications without GUI
- Automate window management
- Document current application state

**REQUIREMENTS:**
- wmctrl (Linux) - install with: sudo apt install wmctrl
- xdotool (optional) - for more advanced features

**⚠️ STRICT PERMISSION: This tool ALWAYS requires explicit user permission before EVERY use. There is NO "always allow" option, even in YOLO mode.**

**ACTIONS:**
- "list": List all open windows
- "switch": Switch to a specific window by ID or title
- "active": Get currently active window
- "close": Close a window by ID
- "resize": Resize a window (requires window_id, width, height)
- "move": Move a window (requires window_id, x, y)
- "minimize": Minimize a window
- "maximize": Maximize a window`

export const AppSwitcherTool = Tool.define("app_switcher", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["list", "switch", "active", "close", "resize", "move", "minimize", "maximize"])
      .describe("The action to perform"),
    window_id: z.string().optional().describe("Window ID (hex format like 0x02800006)"),
    window_title: z.string().optional().describe("Partial window title to match"),
    width: z.number().optional().describe("Window width (for resize)"),
    height: z.number().optional().describe("Window height (for resize)"),
    x: z.number().optional().describe("Window X position (for move)"),
    y: z.number().optional().describe("Window Y position (for move)"),
  }),
  async execute(params, ctx): Promise<any> {
    // STRICT PERMISSION: Always ask, never allow "always" option
    // This is enforced even in YOLO mode via YOLO_EXEMPT_PERMISSIONS in permission/next.ts
    await ctx.ask({
      permission: "window_control",
      patterns: [`${params.action}:${params.window_id || params.window_title || "*"}`],
      metadata: {
        action: params.action,
        target: params.window_id || params.window_title || "all",
      },
      always: [], // Never allow permanent permission
    })

    switch (params.action) {
      case "list": {
        let output = "## Open Windows\n\n"

        try {
          const windows = execFileSync("wmctrl", ["-l"], { encoding: "utf-8" })
          const lines = windows.trim().split("\n").filter(Boolean)

          if (lines.length === 0) {
            output += "No windows found.\n"
          } else {
            output += "| Window ID | Desktop | Title\n"
            output += "|-----------|---------|-------\n"

            for (const line of lines) {
              const match = line.match(/^(\S+)\s+(\S+)\s+(.*)$/)
              if (match) {
                const [, id, desktop, title] = match
                output += `| ${id} | ${desktop} | ${title} |\n`
              }
            }

            output += `\n**Total:** ${lines.length} windows\n`
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}\n`
          output += "Install wmctrl: sudo apt install wmctrl\n"
        }

        return {
          title: "Window List",
          output,
          metadata: {},
        }
      }

      case "switch": {
        if (!params.window_id && !params.window_title) {
          return {
            title: "Error",
            output: "Either window_id or window_title is required for switch action",
            metadata: {},
          }
        }

        try {
          let targetId = params.window_id

          // If window_title provided, find the window ID
          if (!targetId && params.window_title) {
            const windows = execFileSync("wmctrl", ["-l"], { encoding: "utf-8" })
            for (const line of windows.split("\n")) {
              if (line.toLowerCase().includes(params.window_title.toLowerCase())) {
                targetId = line.split(/\s+/)[0]
                break
              }
            }
          }

          if (!targetId) {
            return {
              title: "Window Not Found",
              output: `No window found matching: ${params.window_title}`,
              metadata: {},
            }
          }

          // Safe: using execFileSync with array args (no shell injection)
          execFileSync("wmctrl", ["-i", "-a", targetId], { encoding: "utf-8" })

          return {
            title: "Window Switched",
            output: `Switched to window ${targetId}`,
            metadata: { windowId: targetId },
          }
        } catch (e) {
          return {
            title: "Switch Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }

      case "active": {
        let output = "## Active Window\n\n"

        try {
          // Get active window using xdotool if available
          try {
            const activeId = execFileSync("xdotool", ["getactivewindow"], { encoding: "utf-8" }).trim()
            const activeName = execFileSync("xdotool", ["getwindowname", activeId], { encoding: "utf-8" }).trim()

            output += `**Window ID:** ${activeId}\n`
            output += `**Title:** ${activeName}\n`

            // Get window class using xprop (xdotool getwindowclassname is unreliable)
            try {
              const xpropOutput = execFileSync("xprop", ["-id", activeId, "WM_CLASS"], { encoding: "utf-8" }).trim()
              const classMatch = xpropOutput.match(/WM_CLASS.*=\s*"([^"]*)"/)
              if (classMatch) {
                output += `**Class:** ${classMatch[1]}\n`
              }
            } catch { }
          } catch {
            // Fallback to wmctrl
            const windows = execFileSync("wmctrl", ["-l"], { encoding: "utf-8" })
            output += "Could not determine active window. Open windows:\n" + windows
          }
        } catch (e) {
          output += `Error: ${(e as Error).message}\n`
        }

        return {
          title: "Active Window",
          output,
          metadata: {},
        }
      }

      case "close": {
        if (!params.window_id) {
          return {
            title: "Error",
            output: "window_id is required for close action",
            metadata: {},
          }
        }

        try {
          execFileSync("wmctrl", ["-i", "-c", params.window_id], { encoding: "utf-8" })

          return {
            title: "Window Closed",
            output: `Sent close request to window ${params.window_id}`,
            metadata: { windowId: params.window_id },
          }
        } catch (e) {
          return {
            title: "Close Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }

      case "resize": {
        if (!params.window_id || !params.width || !params.height) {
          return {
            title: "Error",
            output: "window_id, width, and height are required for resize action",
            metadata: {},
          }
        }

        try {
          execFileSync("xdotool", [
            "windowsize", params.window_id,
            String(params.width), String(params.height),
          ], { encoding: "utf-8" })

          return {
            title: "Window Resized",
            output: `Resized window ${params.window_id} to ${params.width}x${params.height}`,
            metadata: { windowId: params.window_id, width: params.width, height: params.height },
          }
        } catch (e) {
          return {
            title: "Resize Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }

      case "move": {
        if (!params.window_id || params.x === undefined || params.y === undefined) {
          return {
            title: "Error",
            output: "window_id, x, and y are required for move action",
            metadata: {},
          }
        }

        try {
          execFileSync("xdotool", [
            "windowmove", params.window_id,
            String(params.x), String(params.y),
          ], { encoding: "utf-8" })

          return {
            title: "Window Moved",
            output: `Moved window ${params.window_id} to (${params.x}, ${params.y})`,
            metadata: { windowId: params.window_id, x: params.x, y: params.y },
          }
        } catch (e) {
          return {
            title: "Move Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }

      case "minimize": {
        if (!params.window_id) {
          return {
            title: "Error",
            output: "window_id is required for minimize action",
            metadata: {},
          }
        }

        try {
          execFileSync("xdotool", ["windowminimize", params.window_id], { encoding: "utf-8" })

          return {
            title: "Window Minimized",
            output: `Minimized window ${params.window_id}`,
            metadata: { windowId: params.window_id },
          }
        } catch (e) {
          return {
            title: "Minimize Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }

      case "maximize": {
        if (!params.window_id) {
          return {
            title: "Error",
            output: "window_id is required for maximize action",
            metadata: {},
          }
        }

        try {
          // wmctrl can maximize: -b add,maximized_vert,maximized_horz
          execFileSync("wmctrl", ["-i", "-r", params.window_id, "-b", "add,maximized_vert,maximized_horz"], {
            encoding: "utf-8",
          })

          return {
            title: "Window Maximized",
            output: `Maximized window ${params.window_id}`,
            metadata: { windowId: params.window_id },
          }
        } catch (e) {
          return {
            title: "Maximize Failed",
            output: `Error: ${(e as Error).message}`,
            metadata: {},
          }
        }
      }
    }
  },
})
