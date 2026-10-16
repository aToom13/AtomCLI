import { describe, expect, test } from "bun:test"
import "../preload"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import path from "path"

Log.init({ print: false })

describe("Instance", () => {
  test("trusted isolated calls share session state without caching or crossing project namespaces", async () => {
    await using tmp = await tmpdir({ git: true })
    await using foreign = await tmpdir({ git: true })
    const child = path.join(tmp.path, "child")
    await fs.mkdir(child)
    const physical = Instance.state(() => ({ value: 0 }))
    const sessions = Instance.sessionState(() => ({ value: 0 }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        physical().value = 1
        sessions().value = 2
        await Instance.provide({
          directory: child,
          sessionDirectory: tmp.path,
          fn: async () => {
            expect(Instance.directory).toBe(child)
            expect(Instance.sessionDirectory).toBe(tmp.path)
            expect(physical().value).toBe(0)
            expect(sessions().value).toBe(2)
            sessions().value = 3
          },
        })
        await Instance.provide({
          directory: child,
          fn: async () => {
            expect(Instance.sessionDirectory).toBe(child)
            expect(sessions().value).toBe(0)
            await Instance.dispose()
          },
        })
        expect(physical().value).toBe(1)
        expect(sessions().value).toBe(3)
        await expect(Instance.provide({ directory: child, sessionDirectory: child, fn: () => {} })).rejects.toThrow(
          "retain their parent project's session directory",
        )
        await expect(
          Instance.provide({ directory: foreign.path, sessionDirectory: tmp.path, fn: () => {} }),
        ).rejects.toThrow("retain their parent project's session directory")
      },
    })
  })

  test("reuses one initialization across callers for the same directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const seen: string[] = []
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // `project` is context scoped, so it is only readable inside `fn`.
        expect(Instance.project).toBeDefined()
        expect(Instance.worktree).toBeDefined()
        seen.push("a")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.project).toBeDefined()
        seen.push("b")
      },
    })

    expect(seen).toEqual(["a", "b"])
  })

  test("does not cache a rejected initialization for the directory", async () => {
    // A transient init failure must not poison the directory for the process
    // lifetime: `dispose()` cannot be reached while `provide` keeps throwing, so the
    // cache has to drop the rejection itself.
    await using tmp = await tmpdir({ git: true })
    let initCalls = 0
    const withFailingInit = Instance.provide({
      directory: tmp.path,
      init: async () => {
        initCalls++
        throw new Error("transient init failure")
      },
      fn: async () => {},
    })

    await expect(withFailingInit).rejects.toThrow("transient init failure")
    expect(initCalls).toBe(1)

    // The next caller must retry initialization instead of replaying the rejection.
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.project).toBeDefined()
      },
    })
    expect(initCalls).toBe(1)
  })
})
