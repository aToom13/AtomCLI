import "../preload"
import { $ } from "bun"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { BundledAssets } from "@/services/installation/bundled-assets"
import { tmpdir } from "../fixture/fixture"

test("bundles current tracked assets without ignored or untracked private state", async () => {
  await using source = await tmpdir({ git: true })
  await using destination = await tmpdir()
  const skill = ".atomcli/skills/example/SKILL.md"
  await Bun.write(path.join(source.path, skill), "original")
  await Bun.write(path.join(source.path, ".claude/agent/example.md"), "agent")
  await Bun.write(path.join(source.path, ".atomcli/deleted.md"), "deleted")
  await $`git add .atomcli .claude`.cwd(source.path).quiet()
  await Bun.write(path.join(source.path, skill), "current working copy")
  await fs.unlink(path.join(source.path, ".atomcli/deleted.md"))
  await Bun.write(path.join(source.path, ".gitignore"), ".atomcli/local-private.json\n")
  await Bun.write(path.join(source.path, ".atomcli/local-private.json"), "fake-private-test-data")
  await Bun.write(path.join(source.path, ".claude/untracked-private.json"), "fake-private-test-data")

  await BundledAssets.copy(source.path, destination.path)
  expect(await Bun.file(path.join(destination.path, skill)).text()).toBe("current working copy")
  expect(await Bun.file(path.join(destination.path, ".claude/agent/example.md")).text()).toBe("agent")
  for (const file of [".atomcli/local-private.json", ".claude/untracked-private.json", ".atomcli/deleted.md"])
    expect(await Bun.file(path.join(destination.path, file)).exists()).toBe(false)
})

test.skipIf(process.platform === "win32")("rejects an asset replaced with a private-file symlink", async () => {
  await using source = await tmpdir({ git: true })
  await using destination = await tmpdir()
  const asset = path.join(source.path, ".atomcli/skills/example/SKILL.md")
  const privateFile = path.join(source.path, "private.txt")
  await Bun.write(asset, "skill")
  await $`git add .atomcli`.cwd(source.path).quiet()
  await Bun.write(privateFile, "fake-private-test-data")
  await fs.unlink(asset)
  await fs.symlink(privateFile, asset)
  await expect(BundledAssets.copy(source.path, destination.path)).rejects.toThrow("must not use symlinks")
})
