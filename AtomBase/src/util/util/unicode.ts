/**
 * Windows terminal Unicode compatibility utilities.
 *
 * Classic Windows console (cmd.exe) uses codepage 437 by default,
 * which doesn't support many Unicode characters used in the TUI.
 * Modern Windows Terminal and VS Code terminal support UTF-8 natively.
 *
 * This module:
 * 1. Detects Windows platform and sets UTF-8 codepage when possible
 * 2. Provides ASCII-safe fallback characters for critical UI elements
 */

import { Log } from "./log"

const log = Log.create({ service: "unicode" })

const isWindows = process.platform === "win32"

/**
 * Attempt to set Windows console codepage to UTF-8 (65001).
 * This helps with Unicode rendering in cmd.exe and PowerShell.
 * No-op on non-Windows platforms.
 */
export function initConsoleEncoding(): void {
  if (!isWindows) return

  try {
    // Bun/Node on Windows: setting the env var helps some rendering
    process.env.CHCP = "65001"

    // Try child_process for more reliable codepage change
    const { execSync } = require("child_process") as typeof import("child_process")
    execSync("chcp 65001", { stdio: "ignore" })
    log.info("set Windows console codepage to UTF-8 (65001)")
  } catch {
    // Silent fallback — not all environments support chcp
    log.debug("could not set Windows console codepage, Unicode may not render correctly")
  }
}

/**
 * Fallback character map for Windows compatibility.
 * Maps Unicode symbols to ASCII-safe alternatives.
 */
const WINDOWS_FALLBACKS: Record<string, string> = {
  // Arrows
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "⇆": "<>",
  "▶": ">",
  "◀": "<",
  // Status icons
  "✓": "[OK]",
  "✗": "[X]",
  "●": "*",
  "○": "o",
  "◉": "@",
  "⟳": "...",
  "△": "!",
  "⏳": "...",
  // Tool icons
  "⚙": "#",
  "◈": "*",
  "◇": "*",
  "✱": "*",
  "▼": "v",
  // Box drawing (basic ASCII replacements)
  "─": "-",
  "│": "|",
  "╭": "+",
  "╮": "+",
  "╰": "+",
  "╯": "+",
  "└": "+",
  "┘": "+",
  "├": "+",
  "┤": "+",
  "┬": "+",
  "┴": "+",
  "┼": "+",
  "╗": "+",
  "╔": "+",
  "╚": "+",
  "╝": "+",
  "║": "|",
  "═": "=",
  // Other
  "💬": "[Q]",
  "🔗": "[L]",
  "🔧": "[T]",
  "💾": "[S]",
  "⏭": ">>",
}

/**
 * Returns the best available character for display.
 * On Windows, falls back to ASCII if the Unicode char might not render.
 * On other platforms, returns the original character.
 */
export function safeChar(unicode: string, windowsFallback?: string): string {
  if (!isWindows) return unicode
  return windowsFallback ?? WINDOWS_FALLBACKS[unicode] ?? unicode
}

/**
 * Returns true if running on Windows.
 */
export function isWin32(): boolean {
  return isWindows
}
