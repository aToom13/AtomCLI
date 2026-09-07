import { describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Storage } from "@/core/storage/storage"
import { ExecutionRuntime } from "@/core/execution/runtime"

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

  test("marks post-processing failures as already applied", async () => {
    await using project = await tmpdir()
    let executions = 0
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(
          ToolRuntime.execute({
            tool: "side-effect",
            args: { value: 1 },
            context: {
              sessionID: "session-applied",
              messageID: "message-applied",
              callID: "call-applied",
              agent: "build",
              abort: new AbortController().signal,
              metadata() {},
              async ask() {},
            },
            middleware: [
              {
                after: async () => {
                  throw new Error("post-processing broke")
                },
              },
            ],
            execute: async () => {
              executions++
              return { title: "done", output: "done", metadata: {} }
            },
          }),
        ).rejects.toBeInstanceOf(ToolRuntime.AppliedError)

        expect(executions).toBe(1)
        const events = await Promise.all(
          (await Storage.list(["session_event", "session-applied"])).map((key) => Storage.read<any>(key)),
        )
        expect(events.some((event) => event.type === "tool.applied" && event.callID === "call-applied")).toBe(true)
        expect(events.some((event) => event.type === "tool.error" && event.applied === true)).toBe(true)
      },
    })
  })

  test("checks execution ownership immediately before invoking a tool", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const guard = spyOn(ExecutionRuntime, "assertActive").mockRejectedValue(
          new ExecutionRuntime.BudgetExceededError("stale_fence", "execution-stale"),
        )
        let invoked = false
        try {
          await expect(
            ToolRuntime.execute({
              tool: "write",
              args: {},
              context: {
                sessionID: "session-stale-tool",
                messageID: "message-stale-tool",
                callID: "call-stale-tool",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-stale",
                    rootSessionID: "session-stale-tool",
                    invocationID: "invocation-stale",
                    ownerID: "old-owner",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              execute: async () => {
                invoked = true
                return { title: "write", output: "written", metadata: {} }
              },
            }),
          ).rejects.toMatchObject({ reason: "stale_fence" })
          expect(invoked).toBe(false)
          expect(guard).toHaveBeenCalledTimes(1)
        } finally {
          guard.mockRestore()
        }
      },
    })
  })

  test("persists mutating work admission before invocation and completion afterwards", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const active = spyOn(ExecutionRuntime, "assertActive").mockResolvedValue(undefined)
        const register = spyOn(ExecutionRuntime, "registerWork").mockResolvedValue({
          registered: true,
          idempotent: false,
          state: "prepared",
          version: 1,
        })
        const begin = spyOn(ExecutionRuntime, "beginWork").mockResolvedValue({ began: true, version: 2 })
        const finish = spyOn(ExecutionRuntime, "finishWork").mockResolvedValue({
          finished: true,
          idempotent: false,
          state: "completed",
          version: 3,
        })
        const execution = {
          executionID: "execution-work",
          rootSessionID: "session-work",
          invocationID: "invocation-work",
          ownerID: "owner-work",
          fence: 1,
        }
        try {
          await ToolRuntime.execute({
            tool: "write",
            args: {},
            context: {
              sessionID: "session-work",
              messageID: "message-work",
              callID: "call-work",
              agent: "build",
              abort: new AbortController().signal,
              extra: { execution },
              metadata() {},
              async ask() {},
            },
            execute: async () => {
              expect(register).toHaveBeenCalledWith({
                sessionID: "session-work",
                execution,
                operationID: "execution-work:invocation-work:message-work:call-work:0",
                kind: "tool:write",
                mutating: true,
              })
              return { title: "write", output: "written", metadata: {} }
            },
            middleware: [
              {
                after: async () => {
                  expect(finish).not.toHaveBeenCalled()
                },
              },
            ],
          })
          expect(finish).toHaveBeenCalledWith({
            sessionID: "session-work",
            execution,
            operationID: "execution-work:invocation-work:message-work:call-work:0",
            expectedVersion: 2,
            state: "completed",
          })
        } finally {
          active.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
        }
      },
    })
  })

  test("rechecks execution ownership after around middleware immediately before the tool body", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const active = spyOn(ExecutionRuntime, "assertActive")
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new ExecutionRuntime.BudgetExceededError("stale_fence", "execution-race"))
        const register = spyOn(ExecutionRuntime, "registerWork").mockResolvedValue({
          registered: true,
          idempotent: false,
          state: "prepared",
          version: 1,
        })
        const finish = spyOn(ExecutionRuntime, "finishWork").mockResolvedValue({
          finished: true,
          idempotent: false,
          state: "failed",
          version: 2,
        })
        let invoked = false
        try {
          await expect(
            ToolRuntime.execute({
              tool: "write",
              args: {},
              context: {
                sessionID: "session-race",
                messageID: "message-race",
                callID: "call-race",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-race",
                    rootSessionID: "session-race",
                    invocationID: "invocation-race",
                    ownerID: "owner-race",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              middleware: [{ around: async ({ args, context }, next) => next(args, context) }],
              execute: async () => {
                invoked = true
                return { title: "write", output: "written", metadata: {} }
              },
            }),
          ).rejects.toMatchObject({ reason: "stale_fence" })
          expect(invoked).toBe(false)
          expect(active).toHaveBeenCalledTimes(2)
        } finally {
          active.mockRestore()
          register.mockRestore()
          finish.mockRestore()
        }
      },
    })
  })

  test("allows around middleware to invoke a mutating body only once", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const active = spyOn(ExecutionRuntime, "assertActive").mockResolvedValue(undefined)
        const register = spyOn(ExecutionRuntime, "registerWork").mockResolvedValue({
          registered: true,
          idempotent: false,
          state: "prepared",
          version: 1,
        })
        const begin = spyOn(ExecutionRuntime, "beginWork").mockResolvedValue({ began: true, version: 2 })
        const finish = spyOn(ExecutionRuntime, "finishWork").mockResolvedValue({
          finished: true,
          idempotent: false,
          state: "unknown",
          version: 3,
        })
        let bodyCalls = 0
        try {
          await expect(
            ToolRuntime.execute({
              tool: "write",
              args: {},
              context: {
                sessionID: "session-double-next",
                messageID: "message-double-next",
                callID: "call-double-next",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-double-next",
                    rootSessionID: "session-double-next",
                    invocationID: "invocation-double-next",
                    ownerID: "owner-double-next",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              middleware: [
                {
                  around: async ({ args, context }, next) => {
                    await next(args, context)
                    return next(args, context)
                  },
                },
              ],
              execute: async () => {
                bodyCalls++
                return { title: "write", output: "written", metadata: {} }
              },
            }),
          ).rejects.toThrow("more than once")
          expect(bodyCalls).toBe(1)
          expect(begin).toHaveBeenCalledTimes(1)
          expect(finish).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2, state: "unknown" }))
        } finally {
          active.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
        }
      },
    })
  })
})
