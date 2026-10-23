import path from "node:path"
import z from "zod"

export namespace ExecutionWorld {
  export const Policy = z.object({
    filesystem: z.enum(["read-only", "workspace-write", "full"]).default("workspace-write"),
    network: z.enum(["deny", "allow"]).default("allow"),
    environment: z.enum(["minimal", "filtered", "inherit"]).default("minimal"),
    processVisibility: z.enum(["restricted", "inherit"]).default("restricted"),
    workspaceRoot: z.string(),
    sandbox: z.enum(["off", "prefer", "require"]).default("off"),
    hiddenPaths: z.array(z.string()).default([]),
  })
  export type Policy = z.infer<typeof Policy>

  export interface Command {
    executable: string
    args: string[]
    cwd: string
    env: Record<string, string>
  }

  export interface PreparedCommand extends Command {
    enforcement: "full" | "partial" | "off"
    provider: "bubblewrap" | "seatbelt" | "windows" | "host"
  }

  export interface Provider {
    id: PreparedCommand["provider"]
    available(): boolean
    prepare(command: Command, policy: Policy): PreparedCommand
  }

  export function shellArguments(executable: string, command: string) {
    const name = (executable.includes("\\") ? path.win32.basename(executable) : path.basename(executable))
      .toLowerCase()
      .replace(/\.exe$/, "")
    if (name === "cmd") return ["/d", "/s", "/c", command]
    if (name === "powershell" || name === "pwsh") return ["-NoProfile", "-Command", command]
    if (["bash", "zsh", "ksh"].includes(name)) return ["-e", "-o", "pipefail", "-c", command]
    return ["-e", "-c", command]
  }

  function bubblewrap(): Provider {
    return {
      id: "bubblewrap",
      available: () => process.platform === "linux" && Boolean(Bun.which("bwrap")),
      prepare(command, policy) {
        const binary = Bun.which("bwrap")!
        const rootMount = policy.filesystem === "full" ? ["--bind", "/", "/"] : ["--ro-bind", "/", "/"]
        const args = [
          "--die-with-parent",
          "--new-session",
          "--unshare-user",
          ...rootMount,
          "--proc",
          "/proc",
          "--dev",
          "/dev",
        ]
        if (policy.processVisibility === "restricted") args.push("--unshare-pid")
        if (policy.network === "deny") args.push("--unshare-net")
        if (policy.hiddenPaths.length) args.push("--tmpfs", "/tmp")
        if (policy.filesystem === "workspace-write") {
          args.push("--bind", policy.workspaceRoot, policy.workspaceRoot)
        }
        for (const location of policy.hiddenPaths) args.push("--tmpfs", path.resolve(location))
        args.push("--chdir", command.cwd, "--", command.executable, ...command.args)
        return { ...command, executable: binary, args, enforcement: "full", provider: "bubblewrap" }
      },
    }
  }

  function seatbelt(): Provider {
    return {
      id: "seatbelt",
      available: () => process.platform === "darwin" && Boolean(Bun.which("sandbox-exec")),
      prepare(command, policy) {
        const workspace = path.resolve(policy.workspaceRoot).replaceAll('"', '\\"')
        const writes =
          policy.filesystem === "full"
            ? "(allow file-write*)"
            : policy.filesystem === "workspace-write"
              ? `(allow file-write* (subpath \"${workspace}\"))`
              : ""
        const network = policy.network === "allow" ? "(allow network*)" : ""
        const profile = `(version 1) (deny default) (allow process-exec process-fork) (allow file-read*) ${writes} ${network}`
        return {
          ...command,
          executable: Bun.which("sandbox-exec")!,
          args: ["-p", profile, command.executable, ...command.args],
          enforcement: "partial",
          provider: "seatbelt",
        }
      },
    }
  }

  export function prepare(
    command: Command,
    input: z.input<typeof Policy>,
    providers: Provider[] = [bubblewrap(), seatbelt()],
  ) {
    const policy = Policy.parse(input)
    // Private evaluator data needs PID and mount isolation, not best-effort policy.
    if (policy.hiddenPaths.length && (policy.sandbox !== "require" || process.platform !== "linux"))
      throw new Error("Hidden execution paths require a Linux sandbox")
    if (policy.sandbox === "off") return { ...command, enforcement: "off", provider: "host" } satisfies PreparedCommand
    const provider = providers.find((candidate) => candidate.available())
    if (provider) {
      if (policy.hiddenPaths.length && provider.id !== "bubblewrap")
        throw new Error("Hidden execution paths require bubblewrap")
      return provider.prepare(command, policy)
    }
    if (policy.sandbox === "require") {
      throw new Error(`Sandbox was required but no OS execution provider is available on ${process.platform}`)
    }
    return { ...command, enforcement: "off", provider: "host" } satisfies PreparedCommand
  }
}
