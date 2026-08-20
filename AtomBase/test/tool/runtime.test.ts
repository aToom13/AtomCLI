import { describe, expect, test } from "bun:test"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("ToolRuntime", () => {
  test("applies replacement, around and reverse after middleware", async () => {
    await using project = await tmpdir()
    const order: string[] = []
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const result = await ToolRuntime.execute({
          tool: "example",
          args: { value: 1 },
          context: {
            sessionID: "session-test",
            messageID: "message-test",
            callID: "call-test",
            agent: "build",
            abort: new AbortController().signal,
            metadata() {},
            async ask() {},
          },
          middleware: [
            {
              before: async ({ args }) => ({ value: args.value + 1 }),
              around: async ({ args, context }, next) => {
                order.push("around:before")
                const output = await next({ value: args.value + 1 }, context)
                order.push("around:after")
                return output
              },
              after: async ({ result }) => ({ ...result, output: result.output + ":after" }),
            },
          ],
          execute: async (args) => {
            order.push("execute")
            return { title: "ok", output: String(args.value), metadata: {} }
          },
        })
        expect(result.output).toBe("3:after")
        expect(order).toEqual(["around:before", "execute", "around:after"])
      },
    })
  })

  test("rejects an invalid canonical result", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(
          ToolRuntime.execute({
            tool: "broken",
            args: {},
            context: {
              sessionID: "session-test",
              messageID: "message-test",
              agent: "build",
              abort: new AbortController().signal,
              metadata() {},
              async ask() {},
            },
            execute: async () => ({ title: "broken", output: 1 as any, metadata: {} }),
          }),
        ).rejects.toThrow("invalid output")
      },
    })
  })
})
