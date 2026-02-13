import path from "path"
import type { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Global } from "../global"
import { Flag } from "../flag/flag"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

/**
 * Directories the agent always has full access to (no permission prompt).
 * Includes the agent's own config, memory, skills, and MCP config directories.
 */
function isTrustedPath(target: string): boolean {
  const home = Global.Path.home
  const trustedPaths = [
    // Global agent config & memory
    path.join(home, ".atomcli"),
    path.join(home, ".claude"),
    // Project-level config (one level up from AtomBase)
    path.resolve(Instance.directory, "../.atomcli"),
    path.resolve(Instance.directory, "../.claude"),
    // Project-level config (same level)
    path.resolve(Instance.directory, ".atomcli"),
    path.resolve(Instance.directory, ".claude"),
  ]
  return trustedPaths.some((p) => Filesystem.contains(p, target))
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  // YOLO mode: full filesystem access without prompts
  if (Flag.ATOMCLI_YOLO) return

  if (options?.bypass) return

  if (Filesystem.contains(Instance.directory, target)) return

  // Auto-allow agent's own config/memory/MCP directories
  if (isTrustedPath(target)) return

  const kind = options?.kind ?? "file"
  const parentDir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(parentDir, "*")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
