import { spawn as nodeSpawn, type SpawnOptionsWithoutStdio } from "node:child_process"
import { EnvPolicy } from "@/core/env/policy"

export namespace LSPProcess {
  function environment(cwd: string | undefined, source: Record<string, string | undefined> | undefined) {
    const overrides = Object.fromEntries(
      Object.entries(source ?? {}).filter(([name, value]) => EnvPolicy.isSafeName(name) || process.env[name] !== value),
    )
    return EnvPolicy.build({ cwd, scope: "lsp", overrides })
  }

  export function spawn(
    command: string,
    argsOrOptions: readonly string[] | SpawnOptionsWithoutStdio = [],
    inputOptions: SpawnOptionsWithoutStdio = {},
  ) {
    const hasArgs = Array.isArray(argsOrOptions)
    const args = hasArgs ? [...(argsOrOptions as readonly string[])] : []
    const options = (hasArgs ? inputOptions : argsOrOptions) as SpawnOptionsWithoutStdio
    const cwd = typeof options.cwd === "string" ? options.cwd : undefined
    return nodeSpawn(command, args, {
      ...options,
      env: environment(cwd, options.env),
    })
  }

  export function bunSpawn(command: any, inputOptions: any = {}) {
    if (Array.isArray(command)) {
      const cwd = typeof inputOptions.cwd === "string" ? inputOptions.cwd : undefined
      return Bun.spawn(command, { ...inputOptions, env: environment(cwd, inputOptions.env) })
    }
    const options = command as any
    const cwd = typeof options.cwd === "string" ? options.cwd : undefined
    return Bun.spawn({ ...options, env: environment(cwd, options.env) })
  }
}
