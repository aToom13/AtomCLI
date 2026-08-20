import z from "zod"

export namespace EnvPolicy {
  export const Mode = z.enum(["minimal", "filtered", "inherit"])
  export type Mode = z.infer<typeof Mode>

  export const Grant = z.object({
    name: z.string().min(1),
    scope: z.string().min(1),
    expiresAt: z.number().int().positive().optional(),
  })
  export type Grant = z.infer<typeof Grant>

  export interface BuildOptions {
    mode?: Mode
    allow?: string[]
    grants?: Grant[]
    scope?: string
    cwd?: string
    overrides?: Record<string, string | undefined>
    source?: Record<string, string | undefined>
    approvedInherit?: boolean
    now?: number
  }

  const SAFE_NAMES = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
  ] as const

  export function isSafeName(name: string) {
    return (SAFE_NAMES as readonly string[]).includes(name)
  }

  function copy(target: Record<string, string>, source: Record<string, string | undefined>, names: Iterable<string>) {
    for (const name of names) {
      const value = source[name]
      if (value !== undefined) target[name] = value
    }
  }

  export function build(options: BuildOptions = {}) {
    const mode = options.mode ?? "minimal"
    const source = options.source ?? process.env
    const result: Record<string, string> = {}

    if (mode === "inherit") {
      if (!options.approvedInherit) throw new Error("EnvPolicy inherit mode requires explicit approval")
      copy(result, source, Object.keys(source))
    } else {
      copy(result, source, SAFE_NAMES)
      if (mode === "filtered") copy(result, source, options.allow ?? [])
    }

    const now = options.now ?? Date.now()
    for (const grant of options.grants ?? []) {
      if (grant.scope !== "*" && grant.scope !== options.scope) continue
      if (grant.expiresAt !== undefined && grant.expiresAt < now) continue
      copy(result, source, [grant.name])
    }

    for (const [name, value] of Object.entries(options.overrides ?? {})) {
      if (value === undefined) delete result[name]
      else result[name] = value
    }
    if (options.cwd) result.PWD = options.cwd
    return result
  }
}
