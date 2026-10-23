import { describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Storage } from "@/core/storage/storage"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Tool } from "@/integrations/tool/tool"
import { TaskFlow } from "@/integrations/tool/taskflow"
import z from "zod"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { BrowserTool } from "@/integrations/tool/browser"
import { TodoTool } from "@/integrations/tool/todo-tool"
import path from "path"
import fs from "fs/promises"

describe("ToolRuntime", () => {
  test("browser flow, saved captures and checklist changes retain verification until a source edit", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.parseSafe({
            intent: "change",
            scope: "focused",
            risk: "low",
            confidence: 1,
            needsMutation: true,
          }),
        )
        const context = {
          sessionID: session.id,
          messageID,
          agent: "build",
          abort: new AbortController().signal,
          extra: { execution },
          metadata() {},
          async ask() {},
        }
        const browser = await BrowserTool.init()
        for (const [index, args] of [
          { action: "flow", steps: [{ action: "navigate", url: "http://127.0.0.1/" }, { action: "assert" }] },
          { action: "screenshot", save: true },
        ].entries()) {
          await ToolRuntime.execute({
            tool: "browser",
            args,
            effects: browser.effects as (args: any) => Tool.ToolEffects,
            mutating: browser.mutating as (args: any) => boolean,
            context: { ...context, callID: `browser-${index}` },
            execute: async () => ({ title: "verified", output: "verified", metadata: {} }),
          })
        }
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          browserNavigations: 1,
          browserVerificationCalls: 2,
          mutatingCalls: 0,
        })
        const verified = ExecutionRuntime.getExecutionEvidence(execution.executionID)
        const todo = await TodoTool.init()
        const added = await ToolRuntime.execute({
          tool: "todo",
          args: { action: "add", content: "Verify browser behavior" } as const,
          effects: todo.effects,
          context: { ...context, callID: "todo-add" },
          execute: todo.execute,
        })
        await ToolRuntime.execute({
          tool: "todo",
          args: { action: "check", id: added.metadata.id } as const,
          effects: todo.effects,
          context: { ...context, callID: "todo-check" },
          execute: todo.execute,
        })
        expect(JSON.parse((await todo.execute({ action: "list" }, context)).output)[0].status).toBe("completed")
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          browserNavigations: 1,
          browserVerificationCalls: 2,
          mutatingCalls: 0,
          toolCalls: verified.toolCalls + 2,
          recentSemanticActionResults: verified.recentSemanticActionResults,
        })
        await ToolRuntime.execute({
          tool: "write",
          args: { filePath: `${project.path}/index.html` },
          context: { ...context, callID: "source-edit" },
          execute: async (args) => {
            await Bun.write(args.filePath, "<!doctype html><title>fixture</title>")
            return { title: "written", output: "written", metadata: {} }
          },
        })
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          browserNavigations: 0,
          browserVerificationCalls: 0,
          mutatingCalls: 1,
        })
        const sourceEdited = ExecutionRuntime.getExecutionEvidence(execution.executionID)
        for (const action of ["reload", "screenshot"])
          await ToolRuntime.execute({
            tool: "browser",
            args: { action },
            effects: browser.effects as (args: any) => Tool.ToolEffects,
            mutating: browser.mutating as (args: any) => boolean,
            context: { ...context, callID: `blank-${action}` },
            execute: async () => ({ title: "blank", output: action, metadata: { url: "about:blank" } }),
          })
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          browserNavigations: 0,
          browserVerificationCalls: 0,
          toolCalls: sourceEdited.toolCalls + 2,
          successfulToolCalls: sourceEdited.successfulToolCalls + 2,
          recentSemanticActionResults: sourceEdited.recentSemanticActionResults,
        })
        await ToolRuntime.execute({
          tool: "browser",
          args: { action: "reload" },
          effects: browser.effects as (args: any) => Tool.ToolEffects,
          mutating: browser.mutating as (args: any) => boolean,
          context: { ...context, callID: "reload-edited-source" },
          execute: async () => ({ title: "reloaded", output: "reloaded", metadata: {} }),
        })
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          browserNavigations: 1,
          browserVerificationCalls: 0,
        })
      },
    })
  })

  test("counts browser flow navigation and verification evidence", () => {
    expect(
      ToolRuntime.browserRuntimeEvidence("browser", {
        action: "flow",
        steps: [
          { action: "navigate", url: "http://127.0.0.1:8765/" },
          { action: "click", role: "button", accessibleName: "Increment" },
          { action: "assert", targetText: "1", assertion: "visible" },
          { action: "evaluate", script: "document.title" },
        ],
      }),
    ).toEqual({ browserNavigations: 1, browserVerificationCalls: 2 })
    expect(ToolRuntime.browserRuntimeEvidence("browser", { action: "snapshot" })).toEqual({})
    expect(
      ToolRuntime.browserRuntimeEvidence("browser", {
        action: "flow",
        steps: [{ action: "accessibility" }, { action: "network" }],
      }),
    ).toEqual({ browserAccessibilityCalls: 1, browserNetworkCalls: 1 })
  })

  test("declared inspection reports preserve proof; source edits and unknown shell writes invalidate it", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: messageID })
        ExecutionRuntime.setExecutionContract(
          execution.executionID,
          ExecutionContract.fallback("site inspection", {
            intent: "operate",
            deliverables: ["findings.md"],
            expectedSurfaces: ["browser", "workspace"],
          }),
        )
        const ctx = {
          sessionID: session.id,
          messageID,
          agent: "build",
          abort: new AbortController().signal,
          extra: { execution },
          metadata() {},
          async ask() {},
        }
        const browser = await BrowserTool.init()
        for (const target of ["findings.md", "src/index.html", "src/guide.md", "bash"]) {
          await ToolRuntime.execute({
            tool: "browser",
            args: {
              action: "flow",
              steps: [
                { action: "navigate", url: "http://localhost:4567/" },
                { action: "accessibility" },
                { action: "network" },
              ],
            },
            effects: browser.effects as (args: any) => Tool.ToolEffects,
            context: { ...ctx, callID: `inspect-${target}` },
            execute: async () => ({
              title: "inspection",
              output: "inspection",
              metadata: { url: "http://localhost:4567/" },
            }),
          })
          await ToolRuntime.execute({
            tool: target === "bash" ? "bash" : "write",
            args: target === "bash" ? { command: "unknown script" } : { filePath: path.join(project.path, target) },
            context: { ...ctx, callID: `write-${target}` },
            execute: async (args) => {
              if (args.filePath) await Bun.write(args.filePath, "fixture")
              return { title: "write", output: "write", metadata: {} }
            },
          })
          const preserved = target === "findings.md" ? 1 : 0
          expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
            browserNavigations: preserved,
            browserAccessibilityCalls: preserved,
            browserNetworkCalls: preserved,
          })
        }
        const contract = ExecutionContract.fallback("site change", { intent: "change", deliverables: ["findings.md"] })
        expect(
          await ToolRuntime.isInspectionReport("write", { filePath: path.join(project.path, "findings.md") }, contract),
        ).toBe(false)
        expect(
          await ToolRuntime.isInspectionReport(
            "write",
            { filePath: path.join(project.path, "findings.md") },
            undefined,
          ),
        ).toBe(false)
        const source = path.join(project.path, "source.html")
        await Bun.write(source, "source")
        await fs.symlink(source, path.join(project.path, "symlink.md"))
        await fs.link(source, path.join(project.path, "hardlink.md"))
        const linked = ExecutionContract.fallback("inspect", {
          intent: "inspect",
          deliverables: ["symlink.md", "hardlink.md"],
        })
        for (const name of linked.deliverables)
          expect(
            await ToolRuntime.isInspectionReport("write", { filePath: path.join(project.path, name) }, linked),
          ).toBe(false)
      },
    })
  })

  test("normalizes bash semantic signatures across non-semantic metadata", () => {
    const first = ToolRuntime.semanticSignature("bash", {
      command: "npm   run test:all",
      workdir: "/home/atom13/Projeler/RepoMap/",
      description: "first verification",
      timeout: 30_000,
    })
    const second = ToolRuntime.semanticSignature("bash", {
      command: " npm run test:all ",
      workdir: "/home/atom13/Projeler/RepoMap",
      description: "repeat verification",
      timeout: 120_000,
    })

    expect(first).toBe(second)
  })

  test("marks tool argument validation failures as not applied", async () => {
    const tool = await Tool.define("validated", {
      description: "test",
      parameters: z.object({ value: z.string() }),
      async execute() {
        return { title: "ok", output: "ok", metadata: {} }
      },
    }).init()

    await expect(tool.execute({ value: 1 } as any, {} as any)).rejects.toBeInstanceOf(ToolRuntime.NotAppliedError)
  })

  test("does not mark read-only tool failures as unknown work", async () => {
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
          state: "failed",
          version: 3,
        })
        const activate = spyOn(TaskFlow, "activateForWork")
        try {
          await expect(
            ToolRuntime.execute({
              tool: "lsp",
              args: { operation: "hover" },
              mutating: false,
              context: {
                sessionID: "session-read-only",
                messageID: "message-read-only",
                callID: "call-read-only",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-read-only",
                    rootSessionID: "session-read-only",
                    invocationID: "invocation-read-only",
                    ownerID: "owner-read-only",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              execute: async () => {
                throw new Error("LSP unavailable")
              },
            }),
          ).rejects.toThrow("LSP unavailable")
          expect(register).toHaveBeenCalledWith(expect.objectContaining({ mutating: false }))
          expect(finish).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }))
          register.mockClear()
          activate.mockClear()
          await expect(
            ToolRuntime.execute({
              tool: "scope_control",
              args: { action: "status" },
              context: {
                sessionID: "session-read-only",
                messageID: "message-read-only",
                callID: "call-scope-status",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-read-only",
                    rootSessionID: "session-read-only",
                    invocationID: "invocation-read-only",
                    ownerID: "owner-read-only",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              execute: async () => {
                throw new Error("status unavailable")
              },
            }),
          ).rejects.toThrow("status unavailable")
          expect(register).toHaveBeenCalledWith(expect.objectContaining({ mutating: false }))
          expect(activate).not.toHaveBeenCalled()
        } finally {
          active.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
          activate.mockRestore()
        }
      },
    })
  })

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

  test("records known pre-mutation failures without blocking later execution", async () => {
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
          state: "failed",
          version: 3,
        })
        try {
          await expect(
            ToolRuntime.execute({
              tool: "write",
              args: {},
              context: {
                sessionID: "session-not-applied",
                messageID: "message-not-applied",
                callID: "call-not-applied",
                agent: "build",
                abort: new AbortController().signal,
                extra: {
                  execution: {
                    executionID: "execution-not-applied",
                    rootSessionID: "session-not-applied",
                    invocationID: "invocation-not-applied",
                    ownerID: "owner-not-applied",
                    fence: 1,
                  },
                },
                metadata() {},
                async ask() {},
              },
              execute: async () => {
                throw new ToolRuntime.NotAppliedError(new Error("permission denied"))
              },
            }),
          ).rejects.toThrow("permission denied")
          expect(finish).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2, state: "failed" }))
        } finally {
          active.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
        }
      },
    })
  })

  test("treats rejected in-tool permission checks as not applied", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        await expect(
          ToolRuntime.execute({
            tool: "edit",
            args: {},
            context: {
              sessionID: "session-permission-reject",
              messageID: "message-permission-reject",
              callID: "call-permission-reject",
              agent: "build",
              abort: new AbortController().signal,
              metadata() {},
              async ask() {
                throw new Error("Permission rejected")
              },
            },
            execute: async (_args, context) => {
              await context.ask({ permission: "edit", patterns: ["file"], always: ["*"], metadata: {} })
              return { title: "edit", output: "edited", metadata: {} }
            },
          }),
        ).rejects.toBeInstanceOf(ToolRuntime.NotAppliedError)
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

  test("records explicit tool effects only after successful execution", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const active = spyOn(ExecutionRuntime, "assertActive").mockResolvedValue(undefined)
        const reserve = spyOn(ExecutionRuntime, "reserveToolCall").mockImplementation(() => undefined as any)
        const evidence = spyOn(ExecutionRuntime, "recordRuntimeEvidence").mockReturnValue({} as any)
        const semantic = spyOn(ExecutionRuntime, "recordSemanticActionResult").mockReturnValue({} as any)
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
        try {
          await ToolRuntime.execute({
            tool: "remote-write",
            args: { filePath: "src/auth.ts" },
            effects: {
              workspace: "write",
              external: "write",
              reversible: false,
              destructive: true,
              privileged: true,
            },
            context: {
              sessionID: "session-effects",
              messageID: "message-effects",
              callID: "call-effects",
              agent: "build",
              abort: new AbortController().signal,
              extra: {
                execution: {
                  executionID: "execution-effects",
                  rootSessionID: "session-effects",
                  invocationID: "invocation-effects",
                  ownerID: "owner-effects",
                  fence: 1,
                },
              },
              metadata() {},
              async ask() {},
            },
            execute: async () => ({ title: "done", output: "done", metadata: {} }),
          })

          expect(reserve).toHaveBeenCalledWith("execution-effects")
          expect(semantic).toHaveBeenCalledWith("execution-effects", expect.any(String), expect.any(String))
          expect(evidence).toHaveBeenCalledWith("execution-effects", {
            filesRead: [],
            filesChanged: ["src/auth.ts"],
            fileWriteCounts: { "src/auth.ts": 1 },
            mutatingCalls: 1,
            browserSourceMutations: 1,
            externalCalls: 1,
            hasDestructiveAction: true,
            successfulToolCalls: 1,
          })

          evidence.mockClear()
          semantic.mockClear()
          await ToolRuntime.execute({
            tool: "bash",
            args: { command: "false" },
            mutating: false,
            context: {
              sessionID: "session-effects",
              messageID: "message-effects",
              callID: "call-semantic-failure",
              agent: "build",
              abort: new AbortController().signal,
              extra: {
                execution: {
                  executionID: "execution-effects",
                  rootSessionID: "session-effects",
                  invocationID: "invocation-effects",
                  ownerID: "owner-effects",
                  fence: 1,
                },
              },
              metadata() {},
              async ask() {},
            },
            execute: async () => ({ title: "failed", output: "command failed", metadata: { exit: 1 } }),
          })
          expect(evidence).toHaveBeenCalledWith(
            "execution-effects",
            expect.objectContaining({
              successfulToolCalls: 0,
              failureCount: 1,
              recentErrorFingerprints: [expect.any(String)],
            }),
          )
          expect(finish).toHaveBeenLastCalledWith(expect.objectContaining({ state: "failed" }))
          expect(semantic).not.toHaveBeenCalled()
        } finally {
          active.mockRestore()
          reserve.mockRestore()
          evidence.mockRestore()
          semantic.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
        }
      },
    })
  })

  test("promotes security, migration, and public API edit evidence", () => {
    expect(ToolRuntime.changeRiskEvidence("edit", { filePath: "src/auth/token.ts", newString: "authorize()" })).toEqual(
      expect.objectContaining({ hasAuthOrSecurityEffect: true }),
    )
    expect(
      ToolRuntime.changeRiskEvidence("write", {
        filePath: "db/migrations/001_users.sql",
        content: "ALTER TABLE users ADD COLUMN role TEXT",
      }),
    ).toEqual(expect.objectContaining({ hasSchemaOrMigrationEffect: true }))
    expect(
      ToolRuntime.changeRiskEvidence("edit", {
        filePath: "src/server/routes/users.ts",
        newString: 'app.get("/users", handler)',
      }),
    ).toEqual(expect.objectContaining({ hasPublicApiEffect: true }))
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
        const evidence = spyOn(ExecutionRuntime, "recordRuntimeEvidence").mockReturnValue({} as any)
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
          expect(evidence).toHaveBeenCalledWith(
            "execution-double-next",
            expect.objectContaining({ failureCount: 1, uncertainOutcome: true }),
          )
        } finally {
          active.mockRestore()
          register.mockRestore()
          begin.mockRestore()
          finish.mockRestore()
          evidence.mockRestore()
        }
      },
    })
  })
})
