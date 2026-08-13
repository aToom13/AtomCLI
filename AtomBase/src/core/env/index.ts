import { Instance } from "@/services/project/instance"

export namespace Env {
  const state = Instance.state(() => {
    // Each project gets an environment snapshot. Returning process.env itself
    // allowed one project (and parallel tests) to leak provider credentials into
    // every other Instance through Env.set()/remove().
    return { ...process.env } as Record<string, string | undefined>
  })

  export function get(key: string) {
    const env = state()
    return env[key]
  }

  export function all() {
    return state()
  }

  export function set(key: string, value: string) {
    const env = state()
    env[key] = value
  }

  export function remove(key: string) {
    const env = state()
    delete env[key]
  }
}
