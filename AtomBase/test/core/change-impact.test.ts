import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { ChangeImpact } from "@/core/verification/change-impact"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("ChangeImpact", () => {
  test("raises risk when a validation guard is removed", () => {
    const report = ChangeImpact.analyze({
      files: ["src/auth/token.ts"],
      diff: "- if (!validate(token)) throw new Error()",
    })
    expect(report.level).toBe("high")
    expect(report.reasons).toContain("a validation or guard branch was removed")
  })

  test("keeps a bounded isolated documentation edit low risk", () => {
    expect(ChangeImpact.analyze({ files: ["README.md"], diff: "+ setup details" }).level).toBe("low")
  })

  test("derives stable test suggestions from changed source files", () => {
    const report = ChangeImpact.analyze({
      files: ["src/auth/session.ts", "src/auth/token.ts", "test/auth/session.test.ts"],
      diff: "+ export function validateSession() {}",
    })
    expect(report.suggestedTests).toEqual(["session.test", "session.spec", "token.test", "token.spec"])
  })

  test("captures staged and untracked file content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "staged.ts"), "export const staged = true\n")
    await $`git add staged.ts`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "new.ts"), "export const untracked = true\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const diff = await ChangeImpact.diff(["staged.ts", "new.ts"])
        expect(diff).toContain("export const staged")
        expect(diff).toContain("export const untracked")
      },
    })
  })

  test("does not follow untracked symlinks outside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    const outside = path.join(path.dirname(tmp.path), `atomcli-secret-${path.basename(tmp.path)}.txt`)
    await Bun.write(outside, "outside-secret-value\n")
    try {
      await fs.symlink(outside, path.join(tmp.path, "linked.txt"))
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(await ChangeImpact.diff(["linked.txt"])).not.toContain("outside-secret-value")
        },
      })
    } finally {
      await fs.unlink(outside).catch(() => {})
    }
  })

  test("does not include oversized or binary untracked artifacts in review input", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "large.txt"), "x".repeat(50_001))
    await Bun.write(path.join(tmp.path, "binary.dat"), new Uint8Array([65, 0, 66]))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const diff = await ChangeImpact.diff(["large.txt", "binary.dat"])
        expect(diff).not.toContain("large.txt")
        expect(diff).not.toContain("binary.dat")
      },
    })
  })
})
