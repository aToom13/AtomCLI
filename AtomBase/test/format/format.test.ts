import "../preload"
import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import vm from "vm"
import { Format } from "@/interfaces/format"
import { WriteTool } from "@/integrations/tool/write"
import { EditTool } from "@/integrations/tool/edit"
import { EditAnchor } from "@/integrations/tool/edit-anchor"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "format-test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}
const html =
  '<!doctype html><html><head><title>Counter</title><style>body{color:navy;background:white}button{padding:8px}</style></head><body><button>Increment</button><script>globalThis.counter={value:0,increment(){this.value+=1},reset(){this.value=0}};document.querySelector("button").addEventListener("click",()=>counter.increment());</script></body></html>'

test("new HTML is formatted before write returns; behavior and later edit hashes use final content", async () => {
  await using tmp = await tmpdir({ git: true })
  const prettier = path.dirname(Bun.resolveSync("prettier/package.json", import.meta.dir))
  await fs.mkdir(path.join(tmp.path, "node_modules/.bin"), { recursive: true })
  await fs.symlink(prettier, path.join(tmp.path, "node_modules/prettier"), "dir")
  await fs.symlink(path.join(prettier, "bin/prettier.cjs"), path.join(tmp.path, "node_modules/.bin/prettier"))
  await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ devDependencies: { prettier: "3.6.2" } }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Format.init()
      const filePath = path.join(tmp.path, "counter.html")
      await (await WriteTool.init()).execute({ filePath, content: html }, ctx)
      const formatted = await Bun.file(filePath).text()
      expect(formatted.split("\n").length).toBeGreaterThan(20)
      expect(formatted).toContain("    <style>\n")
      expect(formatted).toContain("    <script>\n")
      expect(formatted).toContain("      increment() {")

      let click: () => void = () => {}
      const sandbox = {
        document: {
          querySelector: () => ({
            addEventListener: (_: string, fn: () => void) => {
              click = fn
            },
          }),
        },
      }
      const script = formatted.match(/<script>([\s\S]*?)<\/script>/)![1]
      vm.runInNewContext(script, sandbox)
      const counter = (sandbox as any).counter
      click()
      click()
      expect(counter.value).toBe(2)
      counter.reset()
      expect(counter.value).toBe(0)

      const result = await (
        await EditTool.init()
      ).execute({ filePath, oldString: "this.value += 1;", newString: "this.value+=2;" }, ctx)
      const edited = await Bun.file(filePath).text()
      expect(edited).toContain("this.value += 2;")
      expect(result.metadata.contentHashAfter).toBe(EditAnchor.contentHash(edited))
      expect(result.metadata.diff).toContain("this.value += 2;")
    },
  })
})

test("disabled formatter leaves new HTML unchanged", async () => {
  await using tmp = await tmpdir({ config: { formatter: false } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Format.init()
      const filePath = path.join(tmp.path, "counter.html")
      await (await WriteTool.init()).execute({ filePath, content: html }, ctx)
      expect(await Bun.file(filePath).text()).toBe(html)
    },
  })
})

test("formatter failure reports applied write rather than claiming success or repeating mutation", async () => {
  await using tmp = await tmpdir({
    config: { formatter: { failing: { command: [process.execPath, "-e", "process.exit(2)"], extensions: [".html"] } } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Format.init()
      const filePath = path.join(tmp.path, "counter.html")
      await expect((await WriteTool.init()).execute({ filePath, content: html }, ctx)).rejects.toMatchObject({
        applied: true,
        message: expect.stringContaining("Formatter failing failed"),
      })
      expect(await Bun.file(filePath).text()).toBe(html)
    },
  })
})
