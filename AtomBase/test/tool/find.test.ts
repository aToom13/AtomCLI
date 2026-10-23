import "../preload"
import { expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { FindTool } from "@/integrations/tool/find"
import { Instance } from "@/services/project/instance"

const context = {
  sessionID: "find-fixture",
  messageID: "find-fixture",
  agent: "build",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
}

test.each([false, true])(
  "tree reveals omitted log directory without exposing ignored contents: git=%s",
  async (git) => {
    await using tmp = await tmpdir({ git })
    await Bun.write(path.join(tmp.path, "README.md"), "Inspect logs/gateway.log")
    await Bun.write(path.join(tmp.path, "logs/gateway.log"), "private request contents")
    await Bun.write(path.join(tmp.path, "node_modules/package/index.js"), "dependency")
    if (git) await Bun.write(path.join(tmp.path, ".gitignore"), "logs/\n*.log\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const find = await FindTool.init()
        const tree = await find.execute({ mode: "tree", path: tmp.path, ignore: [] }, context)
        expect(tree.output).toContain("logs/ (contents omitted)")
        expect(tree.output).toContain("node_modules/ (contents omitted)")
        expect(tree.output).toContain("README.md")
        expect(tree.output).not.toContain("gateway.log")
        expect(tree.output).not.toContain("index.js")
        expect(tree.output).toContain("Git and default ignore rules apply")
        const scoped = await find.execute({ mode: "pattern", path: path.join(tmp.path, "logs"), pattern: "*" }, context)
        expect(scoped.output).toContain(path.join(tmp.path, "logs/gateway.log"))
      },
    })
  },
)

test("tree marks truncation and cannot list a directory after permission rejection", async () => {
  await using tmp = await tmpdir()
  for (let i = 0; i < 110; i++) await Bun.write(path.join(tmp.path, `file-${i}.txt`), "fixture")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const find = await FindTool.init()
      const tree = await find.execute({ mode: "tree" }, context)
      expect(tree.metadata.count).toBeLessThanOrEqual(100)
      expect(tree.metadata.truncated).toBe(true)
      expect(tree.output).toContain("Results are truncated")
      await expect(
        find.execute(
          { mode: "tree", path: "/" },
          {
            ...context,
            async ask() {
              throw new Error("Permission denied")
            },
          },
        ),
      ).rejects.toThrow("Permission denied")
    },
  })
})
