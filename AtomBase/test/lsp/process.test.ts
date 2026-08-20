import { afterEach, describe, expect, test } from "bun:test"
import { LSPProcess } from "@/integrations/lsp/process"

const previous = process.env.OPENAI_API_KEY
afterEach(() => {
  if (previous === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = previous
})

describe("LSPProcess", () => {
  async function read(stream: NodeJS.ReadableStream) {
    let output = ""
    for await (const chunk of stream) output += chunk.toString()
    return output
  }

  test("does not inherit ambient secrets", async () => {
    process.env.OPENAI_API_KEY = "must-not-leak"
    const child = LSPProcess.spawn("sh", ["-c", "printf %s \"${OPENAI_API_KEY-unset}\""])
    const output = await read(child.stdout)
    expect(await new Promise<number | null>((resolve) => child.once("close", resolve))).toBe(0)
    expect(output).toBe("unset")
  })

  test("keeps explicit non-ambient overrides", async () => {
    const child = LSPProcess.spawn("sh", ["-c", "printf %s \"$LSP_EXPLICIT\""], { env: { LSP_EXPLICIT: "ok" } })
    const output = await read(child.stdout)
    expect(await new Promise<number | null>((resolve) => child.once("close", resolve))).toBe(0)
    expect(output).toBe("ok")
  })
})
