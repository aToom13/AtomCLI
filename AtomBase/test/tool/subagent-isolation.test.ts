import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { SubAgentIsolation } from "@/integrations/tool/subagent-isolation"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SubAgentIsolation", () => {
  test("applies an isolated patch without exposing intermediate writes", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "feature.ts")
    await Bun.write(target, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workspace = await SubAgentIsolation.create("isolated-apply")
        try {
          await Bun.write(path.join(workspace.directory, "feature.ts"), "export const value = 2\n")
          expect(await Bun.file(target).text()).toBe("export const value = 1\n")

          const preview = await workspace.preview()
          expect(preview.changedFiles).toEqual(["feature.ts"])
          expect(preview.patchBytes).toBeGreaterThan(0)

          const applied = await workspace.apply(["feature.ts"])
          expect(applied.applied).toBe(true)
          expect(applied.changedFiles).toEqual(["feature.ts"])
          expect(await Bun.file(target).text()).toBe("export const value = 2\n")
        } finally {
          await workspace.dispose()
        }
      },
    })
  })

  test("detects parent conflicts and preserves both workspaces", async () => {
    await using tmp = await tmpdir({ git: true })
    const target = path.join(tmp.path, "conflict.ts")
    await Bun.write(target, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workspace = await SubAgentIsolation.create("conflict")
        try {
          await Bun.write(path.join(workspace.directory, "conflict.ts"), "export const value = 2\n")
          await Bun.write(target, "export const value = 3\n")
          await expect(workspace.apply()).rejects.toThrow("merge conflict")
          expect(await Bun.file(target).text()).toBe("export const value = 3\n")
          expect(await Bun.file(path.join(workspace.directory, "conflict.ts")).text()).toBe("export const value = 2\n")
        } finally {
          await workspace.dispose()
        }
      },
    })
  })

  test("merges parallel non-overlapping worktrees and enforces owns boundaries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "left.ts"), "left-0\n")
    await Bun.write(path.join(tmp.path, "right.ts"), "right-0\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const [left, right] = await Promise.all([SubAgentIsolation.create("left"), SubAgentIsolation.create("right")])
        try {
          await Bun.write(path.join(left.directory, "left.ts"), "left-1\n")
          await Bun.write(path.join(right.directory, "right.ts"), "right-1\n")
          await Promise.all([left.apply(["left.ts"]), right.apply(["right.ts"])])
          expect(await Bun.file(path.join(tmp.path, "left.ts")).text()).toBe("left-1\n")
          expect(await Bun.file(path.join(tmp.path, "right.ts")).text()).toBe("right-1\n")

          await Bun.write(path.join(left.directory, "outside.ts"), "outside\n")
          await expect(left.apply(["left.ts"])).rejects.toThrow("outside its owns boundary")
          expect(await Bun.file(path.join(tmp.path, "outside.ts")).exists()).toBe(false)
        } finally {
          await Promise.all([left.dispose(), right.dispose()])
        }
      },
    })
  })
})
