import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "@/integrations/tool/bash"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "@/util/permission/next"
import { Truncate } from "@/integrations/tool/truncation"
import { HarnessState } from "@/core/session/harness-state"
import { ToolRuntime } from "@/integrations/tool/runtime"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { ExecutionContract } from "@/core/routing/execution-contract"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("timeout cannot accept a successful shell whose background child holds output open", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
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
        const result = await ToolRuntime.execute({
          tool: "bash",
          args: {
            command: "sleep 10 & echo parent-finished",
            timeout: 50,
            description: "Check inherited output timeout",
          },
          effects: bash.effects,
          context: { ...ctx, sessionID: session.id, messageID, callID: "background-timeout", extra: { execution } },
          execute: bash.execute,
        })
        expect(result.output).toContain("parent-finished")
        expect(result.output).toContain("exceeding timeout 50 ms")
        expect(result.metadata.exit).toBe(124)
        expect(result.metadata.timedOut).toBe(true)
        expect(HarnessState.getLastLogs(session.id, 1)[0].exitCode).toBe(124)
        expect(ExecutionRuntime.getExecutionEvidence(execution.executionID)).toMatchObject({
          successfulToolCalls: 0,
          failureCount: 1,
          uncertainOutcome: true,
        })
        expect(ExecutionRuntime.view(execution.executionID).unknownWork).toEqual([
          expect.objectContaining({ state: "unknown", mutating: true }),
        ])
      },
    })
  })
  test("a failed command cannot print a trailing success marker", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "false; echo misleading-success", description: "Fail fast regression" },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
        expect(result.output).toContain("Command exited with status 1.")
        expect(result.output).not.toContain("misleading-success")
        const pipeline = await bash.execute(
          { command: "false | cat; echo misleading-success", description: "Fail fast pipeline regression" },
          ctx,
        )
        expect(pipeline.metadata.exit).not.toBe(0)
        expect(pipeline.output).not.toContain("misleading-success")
      },
    })
  })
  test("classifies mutating git branch commands as writes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const effects = bash.effects as (params: { command: string }) => { workspace: string }
        expect(effects({ command: "git branch --show-current" }).workspace).toBe("read")
        expect(effects({ command: "git branch" }).workspace).toBe("read")
        expect(effects({ command: "git branch -D obsolete" }).workspace).toBe("write")
        expect(effects({ command: "git branch -m renamed" }).workspace).toBe("write")
        expect(effects({ command: "git branch feature" }).workspace).toBe("write")
        expect(effects({ command: "git status --short" }).workspace).toBe("read")
      },
    })
  })

  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("does not expose ambient provider and cloud credentials", async () => {
    const names = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN"] as const
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
    for (const name of names) process.env[name] = `secret-${name}`

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: `printf '%s|%s|%s|%s' "$OPENAI_API_KEY" "$ANTHROPIC_API_KEY" "$AWS_SECRET_ACCESS_KEY" "$GITHUB_TOKEN"`,
              description: "Check isolated child environment",
            },
            ctx,
          )
          expect(result.output).toBe("|||")
        },
      })
    } finally {
      for (const name of names) {
        const value = previous[name]
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})

describe("tool.bash permissions", () => {
  test("null redirection does not request external directory access", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: string[] = []
        for (const redirect of ["2>/dev/null", "2>'/dev/null'", "2>>/dev/null", "</dev/null"]) {
          const result = await bash.execute(
            { command: `ls missing.ts ${redirect} || echo no-files`, description: "Check missing test files" },
            {
              ...ctx,
              ask: async (request) => {
                requests.push(request.permission)
                if (request.permission === "external_directory") throw new Error("Unexpected external access")
              },
            },
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("no-files")
        }
        expect(requests).toEqual(["bash", "bash", "bash", "bash"])
      },
    })
  })

  test("other redirects still require external directory permission before execution", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        for (const destination of ["/dev/null-other", "/dev/zero", "/etc/passwd"]) {
          const requests: string[] = []
          await expect(
            bash.execute(
              { command: `echo blocked >${destination}`, description: "Check external redirect boundary" },
              {
                ...ctx,
                ask: async (request) => {
                  requests.push(request.permission)
                  throw new Error("External access denied")
                },
              },
            ),
          ).rejects.toThrow("External access denied")
          expect(requests).toEqual(["external_directory"])
        }
      },
    })
  })

  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd ../",
            description: "Change to parent directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "ls",
            workdir: "/tmp",
            description: "List /tmp",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain("/tmp")
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        await bash.execute(
          {
            command: "rm tmpfile",
            description: "Remove tmpfile",
          },
          testCtx,
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          testCtx,
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })
})

describe("tool.bash truncation", () => {
  test("fingerprints full output independently of truncation paths", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const run = (suffix: string) =>
          bash.execute(
            { command: `seq 1 ${Truncate.MAX_LINES + 100}; printf '${suffix}'`, description: "Check full output" },
            ctx,
          )
        const first = await run("first")
        const repeat = await run("first")
        const changed = await run("changed")
        expect(first.metadata.truncated).toBe(true)
        expect(first.metadata.outputPath).not.toBe(repeat.metadata.outputPath)
        expect(first.metadata.outputFingerprint).toBe(repeat.metadata.outputFingerprint)
        expect(first.metadata.outputFingerprint).not.toBe(changed.metadata.outputFingerprint)
      },
    })
  })

  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(false)
        expect(result.output).toBe("hello\n")
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Bun.file(filepath).text()
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})
