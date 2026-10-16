import { Log } from "@/util/util/log"
import { Context } from "@/util/util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/util/iife"
import { GlobalBus } from "@/core/bus/global"

interface Context {
  directory: string
  sessionDirectory?: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

export const Instance = {
  async provide<R>(input: {
    directory: string
    sessionDirectory?: string
    init?: () => Promise<any>
    fn: () => R
  }): Promise<R> {
    let existing = cache.get(input.directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory: input.directory })
      const pending = iife(async () => {
        const { project, sandbox } = await Project.fromDirectory(input.directory)
        const ctx = {
          directory: input.directory,
          worktree: sandbox,
          project,
        }
        await context.provide(ctx, async () => {
          await input.init?.()
        })
        return ctx
      })
      // Cache the in-flight promise so concurrent callers share one init, but never a
      // rejection: a transient failure (git timeout, EACCES) would otherwise poison this
      // directory for the process lifetime, because `dispose()` is unreachable while
      // `provide` keeps throwing. The cached promise is the same one the caller awaits,
      // so the rethrow below stays handled.
      existing = pending.catch((error) => {
        if (cache.get(input.directory) === existing) cache.delete(input.directory)
        throw error
      })
      cache.set(input.directory, existing)
    }
    const ctx = await existing
    if (input.sessionDirectory !== undefined) {
      const parent = context.use()
      if (
        input.sessionDirectory !== (parent.sessionDirectory ?? parent.directory) ||
        ctx.project.id !== parent.project.id
      )
        throw new Error("Isolated sessions must retain their parent project's session directory")
    }
    // Per-call only: worktree file/config state stays physical; sessions survive its disposal.
    return context.provide({ ...ctx, sessionDirectory: input.sessionDirectory }, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get sessionDirectory() {
    const ctx = context.use()
    return ctx.sessionDirectory ?? ctx.directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  sessionState<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.sessionDirectory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  async disposeAll() {
    Log.Default.info("disposing all instances")
    for (const [_key, value] of cache) {
      const awaited = await value.catch(() => {})
      if (awaited) {
        await context.provide(await value, async () => {
          await Instance.dispose()
        })
      }
    }
    cache.clear()
  },
}
