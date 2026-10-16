import "../preload"
import { describe, expect, test } from "bun:test"
import { runAutomaticTaskChecks, TaskVerification } from "@/core/execution/task-verification"
import { tmpdir } from "../fixture/fixture"
import { StaticCheckTool } from "@/integrations/tool/static-check"
import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { HarnessState } from "@/core/session/harness-state"
import { Identifier } from "@/core/id/id"
import { ExecutionLedger } from "@/core/execution/ledger"
import { Global } from "@/core/global"
import path from "path"
import fs from "fs/promises"
import { ToolNotAppliedError } from "@/integrations/tool/runtime-error"
import { BashTool } from "@/integrations/tool/bash"

describe("automatic task verification", () => {
  test("automatic acceptance stops before a misleading success marker", async () => {
    await using tmp = await tmpdir()
    for (const command of ["false; echo misleading-success", "false | cat; echo misleading-success"]) {
      const [result] = await runAutomaticTaskChecks(
        [{ id: "fail-fast", description: "Intentional failure", verification: "automatic", command }],
        tmp.path,
      )
      expect(result.exitCode).not.toBe(0)
      expect(result.evidence).not.toContain("misleading-success")
    }
  })
  test("native build evidence is invalidated by source edits and refreshed by rebuilding", async () => {
    await using tmp = await tmpdir({ config: { formatter: false } })
    await Bun.write(`${tmp.path}/package.json`, JSON.stringify({ scripts: { build: "cp source.ts artifact.ts" } }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(`${tmp.path}/source.ts`, "export const answer = 1\n")
        HarnessState.addEditedFile("build-snapshot", "source.ts")
        const tool = await BashTool.init()
        const context = {
          sessionID: "build-snapshot",
          messageID: "build",
          agent: "coder",
          abort: new AbortController().signal,
          metadata() {},
          async ask() {},
        }
        const build = await tool.execute({ command: "bun run build", description: "Build fixture" }, context)
        expect(build.metadata.exit).toBe(0)
        const evidence = [
          {
            command: "bun run build",
            timestamp: 1,
            snapshot: TaskVerification.BuildSnapshot.parse(build.metadata.sourceSnapshot),
          },
        ]
        expect(await TaskVerification.staleBuildChecks(evidence, ["source.ts"], tmp.path)).toEqual([])
        await Bun.write(`${tmp.path}/source.ts`, "export const answer = 2\n")
        expect(await Bun.file(`${tmp.path}/artifact.ts`).text()).toContain("answer = 1")
        expect(await TaskVerification.staleBuildChecks(evidence, ["source.ts"], tmp.path)).toEqual([
          "source changed after build: bun run build",
        ])
        const rebuilt = await tool.execute({ command: "bun run build", description: "Rebuild fixture" }, context)
        evidence.push({
          command: "bun run build",
          timestamp: 2,
          snapshot: TaskVerification.BuildSnapshot.parse(rebuilt.metadata.sourceSnapshot),
        })
        expect(await TaskVerification.staleBuildChecks(evidence, ["source.ts"], tmp.path)).toEqual([])
        expect(await Bun.file(`${tmp.path}/artifact.ts`).text()).toContain("answer = 2")
        expect(await TaskVerification.staleBuildChecks(evidence, ["source.ts", "added.ts"], tmp.path)).toHaveLength(1)
      },
    })
  })
  test("automatic checks preserve read denies and reject symlink escapes", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    await Bun.write(`${tmp.path}/private.js`, "console.log(fake_private_symbol)")
    await Bun.write(`${outside.path}/source.js`, "console.log('outside')")
    await fs.symlink(`${outside.path}/source.js`, `${tmp.path}/alias.js`)
    await fs.symlink(`${tmp.path}/missing.js`, `${tmp.path}/dangling.js`)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          permission: [{ permission: "read", pattern: "*private.js", action: "deny" }],
        })
        const checks = await TaskVerification.staticChecks(
          ["private.js", "alias.js", "dangling.js"],
          tmp.path,
          session.id,
        )
        expect(checks).toHaveLength(3)
        expect(checks.every((check) => !check.ok)).toBe(true)
        expect(JSON.stringify(checks)).not.toContain("fake_private_symbol")
      },
    })
  })

  test("file checks tolerate an empty content placeholder but reject conflicting source", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(`${tmp.path}/app.ts`, "export const value: number = 1")
        const asked: string[] = []
        const ctx = {
          sessionID: "static-file",
          messageID: "file",
          agent: "coder",
          abort: new AbortController().signal,
          metadata() {},
          async ask(input: { permission: string }) {
            asked.push(input.permission)
          },
        }
        const tool = await StaticCheckTool.init()
        expect((await tool.execute({ file: "app.ts", content: "", globals: [] }, ctx)).metadata.ok).toBe(true)
        expect(asked).toContain("read")
        await expect(tool.execute({ file: "app.ts", content: "console.log(1)" }, ctx)).rejects.toBeInstanceOf(
          ToolNotAppliedError,
        )
      },
    })
  })
  test("worker shutdown cancels owned work and preserves another process's execution", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const own = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: Identifier.ascending("message"),
        })
        const other = `fake-other-${crypto.randomUUID()}`
        const store = ExecutionLedger.open(path.join(Global.Path.data, "execution-ledger.sqlite"))
        try {
          store.start({ id: other, projectID: Instance.project.id, rootSessionID: other, fence: 1 })
          store.claimOwner({ executionID: other, ownerID: "fake-other-process", leaseMs: 60_000 })
          ExecutionRuntime.cancelOwnedExecutions()
          expect(ExecutionRuntime.view(own.executionID)?.outcome).toBe("cancelled")
          expect(store.view(other)?.lifecycle).toBe("active")
        } finally {
          store.close()
        }
      },
    })
  })
  test.each([true, false])("task acceptance enforces changed-file static validation: valid=%s", async (valid) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: Identifier.ascending("message"),
        })
        const common = { sessionID: session.id, execution, taskID: "code" }
        let task = await ExecutionRuntime.registerTask({
          ...common,
          goal: "Create code",
          owner: session.id,
          agent: "coder",
          acceptance: [
            { id: "exists", description: "Artifact exists", verification: "automatic", command: "test -s app.js" },
          ],
        })
        task = await ExecutionRuntime.transitionTask({ ...common, expectedVersion: task.version, status: "running" })
        await Bun.write(`${tmp.path}/app.js`, valid ? "console.log('ok')" : "console.log(undef)")
        HarnessState.addEditedFile(session.id, `${tmp.path}/app.js`)
        task = await ExecutionRuntime.transitionTask({
          ...common,
          expectedVersion: task.version,
          status: "submitted",
          evidence: "Artifact written",
        })
        const attempt = ExecutionRuntime.recordTaskVerification({
          ...common,
          expectedVersion: task.version,
          checks: [],
          automaticChecks: [{ criterionID: "exists", command: "test -s app.js", exitCode: 0, evidence: "exists" }],
        })
        if (valid) expect((await attempt).status).toBe("accepted")
        else {
          await expect(attempt).rejects.toThrow("STATIC_VERIFICATION_FAILED")
          expect((await ExecutionRuntime.getTask(common))?.status).toBe("submitted")
        }
        expect(HarnessState.getLastLogs(session.id).at(-1)?.command ?? "").toContain("static_check")
      },
    })
  })
  test("changed artifacts cannot pass without a static check; fixes invalidate old evidence", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/index.html`, "<script>console.log(undef)</script>")
    await Bun.write(`${tmp.path}/note.txt`, "undef is prose")
    const files = ["index.html", "note.txt", "deleted.js"]
    await expect(TaskVerification.assertStaticChecks(files, tmp.path)).rejects.toThrow("no-undef")
    const broken = await TaskVerification.staticChecks(files, tmp.path)
    expect(broken).toHaveLength(1)
    expect(broken[0].evidence).toContain("sha256=")
    await Bun.write(`${tmp.path}/index.html`, "<script>console.log('fixed')</script>")
    const fixed = await TaskVerification.assertStaticChecks(files, tmp.path)
    expect(fixed[0].ok).toBe(true)
    expect(fixed[0].evidence).not.toBe(broken[0].evidence)
    await Bun.write(`${tmp.path}/index.html`, "<script>console.log(undef)</script>")
    await expect(TaskVerification.assertStaticChecks(files, tmp.path)).rejects.toThrow("STATIC_VERIFICATION_FAILED")
  })

  test("inline static_check content is analyzed instead of skipped", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await StaticCheckTool.init()
        const result = await tool.execute(
          { content: "console.log(undef)" },
          {
            sessionID: "static-inline",
            messageID: "inline",
            agent: "coder",
            abort: new AbortController().signal,
            metadata() {},
            async ask() {},
          },
        )
        expect(result.metadata.analyzable).toBe(true)
        expect(result.metadata.ok).toBe(false)
        expect(result.output).toContain("no-undef")
      },
    })
  })
  test("records command exit and bounded evidence", async () => {
    const checks = await runAutomaticTaskChecks(
      [
        { id: "ok", description: "command succeeds", verification: "automatic", command: "printf pass" },
        { id: "bad", description: "command fails", verification: "automatic", command: "printf fail; exit 3" },
      ],
      process.cwd(),
    )
    expect(checks).toHaveLength(2)
    expect(checks.find((check) => check.criterionID === "ok")).toMatchObject({ exitCode: 0 })
    expect(checks.find((check) => check.criterionID === "bad")).toMatchObject({ exitCode: 3 })
  })

  test("ignores criteria verified by reviewer or parent", async () => {
    await expect(
      runAutomaticTaskChecks([{ id: "review", description: "manual", verification: "reviewer" }], process.cwd()),
    ).resolves.toEqual([])
  })
})
