import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import type { Tool } from "@/integrations/tool/tool"
import { Instance } from "@/services/project/instance"
import { assertExternalDirectory } from "@/integrations/tool/external-directory"
import type { PermissionNext } from "@/util/permission/next"
import fs from "fs/promises"
import { AgentEval } from "@/core/eval/harness"
import { tmpdir } from "../fixture/fixture"
import { BashTool } from "@/integrations/tool/bash"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.assertExternalDirectory", () => {
  test.skipIf(process.platform !== "linux" || !Bun.which("bwrap"))(
    "benchmark child Bash cannot disable private masks through config",
    async () => {
      await using tmp = await tmpdir({
        config: {
          execution: {
            sandbox: "off",
            filesystem: "workspace-write",
            network: "allow",
            environment: "minimal",
            processVisibility: "inherit",
            envAllow: [],
          },
        },
      })
      const privateRoot = path.join(tmp.path, "private")
      await fs.mkdir(privateRoot)
      await Bun.write(path.join(privateRoot, "answer"), "private-test-marker")
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          AgentEval.registerBenchmark("parent", {
            suite: "test",
            caseID: "test",
            runID: "test",
            privatePaths: [privateRoot],
          })
          try {
            const tool = await BashTool.init()
            const result = await tool.execute(
              {
                command: `test ! -e '${privateRoot}/answer'; printf ok > result`,
                description: "Check evaluator isolation",
                workdir: tmp.path,
              },
              { ...baseCtx, sessionID: "child", ask: async () => {} },
            )
            expect(result.metadata.exit).toBe(0)
            expect(await Bun.file(path.join(tmp.path, "result")).text()).toBe("ok")
            expect(await Bun.file(path.join(privateRoot, "answer")).text()).toBe("private-test-marker")
          } finally {
            AgentEval.unregisterBenchmark("parent")
          }
        },
      })
    },
  )
  test("denies evaluator paths and workspace symlinks even for child sessions and bypass callers", async () => {
    await using tmp = await tmpdir()
    const workspace = path.join(tmp.path, "workspace")
    const privateRoot = path.join(tmp.path, "private")
    await fs.mkdir(workspace)
    await fs.mkdir(privateRoot)
    await Bun.write(path.join(privateRoot, "answer"), "private-test-marker")
    const link = path.join(workspace, "linked-answer")
    await fs.symlink(path.join(privateRoot, "answer"), link)
    await Instance.provide({
      directory: workspace,
      fn: async () => {
        AgentEval.registerBenchmark("parent", {
          suite: "test",
          caseID: "test",
          runID: "test",
          privatePaths: [privateRoot],
        })
        const ctx = { ...baseCtx, sessionID: "child", ask: async () => {} }
        try {
          await expect(
            assertExternalDirectory(ctx, path.join(privateRoot, "answer"), { bypass: true }),
          ).rejects.toThrow("evaluator data is private")
          await expect(assertExternalDirectory(ctx, link)).rejects.toThrow("evaluator data is private")
        } finally {
          AgentEval.unregisterBenchmark("parent")
        }
      },
    })
  })
  test("no-ops for empty target", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        await assertExternalDirectory(ctx)
      },
    })

    expect(requests.length).toBe(0)
  })

  test("no-ops for paths inside Instance.directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, path.join("/tmp/project", "file.txt"))
      },
    })

    expect(requests.length).toBe(0)
  })

  test("asks with a single canonical glob", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside/file.txt"
    const expected = path.join(path.dirname(target), "*")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target)
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("uses target directory when kind=directory", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    const directory = "/tmp/project"
    const target = "/tmp/outside"
    const expected = path.join(target, "*")

    await Instance.provide({
      directory,
      fn: async () => {
        await assertExternalDirectory(ctx, target, { kind: "directory" })
      },
    })

    const req = requests.find((r) => r.permission === "external_directory")
    expect(req).toBeDefined()
    expect(req!.patterns).toEqual([expected])
    expect(req!.always).toEqual([expected])
  })

  test("skips prompting when bypass=true", async () => {
    const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
    const ctx: Tool.Context = {
      ...baseCtx,
      ask: async (req) => {
        requests.push(req)
      },
    }

    await Instance.provide({
      directory: "/tmp/project",
      fn: async () => {
        await assertExternalDirectory(ctx, "/tmp/outside/file.txt", { bypass: true })
      },
    })

    expect(requests.length).toBe(0)
  })
})
