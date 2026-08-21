import { describe, expect, test } from "bun:test"
import { MCP } from "@/integrations/mcp"

describe("MCP prompt-path latency", () => {
  test("aborts while initialization is still pending", async () => {
    const controller = new AbortController()
    const pending = new Promise<never>(() => {})
    const started = performance.now()
    const result = MCP._internals.abortable(pending, controller.signal)
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(performance.now() - started).toBeLessThan(100)
  })

  test("returns the initialization result when it finishes first", async () => {
    const controller = new AbortController()
    await expect(MCP._internals.abortable(Promise.resolve("ready"), controller.signal)).resolves.toBe("ready")
  })

  test("aborts the actual client tool-list boundary", async () => {
    const controller = new AbortController()
    let calls = 0
    const client = {
      listTools() {
        calls++
        return new Promise<{ tools: unknown[] }>(() => {})
      },
    }
    const result = MCP._internals.listClientTools(client, controller.signal)
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toBe(1)
  })
})
